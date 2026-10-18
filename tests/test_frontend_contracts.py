"""Integration coverage for read contracts required by the Relay client."""

from fastapi.testclient import TestClient
from sqlalchemy import select
from app.main import app
from app.models import Membership
from tests.test_api import auth, create


def test_directory_and_permission_scope(context):
    client, ids, session = context
    lead = auth(client, "lead")
    outsider = auth(client, "outsider")
    grants = client.get("/api/v1/auth/access", headers=lead).json()
    assert grants["global_permissions"] == []
    assert [row["team_id"] for row in grants["teams"]] == [ids["team_a"]]
    assert "work_item:assign" in grants["teams"][0]["permissions"]
    assert [
        row["id"] for row in client.get("/api/v1/teams", headers=lead).json()["items"]
    ] == [ids["team_a"]]
    members = client.get(f"/api/v1/teams/{ids['team_a']}/members", headers=lead).json()[
        "items"
    ]
    assert ids["lead"] in {row["id"] for row in members}
    assert all("password_hash" not in row for row in members)
    assert (
        client.get(
            f"/api/v1/teams/{ids['team_a']}/members", headers=outsider
        ).status_code
        == 403
    )
    with session() as db:
        membership = db.scalar(
            select(Membership).where(Membership.user_id == ids["lead"])
        )
        membership.active = False
        db.commit()
    assert client.get("/api/v1/teams", headers=lead).json()["items"] == []
    assert client.get("/api/v1/auth/access", headers=lead).json()["teams"] == []


def test_assignment_responses_and_transition_capabilities(context):
    client, ids, _ = context
    lead = auth(client, "lead")
    item = create(client, ids, lead).json()
    path = f"/api/v1/work-items/{item['id']}"
    assert item["owner_id"] is None and item["assignments"] == []
    assert item["allowed_transitions"] == ["IN_PROGRESS"]
    assigned = client.post(
        path + "/assignments",
        json={"version": 1, "user_id": ids["engineer"], "role": "OWNER"},
        headers=lead,
    )
    assert assigned.status_code == 200
    assert assigned.json()["owner_id"] == ids["engineer"]
    assert assigned.json()["assignments"] == [
        {"user_id": ids["engineer"], "role": "OWNER"}
    ]
    removed = client.request(
        "DELETE",
        path + f"/assignments/{ids['engineer']}",
        json={"version": 2},
        headers=lead,
    )
    assert removed.status_code == 200
    assert removed.json()["owner_id"] is None and removed.json()["assignments"] == []
    changed = client.post(
        path + "/transitions",
        json={"version": 3, "status": "IN_PROGRESS"},
        headers=lead,
    )
    assert changed.json()["allowed_transitions"] == ["BLOCKED", "RESOLVED"]


def test_approval_directory_visibility_and_decision_capabilities(context):
    client, ids, _ = context
    lead = auth(client, "lead")
    finance = auth(client, "finance")
    admin = auth(client, "admin")
    outsider = auth(client, "outsider")
    item = create(client, ids, lead).json()
    approval = client.post(
        "/api/v1/approvals",
        json={
            "work_item_id": item["id"],
            "version": 1,
            "type": "PAYMENT",
            "reason": "Review",
            "approver_id": ids["finance"],
        },
        headers=lead,
    ).json()
    assert client.get("/api/v1/approvals", headers=outsider).json()["total"] == 0
    request = client.get("/api/v1/approvals?page_size=1", headers=finance).json()
    assert request["total"] == 1 and request["page_size"] == 1
    assert request["items"][0]["work_item_title"] == item["title"]
    assert request["items"][0]["requester_name"] == "lead"
    assert request["items"][0]["can_decide"] is True
    assert (
        client.get("/api/v1/approvals", headers=lead).json()["items"][0]["can_decide"]
        is False
    )
    assert (
        client.get("/api/v1/approvals", headers=admin).json()["items"][0]["can_decide"]
        is False
    )
    assert (
        client.get(
            f"/api/v1/approvals?team_id={ids['team_b']}", headers=finance
        ).json()["total"]
        == 0
    )
    assert (
        client.get("/api/v1/approvals?status=INVALID", headers=finance).status_code
        == 422
    )
    client.post(
        f"/api/v1/approvals/{approval['id']}/decision",
        json={"version": 1, "status": "APPROVED"},
        headers=finance,
    )
    assert client.get("/api/v1/approvals", headers=finance).json()["total"] == 0
    assert (
        client.get("/api/v1/approvals?status=APPROVED", headers=finance).json()["total"]
        == 1
    )


def test_frontend_cors_is_limited_to_configured_origin():
    from app.core.config import get_settings

    with TestClient(app) as client:
        headers = {
            "Origin": get_settings().frontend_origin,
            "Access-Control-Request-Method": "PATCH",
            "Access-Control-Request-Headers": "authorization,content-type",
        }
        response = client.options("/api/v1/work-items", headers=headers)
        assert response.status_code == 200
        assert (
            response.headers["access-control-allow-origin"]
            == get_settings().frontend_origin
        )
        denied = client.options(
            "/api/v1/work-items",
            headers=headers | {"Origin": "https://untrusted.example.test"},
        )
        assert denied.status_code == 400
        assert "access-control-allow-origin" not in denied.headers
