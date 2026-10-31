from copy import deepcopy

from bson import ObjectId
from fastapi.testclient import TestClient

from app import deps
from app.main import app
from app.routers import auth
from app.security import current_user, hash_password, verify_password


class FakeCursor:
    def __init__(self, documents):
        self.documents = list(documents)

    async def to_list(self, length=None):
        return deepcopy(self.documents if length is None else self.documents[:length])


class FakeCollection:
    def __init__(self, documents=()):
        self.documents = [deepcopy(document) for document in documents]
        self.deleted_queries = []

    @staticmethod
    def matches(document, query):
        for key, expected in query.items():
            if key.startswith("$"):
                continue
            actual = document
            for part in key.split("."):
                actual = actual.get(part) if isinstance(actual, dict) else None
            if isinstance(expected, dict) and "$in" in expected:
                if actual not in expected["$in"]:
                    return False
            elif actual != expected:
                return False
        return True

    async def find_one(self, query, projection=None):
        document = next((item for item in self.documents if self.matches(item, query)), None)
        return deepcopy(document) if document else None

    def find(self, query, projection=None):
        return FakeCursor(item for item in self.documents if self.matches(item, query))

    async def update_one(self, query, update):
        for item in self.documents:
            if self.matches(item, query):
                item.update(deepcopy(update.get("$set", {})))
                return

    async def delete_one(self, query):
        self.deleted_queries.append(query)
        self.documents = [item for item in self.documents if not self.matches(item, query)]

    async def delete_many(self, query):
        self.deleted_queries.append(query)
        self.documents = [item for item in self.documents if not self.matches(item, query)]


class FakeDatabase:
    def __init__(self, user, farm_id, field_id, other_farm_id, other_field_id):
        self.users = FakeCollection([user])
        self.farms = FakeCollection(
            [
                {"_id": farm_id, "owner_id": user["_id"]},
                {"_id": other_farm_id, "owner_id": ObjectId()},
            ]
        )
        self.fields = FakeCollection(
            [
                {"_id": field_id, "farm_id": farm_id},
                {"_id": other_field_id, "farm_id": other_farm_id},
            ]
        )
        self.sensor_readings = FakeCollection(
            [
                {"meta": {"field_id": field_id}},
                {"meta": {"field_id": other_field_id}},
            ]
        )
        self.field_daily_stats = FakeCollection(
            [{"field_id": field_id}, {"field_id": other_field_id}]
        )
        self.alerts = FakeCollection([{"field_id": field_id}, {"field_id": other_field_id}])
        self.alert_rules = FakeCollection([{"field_id": field_id}, {"field_id": other_field_id}])
        self.operations = FakeCollection([{"field_id": field_id}, {"field_id": other_field_id}])
        self.seasons = FakeCollection([{"field_id": field_id}, {"field_id": other_field_id}])
        self.sensors = FakeCollection([{"field_id": field_id}, {"field_id": other_field_id}])


def make_client(monkeypatch):
    user_id, farm_id, field_id = ObjectId(), ObjectId(), ObjectId()
    other_farm_id, other_field_id = ObjectId(), ObjectId()
    user = {
        "_id": user_id,
        "name": "Produtora Exemplo",
        "email": "produtora@example.com",
        "password_hash": hash_password("senha-atual-123"),
        "role": "produtor",
    }
    database = FakeDatabase(user, farm_id, field_id, other_farm_id, other_field_id)
    monkeypatch.setattr(auth, "db", database)
    monkeypatch.setattr(deps, "db", database)
    app.dependency_overrides[current_user] = lambda: deepcopy(user)
    return TestClient(app), database, user, field_id


def test_update_me_requires_current_password(monkeypatch):
    client, database, _, _ = make_client(monkeypatch)
    try:
        response = client.patch(
            "/auth/me",
            json={"current_password": "senha-incorreta", "name": "Novo Nome"},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 401
    assert database.users.documents[0]["name"] == "Produtora Exemplo"


def test_update_me_changes_profile_and_password_without_exposing_hash(monkeypatch):
    client, database, user, _ = make_client(monkeypatch)
    try:
        response = client.patch(
            "/auth/me",
            json={
                "current_password": "senha-atual-123",
                "name": "Ana Produtora",
                "email": "ANA@example.com",
                "new_password": "senha-nova-456",
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json() == {
        "id": str(user["_id"]),
        "name": "Ana Produtora",
        "email": "ana@example.com",
        "role": "produtor",
    }
    saved = database.users.documents[0]
    assert verify_password("senha-nova-456", saved["password_hash"])
    assert saved["password_hash"] != user["password_hash"]


def test_delete_me_removes_owned_data_and_keeps_other_accounts_data(monkeypatch):
    client, database, _, field_id = make_client(monkeypatch)
    try:
        response = client.request(
            "DELETE", "/auth/me", json={"current_password": "senha-atual-123"}
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 204
    assert database.users.documents == []
    assert len(database.farms.documents) == 1
    assert len(database.fields.documents) == 1
    assert len(database.sensor_readings.documents) == 1
    assert database.sensor_readings.documents[0]["meta"]["field_id"] != field_id
    for collection in (
        database.field_daily_stats,
        database.alerts,
        database.alert_rules,
        database.operations,
        database.seasons,
        database.sensors,
    ):
        assert len(collection.documents) == 1
        assert collection.documents[0]["field_id"] != field_id
