from datetime import datetime, timezone
from sqlalchemy import update
from sqlalchemy.orm import Session
from app.core.errors import error
from app.models import ActivityEvent, Approval, WorkItem


def event(db: Session, item_id, actor_id, kind, old=None, new=None, details=None):
    db.add(ActivityEvent(work_item_id=item_id, actor_id=actor_id, event_type=kind, old_values=old, new_values=new, details=details))


def update_item(db: Session, item: WorkItem, expected: int, values: dict) -> WorkItem:
    update_values = {**values, 'version': WorkItem.version + 1, 'updated_at': datetime.now(timezone.utc)}
    result = db.execute(update(WorkItem).where(WorkItem.id == item.id, WorkItem.version == expected).values(**update_values).returning(WorkItem.id))
    if result.scalar_one_or_none() is None:
        raise error(409, 'stale_version', 'Work item changed; fetch the latest version and retry')
    db.refresh(item)
    return item


def update_approval(db: Session, approval: Approval, expected: int, values: dict) -> Approval:
    update_values = {**values, 'version': Approval.version + 1}
    result = db.execute(update(Approval).where(Approval.id == approval.id, Approval.version == expected, Approval.status == 'PENDING').values(**update_values).returning(Approval.id))
    if result.scalar_one_or_none() is None:
        raise error(409, 'stale_version', 'Approval changed; fetch the latest version and retry')
    db.refresh(approval)
    return approval
