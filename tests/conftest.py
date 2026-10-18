import os
from urllib.parse import urlparse
import pytest

url = os.getenv('TEST_DATABASE_URL')
if url and not urlparse(url.replace('postgresql+psycopg', 'postgresql')).path.endswith('_test'):
    raise RuntimeError('TEST_DATABASE_URL must name a disposable database ending in _test')
if url:
    os.environ['DATABASE_URL'] = url
os.environ.setdefault('JWT_SECRET', 'test-only-secret-for-relay-tests')

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.db.base import Base
from app.db.session import get_db
from app.main import app
from app.models import Membership, Permission, Role, RolePermission, Team, User, UserRole
from app.core.security import hash_password
from app.seed import ROLE_PERMISSIONS

engine = create_engine(url) if url else None
TestSession = sessionmaker(bind=engine, expire_on_commit=False) if engine else None

@pytest.fixture
def context():
    if engine is None:
        pytest.skip('Set TEST_DATABASE_URL to a disposable PostgreSQL database ending in _test')
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with TestSession() as db:
        for permission in set().union(*ROLE_PERMISSIONS.values()): db.add(Permission(code=permission))
        db.flush()
        roles = {}
        for name, permissions in ROLE_PERMISSIONS.items():
            role = Role(code=name); db.add(role); db.flush(); roles[name] = role
            for permission in permissions: db.add(RolePermission(role_id=role.id, permission_code=permission))
        teams = [Team(name='A'), Team(name='B')]
        db.add_all(teams); db.flush()
        users = []
        for name, role, team in [('lead','TEAM_LEAD',teams[0]), ('engineer','ENGINEER',teams[0]), ('outsider','ENGINEER',teams[1]), ('admin','ADMIN',teams[0]), ('finance','FINANCE',teams[0])]:
            user = User(full_name=name, email=f'{name}@example.test', password_hash=hash_password('correct-password-123'))
            db.add(user); db.flush(); users.append(user)
            db.add(Membership(user_id=user.id, team_id=team.id))
            db.add(UserRole(user_id=user.id, role_id=roles[role].id, team_id=None if role == 'ADMIN' else team.id))
        db.commit()
        ids = {'team_a': str(teams[0].id), 'team_b': str(teams[1].id)} | {u.full_name: str(u.id) for u in users}
    def override():
        with TestSession() as db: yield db
    app.dependency_overrides[get_db] = override
    with TestClient(app) as client:
        yield client, ids, TestSession
    app.dependency_overrides.clear()
    Base.metadata.drop_all(engine)
