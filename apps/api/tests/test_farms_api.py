from bson import ObjectId
from fastapi.testclient import TestClient

from app.main import app
from app.routers import farms
from app.security import current_user

BODY = {
    "name": "Fazenda Teste",
    "municipality": "Sorriso",
    "state": "MT",
    "location": {"type": "Point", "coordinates": [-55.72, -12.54]},
}


class FakeInsertResult:
    inserted_id = ObjectId()


class FakeFarms:
    def __init__(self):
        self.saved = None

    async def insert_one(self, document):
        self.saved = document
        return FakeInsertResult()


def make_client(monkeypatch):
    fake = FakeFarms()
    monkeypatch.setattr(farms, "db", type("FakeDb", (), {"farms": fake})())
    app.dependency_overrides[current_user] = lambda: {"_id": ObjectId(), "role": "produtor"}
    return TestClient(app), fake


def test_create_farm_returns_id_and_stores_owner(monkeypatch):
    client, fake = make_client(monkeypatch)
    try:
        response = client.post("/farms", json=BODY)
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 201
    assert response.json()["id"] == str(FakeInsertResult.inserted_id)
    assert isinstance(fake.saved["owner_id"], ObjectId)


def test_invalid_state_is_rejected(monkeypatch):
    client, _ = make_client(monkeypatch)
    try:
        response = client.post("/farms", json={**BODY, "state": "mato grosso"})
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 422


def test_nonfinite_coordinates_return_json_422(monkeypatch):
    client, fake = make_client(monkeypatch)
    body = (
        '{"name":"Fazenda Teste","municipality":"Sorriso","state":"MT",'
        '"location":{"type":"Point","coordinates":[NaN,-12.54]}}'
    )
    try:
        response = client.post(
            "/farms", content=body, headers={"Content-Type": "application/json"}
        )
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 422
    assert response.json()["detail"][0]["input"][0] == "nan"
    assert fake.saved is None


def test_protected_route_requires_token():
    response = TestClient(app).get("/farms")
    assert response.status_code == 401
