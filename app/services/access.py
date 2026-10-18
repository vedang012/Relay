from uuid import UUID
from sqlalchemy import exists, select
from sqlalchemy.orm import Session
from app.core.errors import error
from app.models import Membership, RolePermission, UserRole, WorkItem


def accessible_teams(db: Session, user_id: UUID, permission: str):
    membership = exists(select(Membership.user_id).where(Membership.user_id == user_id, Membership.team_id == UserRole.team_id, Membership.active.is_(True)))
    permission_exists = exists(select(RolePermission.role_id).where(RolePermission.role_id == UserRole.role_id, RolePermission.permission_code == permission))
    return select(UserRole.team_id).where(UserRole.user_id == user_id, UserRole.team_id.is_not(None), membership, permission_exists)


def global_permission(db: Session, user_id: UUID, permission: str) -> bool:
    return db.scalar(select(exists(select(UserRole.id).join(RolePermission, RolePermission.role_id == UserRole.role_id).where(UserRole.user_id == user_id, UserRole.team_id.is_(None), RolePermission.permission_code == permission)))) or False


def team_permission(db: Session, user_id: UUID, team_id: UUID, permission: str) -> bool:
    member = db.get(Membership, (user_id, team_id))
    if not member or not member.active:
        return False
    return global_permission(db, user_id, permission) or db.scalar(select(exists(select(UserRole.id).join(RolePermission, RolePermission.role_id == UserRole.role_id).where(UserRole.user_id == user_id, UserRole.team_id == team_id, RolePermission.permission_code == permission)))) or False


def require_team(db: Session, user_id: UUID, team_id: UUID, permission: str):
    if not team_permission(db, user_id, team_id, permission):
        raise error(403, 'forbidden', 'Permission or active team membership required')


def visible_item(db: Session, item_id: UUID, user_id: UUID, permission: str = 'work_item:read') -> WorkItem:
    item = db.get(WorkItem, item_id)
    if not item or not team_permission(db, user_id, item.team_id, 'work_item:read'):
        raise error(404, 'not_found', 'Work item not found')
    if permission != 'work_item:read':
        require_team(db, user_id, item.team_id, permission)
    return item
