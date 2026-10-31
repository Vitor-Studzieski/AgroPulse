from fastapi.testclient import TestClient

from app import main


class FakeDatabase:
    async def command(self, name):
        assert name == "ping"
        return {"ok": 1}


def test_health_supports_get_and_head(monkeypatch):
    monkeypatch.setattr(main, "db", FakeDatabase())
    client = TestClient(main.app)

    get_response = client.get("/health")
    head_response = client.head("/health")

    assert get_response.status_code == 200
    assert get_response.json() == {"status": "ok"}
    assert head_response.status_code == 200
    assert head_response.content == b""


def test_health_openapi_exposes_only_get():
    schema = main.app.openapi()

    assert set(schema["paths"]["/health"]) == {"get"}
