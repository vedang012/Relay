from datetime import datetime, timezone
from uuid import UUID
from fastapi import APIRouter, Depends, Query
from sqlalchemy import and_, exists, func, or_, select
from sqlalchemy.orm import Session
from app.api.deps import current_user
from app.core.errors import error
from app.db.session import get_db
from app.models import Approval, Assignment, User, WorkItem
from app.schemas.api import ItemOut
from app.api.work_items import scope

router = APIRouter(prefix='/dashboard', tags=['dashboard'])

@router.get('/attention')
def attention(team_id: UUID | None = None, reason: str | None = None, priority: str | None = None, page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100), user: User = Depends(current_user), db: Session = Depends(get_db)):
    reasons = {
        'OVERDUE': and_(WorkItem.due_at < datetime.now(timezone.utc), WorkItem.status.not_in(['RESOLVED','CLOSED'])),
        'BLOCKED': WorkItem.status == 'BLOCKED',
        'UNASSIGNED': ~exists(select(Assignment.user_id).where(Assignment.work_item_id == WorkItem.id, Assignment.role == 'OWNER')),
        'PENDING_APPROVAL': exists(select(Approval.id).where(Approval.work_item_id == WorkItem.id, Approval.status == 'PENDING')),
    }
    if reason and reason not in reasons: raise error(422, 'invalid_reason', 'Unsupported attention reason')
    stmt = select(WorkItem).where(scope(db, user), WorkItem.status != 'CLOSED', reasons[reason] if reason else or_(*reasons.values()))
    if team_id: stmt = stmt.where(WorkItem.team_id == team_id)
    if priority: stmt = stmt.where(WorkItem.priority == priority)
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = db.scalars(stmt.order_by(WorkItem.created_at.desc(), WorkItem.id).offset((page-1)*page_size).limit(page_size)).all()
    ids = [row.id for row in rows]
    assigned = set(db.scalars(select(Assignment.work_item_id).where(Assignment.work_item_id.in_(ids), Assignment.role == 'OWNER')).all()) if ids else set()
    pending = set(db.scalars(select(Approval.work_item_id).where(Approval.work_item_id.in_(ids), Approval.status == 'PENDING')).all()) if ids else set()
    now = datetime.now(timezone.utc)
    def item_reasons(row):
        return [name for name, yes in [('OVERDUE', row.due_at is not None and row.due_at < now and row.status not in ('RESOLVED','CLOSED')), ('BLOCKED', row.status == 'BLOCKED'), ('UNASSIGNED', row.id not in assigned), ('PENDING_APPROVAL', row.id in pending)] if yes]
    return {'items': [{'work_item': ItemOut.model_validate(row), 'reasons': item_reasons(row)} for row in rows], 'total': total, 'page': page, 'page_size': page_size}
