"""Explicit development seed. Run only against a disposable local database."""
import os
from sqlalchemy import select
from app.core.security import hash_password
from app.db.session import SessionLocal
from app.models import Membership, Permission, Role, RolePermission, Team, User, UserRole

ROLE_PERMISSIONS = {
    'ADMIN': {'user:manage','team:manage','work_item:create','work_item:read','work_item:update','work_item:assign','work_item:transition','work_item:close','approval:request'},
    'TEAM_LEAD': {'team:manage','work_item:create','work_item:read','work_item:update','work_item:assign','work_item:transition','work_item:close','approval:request','approval:decide'},
    'ENGINEER': {'work_item:create','work_item:read','work_item:update','work_item:transition','approval:request'},
    'SUPPORT_AGENT': {'work_item:create','work_item:read','work_item:update','work_item:transition','approval:request'},
    'FINANCE': {'work_item:read','approval:decide'},
    'MANAGER': {'work_item:read','work_item:transition','approval:decide'},
}

def main():
    password = os.environ.get('DEV_ADMIN_PASSWORD')
    if not password or len(password) < 12:
        raise SystemExit('Set DEV_ADMIN_PASSWORD to at least 12 characters')
    with SessionLocal() as db:
        for code in set().union(*ROLE_PERMISSIONS.values()):
            if not db.get(Permission, code): db.add(Permission(code=code))
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
        team = db.scalar(select(Team).where(Team.name == 'Example Operations'))
        if not team:
            team = Team(name='Example Operations', description='Development team')
            db.add(team)
            db.flush()
        admin = db.scalar(select(User).where(User.email == 'admin@example.test'))
        if not admin:
            admin = User(full_name='Development Admin', email='admin@example.test', password_hash=hash_password(password))
            db.add(admin)
            db.flush()
        admin_role = db.scalar(select(Role).where(Role.code == 'ADMIN'))
        if not db.scalar(select(UserRole).where(UserRole.user_id == admin.id, UserRole.role_id == admin_role.id, UserRole.team_id.is_(None))):
            db.add(UserRole(user_id=admin.id, role_id=admin_role.id))
        if not db.get(Membership, (admin.id, team.id)):
            db.add(Membership(user_id=admin.id, team_id=team.id))
        db.commit()
        print(f'Seeded admin@example.test and team {team.id}')

if __name__ == '__main__': main()
