"""User onboarding must grant only the scope selected by an authorized admin."""

from sqlalchemy import select
from app.models import User
from app.core.security import verify_password
from tests.test_api import auth


def payload(ids, **changes):
    return {
        "full_name": "Jane Doe",
        "email": " Jane@Example.Test ",
        "password": "onboarding-password-123",
        "role_code": "ENGINEER",
        "team_id": ids["team_a"],
    } | changes


def test_user_administration_requires_global_permission(context):
    client, ids, _ = context
    for path in ["/api/v1/users", "/api/v1/roles"]:
        assert client.get(path).status_code == 401
    for name in ["lead", "engineer", "finance"]:
        headers = auth(client, name)
        assert client.get("/api/v1/users", headers=headers).status_code == 403
        assert client.get("/api/v1/roles", headers=headers).status_code == 403
        assert (
            client.post("/api/v1/users", headers=headers, json=payload(ids)).status_code
            == 403
        )


def test_new_user_gets_login_role_and_membership(context):
    client, ids, session = context
    admin = auth(client, "admin")
    created = client.post("/api/v1/users", headers=admin, json=payload(ids))
    assert created.status_code == 201
    user = created.json()
    assert user["email"] == "jane@example.test" and user["active"] is True
    assert "password" not in user and "password_hash" not in user
    with session() as db:
        stored = db.scalar(select(User).where(User.email == "jane@example.test"))
        assert verify_password("onboarding-password-123", stored.password_hash)
    directory = client.get("/api/v1/users?search=jane", headers=admin).json()
    assert directory["total"] == 1
    assert directory["items"][0]["grants"] == [
        {"role_code": "ENGINEER", "team_id": ids["team_a"], "team_name": "A"}
    ]
    assert "password_hash" not in directory["items"][0]
    members = client.get(
        f"/api/v1/teams/{ids['team_a']}/members", headers=admin
    ).json()["items"]
    assert user["id"] in {member["id"] for member in members}
    token = client.post(
        "/api/v1/auth/login",
        json={"email": user["email"], "password": "onboarding-password-123"},
    ).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    access = client.get("/api/v1/auth/access", headers=headers).json()
    assert access["global_permissions"] == []
    assert access["teams"][0]["team_id"] == ids["team_a"]
    assert "work_item:create" in access["teams"][0]["permissions"]
    assert "user:manage" not in access["teams"][0]["permissions"]
    assert client.get("/api/v1/users", headers=headers).status_code == 403
    assert (
        client.post("/api/v1/users", headers=admin, json=payload(ids)).status_code
        == 409
    )
    assert client.get("/api/v1/users?search=jane", headers=admin).json()["total"] == 1


def test_role_options_match_creation_scope_and_validation(context):
    client, ids, _ = context
    admin = auth(client, "admin")
    options = client.get("/api/v1/roles", headers=admin).json()["items"]
    assert {role["code"] for role in options} == {
        "ADMIN",
        "TEAM_LEAD",
        "ENGINEER",
        "SUPPORT_AGENT",
        "FINANCE",
        "MANAGER",
    }
    assert (
        next(role for role in options if role["code"] == "ADMIN")["requires_team"]
        is False
    )
    assert (
        next(role for role in options if role["code"] == "ENGINEER")["requires_team"]
        is True
    )
    for changes in [{"team_id": None}, {"role_code": "UNKNOWN"}, {"password": "short"}]:
        assert (
            client.post(
                "/api/v1/users", headers=admin, json=payload(ids, **changes)
            ).status_code
            == 422
        )
    global_admin = client.post(
        "/api/v1/users",
        headers=admin,
        json=payload(ids, email="global@example.test", role_code="ADMIN", team_id=None),
    )
    assert global_admin.status_code == 201
    token = client.post(
        "/api/v1/auth/login",
        json={"email": "global@example.test", "password": "onboarding-password-123"},
    ).json()["access_token"]
    assert (
        client.get(
            "/api/v1/users", headers={"Authorization": f"Bearer {token}"}
        ).status_code
        == 200
    )
    team_admin = client.post(
        "/api/v1/users",
        headers=admin,
        json=payload(ids, email="teamadmin@example.test", role_code="ADMIN"),
    )
    assert team_admin.status_code == 201
    token = client.post(
        "/api/v1/auth/login",
        json={"email": "teamadmin@example.test", "password": "onboarding-password-123"},
    ).json()["access_token"]
    assert (
        client.get(
            "/api/v1/users", headers={"Authorization": f"Bearer {token}"}
        ).status_code
        == 403
    )


def test_user_directory_pagination_and_search(context):
    client, _, _ = context
    admin = auth(client, "admin")
    first = client.get("/api/v1/users?page=1&page_size=1", headers=admin).json()
    second = client.get("/api/v1/users?page=2&page_size=1", headers=admin).json()
    assert first["total"] == 5 and len(first["items"]) == 1
    assert first["items"][0]["id"] != second["items"][0]["id"]
    result = client.get("/api/v1/users?search=LEAD@EXAMPLE", headers=admin).json()
    assert result["total"] == 1 and result["items"][0]["full_name"] == "lead"
    assert client.get("/api/v1/users?page=0", headers=admin).status_code == 422
