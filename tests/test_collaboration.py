from types import SimpleNamespace

import httpx
import pytest
from fastapi import HTTPException

from app.services import summaries
from test_api import auth, create


def test_private_bookmarks_and_access(context):
    client, ids, _ = context
    lead, engineer, outsider = (
        auth(client, n) for n in ("lead", "engineer", "outsider")
    )
    item = create(client, ids, lead).json()
    path = f"/api/v1/work-items/{item['id']}/bookmark"
    assert client.get(path).status_code == 401
    assert client.put(path, headers=outsider).status_code == 404
    assert client.get(path, headers=lead).json() == {"bookmarked": False}
    for _ in range(2):
        assert client.put(path, headers=lead).json() == {"bookmarked": True}
    assert client.get(path, headers=engineer).json() == {"bookmarked": False}
    assert (
        client.get("/api/v1/work-items?bookmarked=true", headers=lead).json()["total"]
        == 1
    )
    assert (
        client.get("/api/v1/work-items?bookmarked=true", headers=engineer).json()[
            "total"
        ]
        == 0
    )
    for _ in range(2):
        assert client.delete(path, headers=lead).status_code == 204
    assert (
        client.get("/api/v1/work-items?bookmarked=true", headers=lead).json()["total"]
        == 0
    )


def test_comments_shared_validated_and_scoped(context):
    client, ids, _ = context
    lead, engineer, outsider = (
        auth(client, n) for n in ("lead", "engineer", "outsider")
    )
    item = create(client, ids, lead).json()
    path = f"/api/v1/work-items/{item['id']}/comments"
    assert (
        client.post(path, headers=outsider, json={"body": "hidden"}).status_code == 404
    )
    assert client.get(path, headers=outsider).status_code == 404
    for text in (" ", "x" * 10001):
        assert (
            client.post(path, headers=engineer, json={"body": text}).status_code == 422
        )
    response = client.post(
        path,
        headers=engineer,
        json={"body": "  Checking logs <script>alert(1)</script>  "},
    )
    assert response.status_code == 201
    assert response.json()["author_id"] == ids["engineer"]
    listing = client.get(path + "?page_size=1", headers=lead).json()
    assert listing["total"] == 1
    assert listing["items"][0]["author_name"] == "engineer"
    assert listing["items"][0]["body"].startswith("Checking")
    assert (
        client.get(f"/api/v1/work-items/{item['id']}", headers=lead).json()["version"]
        == 1
    )


def test_summary_access_and_context(context, monkeypatch):
    client, ids, _ = context
    lead, outsider = (auth(client, n) for n in ("lead", "outsider"))
    item = create(client, ids, lead, description="Problem details").json()
    path = f"/api/v1/work-items/{item['id']}"
    client.post(path + "/comments", headers=lead, json={"body": "Investigating now"})
    calls = []
    monkeypatch.setattr(
        "app.api.collaboration.summarize",
        lambda text: calls.append(text) or "Short summary",
    )
    assert client.post(path + "/summary", headers=outsider).status_code == 404
    assert calls == []
    result = client.post(path + "/summary", headers=lead)
    assert result.status_code == 200 and result.json()["summary"] == "Short summary"
    assert "Problem details" in calls[0] and "Investigating now" in calls[0]
    assert "password" not in calls[0]


def test_groq_configuration_limit_and_errors(monkeypatch):
    config = SimpleNamespace(groq_api_key="", groq_model="test-model")
    monkeypatch.setattr(summaries, "get_settings", lambda: config)
    with pytest.raises(HTTPException) as missing:
        summaries.summarize("issue")
    assert missing.value.status_code == 503
    config.groq_api_key = "private-test-key"

    def fake_post(url, **kwargs):
        assert kwargs["headers"]["Authorization"] == "Bearer private-test-key"
        assert kwargs["json"]["messages"][1]["content"] == "issue"
        return httpx.Response(
            200,
            request=httpx.Request("POST", url),
            json={"choices": [{"message": {"content": "word " * 125}}]},
        )

    monkeypatch.setattr(summaries.httpx, "post", fake_post)
    assert len(summaries.summarize("issue").split()) == 125
    for status, expected in [(429, 429), (401, 502), (500, 502)]:
        monkeypatch.setattr(
            summaries.httpx,
            "post",
            lambda url, **kw: httpx.Response(
                status,
                request=httpx.Request("POST", url),
                text="provider secret details",
            ),
        )
        with pytest.raises(HTTPException) as failure:
            summaries.summarize("issue")
        assert failure.value.status_code == expected
        assert "private-test-key" not in str(failure.value.detail)
        assert "provider secret" not in str(failure.value.detail)


@pytest.mark.parametrize(
    "initial", ["too short", "word " * 300, "## Heading\n- " + "word " * 125]
)
def test_summary_repairs_invalid_length_or_markdown(monkeypatch, initial):
    monkeypatch.setattr(
        summaries,
        "get_settings",
        lambda: SimpleNamespace(groq_api_key="test", groq_model="test"),
    )
    calls = []

    def fake_post(url, **kwargs):
        calls.append(len(kwargs["json"]["messages"]))
        content = initial if len(calls) == 1 else "word \n" * 125
        return httpx.Response(
            200,
            request=httpx.Request("POST", url),
            json={"choices": [{"message": {"content": content}}]},
        )

    monkeypatch.setattr(summaries.httpx, "post", fake_post)
    output = summaries.summarize("issue")
    assert 100 <= len(output.split()) <= 150 and "\n" not in output
    assert calls == ([2, 4] if initial == "too short" else [2])


def test_summary_rejects_repeated_invalid_output(monkeypatch):
    monkeypatch.setattr(
        summaries,
        "get_settings",
        lambda: SimpleNamespace(groq_api_key="test", groq_model="test"),
    )
    monkeypatch.setattr(
        summaries.httpx,
        "post",
        lambda url, **kw: httpx.Response(
            200,
            request=httpx.Request("POST", url),
            json={"choices": [{"message": {"content": "Short invalid output"}}]},
        ),
    )
    with pytest.raises(HTTPException) as failure:
        summaries.summarize("issue")
    assert failure.value.detail["code"] == "summary_invalid_format"


def test_overlong_summary_keeps_complete_paragraph_without_rewrite(monkeypatch):
    monkeypatch.setattr(
        summaries,
        "get_settings",
        lambda: SimpleNamespace(groq_api_key="test", groq_model="test"),
    )
    calls = []

    def fake_post(url, **kwargs):
        calls.append(True)
        return httpx.Response(
            200,
            request=httpx.Request("POST", url),
            json={
                "choices": [
                    {
                        "message": {
                            "content": "Known issue details are still being investigated by the team. "
                            * 55
                        }
                    }
                ]
            },
        )

    monkeypatch.setattr(summaries.httpx, "post", fake_post)
    output = summaries.summarize("issue")
    assert 100 <= len(output.split()) <= 150
    assert output.endswith("team.")
    assert len(calls) == 1


def test_plain_paragraph_removes_markdown():
    output = summaries.fit_paragraph(
        "## Status\n\n- **Investigating** [runbook](https://example.com).\n\n"
        + "Known details are under review. " * 85
    )
    assert output is not None
    assert not any(marker in output for marker in ["#", "**", "\n", "[", "]"])
    assert output.startswith("Status Investigating runbook.")
