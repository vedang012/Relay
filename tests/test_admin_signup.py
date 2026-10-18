from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

from sqlalchemy import delete, select

from app.core.security import verify_password
from app.models import (
    Membership,
    Permission,
    Role,
    RolePermission,
    Team,
    User,
    UserRole,
)
from app.services.role_catalog import ROLE_PERMISSIONS

KEY = "signup-test-secret-" * 3


def payload(**changes):
    return {
        "full_name": "Production Admin",
        "email": "newadmin@example.test",
        "password": "private-password-123",
        "team_name": "New Operations",
        "signup_key": KEY,
    } | changes


def enable(monkeypatch, key=KEY):
    monkeypatch.setattr(
        "app.api.auth.get_settings", lambda: SimpleNamespace(admin_signup_key=key)
    )


def test_signup_disabled_and_bad_key_do_not_create_users(context, monkeypatch):
    client, _, sessions = context
    enable(monkeypatch, "")
    assert client.get("/api/v1/auth/signup-options").json() == {"enabled": False}
    assert client.post("/api/v1/auth/signup", json=payload()).status_code == 503
    enable(monkeypatch)
    assert (
        client.post("/api/v1/auth/signup", json=payload(signup_key="wrong")).status_code
        == 403
    )
    with sessions() as db:
        assert (
            db.scalar(select(User).where(User.email == "newadmin@example.test")) is None
        )
        assert db.scalar(select(Team).where(Team.name == "New Operations")) is None


def test_signup_provisions_catalog_admin_membership_and_login(context, monkeypatch):
    client, _, sessions = context
    enable(monkeypatch)
    # Prove the production path does not rely on a development role seed.
    with sessions() as db:
        for entity in (UserRole, RolePermission, Role, Permission):
            db.execute(delete(entity))
        db.commit()
    result = client.post(
        "/api/v1/auth/signup", json=payload(email=" NewAdmin@Example.Test ")
    )
    assert result.status_code == 201
    assert result.json()["email"] == "newadmin@example.test"
    assert "password" not in result.json() and "signup_key" not in result.json()
    login = client.post(
        "/api/v1/auth/login",
        json={"email": "newadmin@example.test", "password": "private-password-123"},
    )
    assert login.status_code == 200
    headers = {"Authorization": "Bearer " + login.json()["access_token"]}
    assert (
        "user:manage"
        in client.get("/api/v1/auth/access", headers=headers).json()[
            "global_permissions"
        ]
    )
    assert (
        client.get("/api/v1/teams", headers=headers).json()["items"][0]["name"]
        == "New Operations"
    )
    assert len(client.get("/api/v1/roles", headers=headers).json()["items"]) == len(
        ROLE_PERMISSIONS
    )
    with sessions() as db:
        account = db.scalar(select(User).where(User.email == "newadmin@example.test"))
        assert verify_password("private-password-123", account.password_hash)
        grant = db.scalar(select(UserRole).where(UserRole.user_id == account.id))
        assert grant.team_id is None
        team = db.scalar(select(Team).where(Team.name == "New Operations"))
        assert db.get(Membership, (account.id, team.id)).active


def test_signup_validation_and_duplicates_are_atomic(context, monkeypatch):
    client, _, sessions = context
    enable(monkeypatch)
    for changes in (
        {"password": "short"},
        {"full_name": " "},
        {"team_name": " "},
        {"email": "broken"},
        {"role_code": "MANAGER"},
    ):
        assert (
            client.post("/api/v1/auth/signup", json=payload(**changes)).status_code
            == 422
        )
    assert client.post("/api/v1/auth/signup", json=payload()).status_code == 201
    assert (
        client.post(
            "/api/v1/auth/signup", json=payload(team_name="Uncreated Team")
        ).json()["detail"]["code"]
        == "duplicate_email"
    )
    assert (
        client.post(
            "/api/v1/auth/signup", json=payload(email="other@example.test")
        ).json()["detail"]["code"]
        == "duplicate_team"
    )
    with sessions() as db:
        assert db.scalar(select(Team).where(Team.name == "Uncreated Team")) is None
        assert db.scalar(select(User).where(User.email == "other@example.test")) is None


def test_concurrent_signup_does_not_duplicate_accounts(context, monkeypatch):
    client, _, _ = context
    enable(monkeypatch)
    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(
            pool.map(
                lambda _: client.post(
                    "/api/v1/auth/signup", json=payload()
                ).status_code,
                range(2),
            )
        )
    assert sorted(statuses) == [201, 409]
