from datetime import datetime, timezone
from hashlib import sha256
from uuid import UUID
from fastapi import APIRouter, Depends, Header, Query
from sqlalchemy import and_, exists, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app.api.deps import current_user
from app.core.errors import error
from app.db.session import get_db
from app.models import (
    ActivityEvent,
    Assignment,
    Bookmark,
    IdempotencyRecord,
    Membership,
    RolePermission,
    User,
    UserRole,
    WorkItem,
)
from app.schemas.api import (
    AssignmentInput,
    ItemCreate,
    ItemOut,
    ItemPatch,
    Transition,
    VersionInput,
)
from app.services.access import global_permission, require_team, visible_item
from app.services.mutations import event, update_item
from app.services.workflow import TRANSITIONS

router = APIRouter(prefix="/work-items", tags=["work-items"])


def scope(db: Session, user: User, permission="work_item:read"):
    member = exists(
        select(Membership.user_id).where(
            Membership.user_id == user.id,
            Membership.team_id == WorkItem.team_id,
            Membership.active.is_(True),
        )
    )
    if global_permission(db, user.id, permission):
        return member
    allowed = exists(
        select(UserRole.id)
        .join(RolePermission, RolePermission.role_id == UserRole.role_id)
        .where(
            UserRole.user_id == user.id,
            UserRole.team_id == WorkItem.team_id,
            RolePermission.permission_code == permission,
        )
    )
    return and_(member, allowed)


