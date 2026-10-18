from datetime import datetime, timezone
from uuid import UUID
from fastapi import APIRouter, Depends, Query
from sqlalchemy import exists, func, select
from sqlalchemy.orm import Session
from app.api.deps import current_user
from app.core.errors import error
from app.db.session import get_db
from app.models import Approval, Membership, User, WorkItem
from app.schemas.api import (
    ApprovalCreate,
    ApprovalDecision,
    ApprovalOut,
    ApprovalSummary,
    PageResponse,
)
from app.services.access import team_permission, visible_item
from app.api.work_items import scope
from app.services.mutations import event, update_approval, update_item

router = APIRouter(prefix="/approvals", tags=["approvals"])


@router.get("", response_model=PageResponse[ApprovalSummary])
def list_approvals(
    status: str | None = "PENDING",
    team_id: UUID | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    if status and status not in {"PENDING", "APPROVED", "REJECTED", "CANCELLED"}:
        raise error(422, "invalid_status", "Unsupported approval status")
    visible = (
        select(WorkItem.id)
        .where(WorkItem.id == Approval.work_item_id, scope(db, user))
        .correlate(Approval)
    )
    stmt = select(Approval).where(exists(visible))
    if status:
        stmt = stmt.where(Approval.status == status)
    if team_id:
        stmt = stmt.where(exists(visible.where(WorkItem.team_id == team_id)))
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = db.execute(
        stmt.add_columns(WorkItem.title, WorkItem.team_id, User.full_name)
        .join(WorkItem, WorkItem.id == Approval.work_item_id)
        .join(User, User.id == Approval.requester_id)
        .order_by(Approval.requested_at.desc(), Approval.id)
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    items = []
    for approval, title, item_team_id, requester_name in rows:
        can_decide = (
            approval.status == "PENDING"
            and approval.requester_id != user.id
            and (approval.approver_id is None or approval.approver_id == user.id)
            and team_permission(db, user.id, item_team_id, "approval:decide")
        )
        items.append(
            {
                **ApprovalOut.model_validate(approval).model_dump(),
                "work_item_title": title,
                "team_id": item_team_id,
                "requester_name": requester_name,
                "can_decide": can_decide,
            }
        )
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.post("", response_model=ApprovalOut, status_code=201)
def request_approval(
    body: ApprovalCreate,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    item = visible_item(db, body.work_item_id, user.id, "approval:request")
    if body.approver_id:
        approver = db.get(User, body.approver_id)
        member = db.get(Membership, (body.approver_id, item.team_id))
        if (
            not approver
            or not approver.active
            or not member
            or not member.active
            or not team_permission(
                db, body.approver_id, item.team_id, "approval:decide"
            )
        ):
            raise error(422, "invalid_approver", "Designated approver is not eligible")
    update_item(db, item, body.version, {})
    approval = Approval(
        work_item_id=item.id,
        requester_id=user.id,
        approver_id=body.approver_id,
        type=body.type,
        reason=body.reason,
    )
    db.add(approval)
    db.flush()
    event(
        db,
        item.id,
        user.id,
        "APPROVAL_REQUESTED",
        new={"approval_id": str(approval.id), "type": body.type},
    )
    db.commit()
    return approval


@router.get("/{approval_id}", response_model=ApprovalOut)
def get_approval(
    approval_id: UUID, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    approval = db.get(Approval, approval_id)
    if not approval:
        raise error(404, "not_found", "Approval not found")
    visible_item(db, approval.work_item_id, user.id)
    return approval


@router.post("/{approval_id}/decision", response_model=ApprovalOut)
def decide(
    approval_id: UUID,
    body: ApprovalDecision,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    approval = db.get(Approval, approval_id)
    if not approval:
        raise error(404, "not_found", "Approval not found")
    item = visible_item(db, approval.work_item_id, user.id, "approval:decide")
    if approval.approver_id and approval.approver_id != user.id:
        raise error(403, "forbidden", "Approval is designated to another user")
    if approval.requester_id == user.id:
        raise error(403, "forbidden", "Requester cannot decide their own approval")
    if approval.status != "PENDING":
        raise error(409, "already_decided", "Approval is no longer pending")
    update_approval(
        db,
        approval,
        body.version,
        {"status": body.status, "decided_at": datetime.now(timezone.utc)},
    )
    event(
        db,
        item.id,
        user.id,
        "APPROVAL_DECIDED",
        old={"status": "PENDING"},
        new={"status": body.status},
        details={"approval_id": str(approval.id)},
    )
    db.commit()
    return approval
