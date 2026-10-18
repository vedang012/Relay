"""Explicit development seed. Run only against a disposable local database."""

import os
from sqlalchemy import select
from app.core.security import hash_password
from app.db.session import SessionLocal
from app.models import Membership, Role, Team, User, UserRole

from app.services.role_catalog import ROLE_PERMISSIONS, ensure_role_catalog  # noqa: F401 (public test/seed catalog)


def main():
    password = os.environ.get("DEV_ADMIN_PASSWORD")
    if not password or len(password) < 12:
        raise SystemExit("Set DEV_ADMIN_PASSWORD to at least 12 characters")
    with SessionLocal() as db:
        ensure_role_catalog(db)
        team = db.scalar(select(Team).where(Team.name == "Example Operations"))
        if not team:
            team = Team(name="Example Operations", description="Development team")
            db.add(team)
            db.flush()
        admin = db.scalar(select(User).where(User.email == "admin@example.test"))
        if not admin:
            admin = User(
                full_name="Development Admin",
                email="admin@example.test",
                password_hash=hash_password(password),
            )
            db.add(admin)
            db.flush()
        admin_role = db.scalar(select(Role).where(Role.code == "ADMIN"))
        if not db.scalar(
            select(UserRole).where(
                UserRole.user_id == admin.id,
                UserRole.role_id == admin_role.id,
                UserRole.team_id.is_(None),
            )
        ):
            db.add(UserRole(user_id=admin.id, role_id=admin_role.id))
        if not db.get(Membership, (admin.id, team.id)):
            db.add(Membership(user_id=admin.id, team_id=team.id))
        db.commit()
        print(f"Seeded admin@example.test and team {team.id}")


if __name__ == "__main__":
    main()