@router.post("", response_model=ItemOut, status_code=201)
def create_item(
    body: ItemCreate,
    idempotency_key: str | None = Header(default=None, max_length=200),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    require_team(db, user.id, body.team_id, "work_item:create")
    if body.parent_id:
        visible_item(db, body.parent_id, user.id)
    digest = sha256(body.model_dump_json().encode()).hexdigest()
    if idempotency_key:
        previous = db.get(
            IdempotencyRecord, (user.id, "work_item:create", idempotency_key)
        )
        if previous:
            if previous.payload_hash != digest:
                raise error(
                    409, "idempotency_mismatch", "Key was used with different input"
                )
            return db.get(WorkItem, previous.resource_id)
    item = WorkItem(**body.model_dump(), creator_id=user.id)
    try:
        db.add(item)
        db.flush()
        event(
            db,
            item.id,
            user.id,
            "CREATED",
            new={"title": item.title, "status": item.status},
        )
        if idempotency_key:
            db.add(
                IdempotencyRecord(
                    actor_id=user.id,
                    operation="work_item:create",
                    key=idempotency_key,
                    payload_hash=digest,
                    resource_id=item.id,
                )
            )
        db.commit()
    except IntegrityError:
        db.rollback()
        if idempotency_key:
            previous = db.get(
                IdempotencyRecord, (user.id, "work_item:create", idempotency_key)
            )
            if previous:
                if previous.payload_hash != digest:
                    raise error(
                        409, "idempotency_mismatch", "Key was used with different input"
                    ) from None
                return db.get(WorkItem, previous.resource_id)
        raise error(409, "conflict", "Creation conflicted with current data") from None
    return item


@router.get("")
def list_items(
    team_id: UUID | None = None,
    status: str | None = None,
    priority: str | None = None,
    type: str | None = None,
    assignee_id: UUID | None = None,
    overdue: bool | None = None,
    bookmarked: bool | None = None,
    search: str | None = None,
    sort: str = "created_at",
    direction: str = "desc",
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    if sort not in {
        "created_at",
        "updated_at",
        "due_at",
        "priority",
        "status",
    } or direction not in {"asc", "desc"}:
        raise error(422, "invalid_sort", "Unsupported sort field or direction")
    stmt = select(WorkItem).where(scope(db, user))
    if bookmarked is not None:
        saved = exists(
            select(Bookmark.user_id).where(
                Bookmark.user_id == user.id, Bookmark.work_item_id == WorkItem.id
            )
        )
        stmt = stmt.where(saved if bookmarked else ~saved)
    if team_id:
        stmt = stmt.where(WorkItem.team_id == team_id)
    if status:
        stmt = stmt.where(WorkItem.status == status)
    if priority:
        stmt = stmt.where(WorkItem.priority == priority)
    if type:
        stmt = stmt.where(WorkItem.type == type)
    if assignee_id:
        stmt = stmt.where(
            exists(
                select(Assignment.user_id).where(
                    Assignment.work_item_id == WorkItem.id,
                    Assignment.user_id == assignee_id,
                )
            )
        )
    if overdue is not None:
        condition = and_(
            WorkItem.due_at < datetime.now(timezone.utc),
            WorkItem.status.not_in(["RESOLVED", "CLOSED"]),
        )
        stmt = stmt.where(condition if overdue else ~condition)
    if search:
        stmt = stmt.where(
            or_(
                WorkItem.title.ilike(f"%{search}%"),
                WorkItem.description.ilike(f"%{search}%"),
            )
        )
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    column = getattr(WorkItem, sort)
    rows = db.scalars(
        stmt.order_by(
            column.asc() if direction == "asc" else column.desc(), WorkItem.id
        )
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return {
        "items": [ItemOut.model_validate(row) for row in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/{item_id}", response_model=ItemOut)
def get_item(
    item_id: UUID, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    return visible_item(db, item_id, user.id)


@router.patch("/{item_id}", response_model=ItemOut)
def patch_item(
    item_id: UUID,
    body: ItemPatch,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    item = visible_item(db, item_id, user.id, "work_item:update")
    values = body.model_dump(exclude_unset=True, exclude={"version"})
    if not values:
        raise error(422, "empty_update", "No editable fields supplied")
    if any(
        values.get(k) is None
        for k in ("title", "description", "priority")
        if k in values
    ):
        raise error(422, "invalid_null", "Field cannot be null")
    old = {
        key: str(getattr(item, key)) if getattr(item, key) is not None else None
        for key in values
    }
    item = update_item(db, item, body.version, values)
    event(
        db,
        item.id,
        user.id,
        "UPDATED",
        old=old,
        new={k: str(v) if v is not None else None for k, v in values.items()},
    )
    db.commit()
    return item


@router.post("/{item_id}/transitions", response_model=ItemOut)
def transition(
    item_id: UUID,
    body: Transition,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    item = visible_item(db, item_id, user.id, "work_item:transition")
    if body.status not in TRANSITIONS[item.status]:
        raise error(
            422,
            "invalid_transition",
            f"Cannot transition from {item.status} to {body.status}",
        )
    if body.status == "CLOSED":
        require_team(db, user.id, item.team_id, "work_item:close")
    old = item.status
    values = {
        "status": body.status,
        "resolved_at": datetime.now(timezone.utc)
        if body.status == "RESOLVED"
        else None,
    }
    item = update_item(db, item, body.version, values)
    event(
        db,
        item.id,
        user.id,
        "STATUS_CHANGED",
        old={"status": old},
        new={"status": body.status},
    )
    db.commit()
    return item


@router.post("/{item_id}/assignments", response_model=ItemOut)
def assign(
    item_id: UUID,
    body: AssignmentInput,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    item = visible_item(db, item_id, user.id, "work_item:assign")
    assignee = db.get(User, body.user_id)
    member = db.get(Membership, (body.user_id, item.team_id))
    if not assignee or not assignee.active or not member or not member.active:
        raise error(422, "invalid_assignee", "Assignee needs active team membership")
    if db.get(Assignment, (item.id, body.user_id)):
        raise error(409, "duplicate_assignment", "User is already assigned")
    if body.role == "OWNER" and db.scalar(
        select(Assignment).where(
            Assignment.work_item_id == item.id, Assignment.role == "OWNER"
        )
    ):
        raise error(409, "owner_exists", "Remove the current owner first")
    update_item(db, item, body.version, {})
    db.add(
        Assignment(
            work_item_id=item.id,
            user_id=body.user_id,
            role=body.role,
            assigned_by=user.id,
        )
    )
    event(
        db,
        item.id,
        user.id,
        "ASSIGNED",
        new={"user_id": str(body.user_id), "role": body.role},
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise error(
            409, "assignment_conflict", "Assignment changed concurrently"
        ) from None
    db.expire(item, ["assignments"])
    return item


@router.delete("/{item_id}/assignments/{assignee_id}", response_model=ItemOut)
def unassign(
    item_id: UUID,
    assignee_id: UUID,
    body: VersionInput,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    item = visible_item(db, item_id, user.id, "work_item:assign")
    assignment = db.get(Assignment, (item.id, assignee_id))
    if not assignment:
        raise error(404, "not_found", "Assignment not found")
    old_role = assignment.role
    update_item(db, item, body.version, {})
    db.delete(assignment)
    event(
        db,
        item.id,
        user.id,
        "UNASSIGNED",
        old={"user_id": str(assignee_id), "role": old_role},
    )
    db.commit()
    db.expire(item, ["assignments"])
    return item


@router.get("/{item_id}/activity")
def activity(
    item_id: UUID,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    visible_item(db, item_id, user.id)
    base = select(ActivityEvent).where(ActivityEvent.work_item_id == item_id)
    total = db.scalar(select(func.count()).select_from(base.subquery()))
    rows = db.scalars(
        base.order_by(ActivityEvent.created_at.desc(), ActivityEvent.id)
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return {
        "items": [
            {
                "id": e.id,
                "event_type": e.event_type,
                "actor_id": e.actor_id,
                "old_values": e.old_values,
                "new_values": e.new_values,
                "details": e.details,
                "created_at": e.created_at,
            }
            for e in rows
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
    }
