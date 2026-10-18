"""Built-in role catalog shared by account provisioning and development seeding."""

from sqlalchemy import select
from app.models import Permission, Role, RolePermission

ROLE_PERMISSIONS = {
    "ADMIN": {
        "user:manage",
        "team:manage",
        "work_item:create",
        "work_item:read",
        "work_item:update",
        "work_item:assign",
        "work_item:transition",
        "work_item:close",
        "approval:request",
    },
    "TEAM_LEAD": {
        "team:manage",
        "work_item:create",
        "work_item:read",
        "work_item:update",
        "work_item:assign",
        "work_item:transition",
        "work_item:close",
        "approval:request",
        "approval:decide",
    },
    "ENGINEER": {
        "work_item:create",
        "work_item:read",
        "work_item:update",
        "work_item:transition",
        "approval:request",
    },
    "SUPPORT_AGENT": {
        "work_item:create",
        "work_item:read",
        "work_item:update",
        "work_item:transition",
        "approval:request",
    },
    "FINANCE": {"work_item:read", "approval:decide"},
    "MANAGER": {"work_item:read", "work_item:transition", "approval:decide"},
}


def ensure_role_catalog(db):
    for code in set().union(*ROLE_PERMISSIONS.values()):
        if not db.get(Permission, code):
            db.add(Permission(code=code))
    db.flush()
    for code, permissions in ROLE_PERMISSIONS.items():
        role = db.scalar(select(Role).where(Role.code == code))
        if not role:
            role = Role(code=code)
            db.add(role)
            db.flush()
        for permission in permissions:
            if not db.get(RolePermission, (role.id, permission)):
                db.add(RolePermission(role_id=role.id, permission_code=permission))
    db.flush()
