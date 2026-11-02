from copy import deepcopy
from datetime import datetime, timedelta, timezone

from bson import ObjectId
from fastapi.testclient import TestClient

from app import deps
from app.main import app
from app.routers import alert_rules, alerts, operations, seasons, sensors
from app.security import current_user


class FakeInsertResult:
    def __init__(self, inserted_id):
        self.inserted_id = inserted_id


class FakeCursor:
    def __init__(self, documents):
        self.documents = list(documents)

    def sort(self, key, direction):
        self.documents.sort(key=lambda document: document.get(key), reverse=direction < 0)
        return self

    def skip(self, count):
        self.documents = self.documents[count:]
        return self

    def limit(self, count):
        self.documents = self.documents[:count]
        return self

    async def to_list(self, length=None):
        documents = self.documents if length is None else self.documents[:length]
        return deepcopy(documents)

    def __aiter__(self):
        self._iterator = iter(self.documents)
        return self

    async def __anext__(self):
        try:
            return deepcopy(next(self._iterator))
        except StopIteration as error:
            raise StopAsyncIteration from error


class FakeCollection:
    def __init__(self, documents=(), unique_fields=()):
        self.documents = [deepcopy(document) for document in documents]
        self.unique_fields = unique_fields

    @staticmethod
    def matches(document, query):
        for key, expected in query.items():
            actual = document.get(key)
            if isinstance(expected, dict):
                if "$in" in expected and actual not in expected["$in"]:
                    return False
                if "$ne" in expected and actual == expected["$ne"]:
                    return False
            elif actual != expected:
                return False
        return True

    async def find_one(self, query, projection=None):
        document = next((d for d in self.documents if self.matches(d, query)), None)
        return deepcopy(document) if document is not None else None

    def find(self, query, projection=None):
        return FakeCursor(d for d in self.documents if self.matches(d, query))

    async def insert_one(self, document):
        saved = deepcopy(document)
        inserted_id = saved.get("_id", ObjectId())
        if any(existing.get("_id") == inserted_id for existing in self.documents):
            from pymongo.errors import DuplicateKeyError

            raise DuplicateKeyError("_id_")
        for key in self.unique_fields:
            if any(existing.get(key) == saved.get(key) for existing in self.documents):
                from pymongo.errors import DuplicateKeyError

                raise DuplicateKeyError(key)
        saved["_id"] = inserted_id
        self.documents.append(saved)
        return FakeInsertResult(inserted_id)

    async def update_one(self, query, update):
        document = next((d for d in self.documents if self.matches(d, query)), None)
        if document is None:
            return
        document.update(deepcopy(update.get("$set", {})))
        for key in update.get("$unset", {}):
            document.pop(key, None)

    async def update_many(self, query, update):
        for document in self.documents:
            if self.matches(document, query):
                document.update(deepcopy(update.get("$set", {})))
                for key in update.get("$unset", {}):
                    document.pop(key, None)

    async def delete_one(self, query):
        self.documents = [d for d in self.documents if not self.matches(d, query)]

    async def delete_many(self, query):
        self.documents = [d for d in self.documents if not self.matches(d, query)]


class FakeDb:
    def __init__(self, owner_id, other_owner_id, farm_id, other_farm_id, field_id, other_field_id):
        self.farms = FakeCollection(
            [
                {"_id": farm_id, "owner_id": owner_id},
                {"_id": other_farm_id, "owner_id": other_owner_id},
            ]
        )
        self.fields = FakeCollection(
            [
                {"_id": field_id, "farm_id": farm_id, "crop": "soja"},
                {"_id": other_field_id, "farm_id": other_farm_id, "crop": "milho"},
            ]
        )
        self.seasons = FakeCollection()
        self.operations = FakeCollection()
        self.sensors = FakeCollection(unique_fields=("device_id",))
        self.alert_rules = FakeCollection()
        self.alerts = FakeCollection()


def make_client(monkeypatch):
    owner_id, other_owner_id = ObjectId(), ObjectId()
    farm_id, other_farm_id = ObjectId(), ObjectId()
    field_id, other_field_id = ObjectId(), ObjectId()
    fake_db = FakeDb(owner_id, other_owner_id, farm_id, other_farm_id, field_id, other_field_id)
    for module in (deps, seasons, operations, sensors, alert_rules, alerts):
        monkeypatch.setattr(module, "db", fake_db)
    app.dependency_overrides[current_user] = lambda: {"_id": owner_id, "role": "produtor"}
    client = TestClient(app)
    return (
        client,
        fake_db,
        {
            "owner": owner_id,
            "other_owner": other_owner_id,
            "field": field_id,
            "other_field": other_field_id,
            "farm": farm_id,
        },
    )


def test_season_crud_derives_crop_and_hides_other_owners(monkeypatch):
    client, fake_db, ids = make_client(monkeypatch)
    planting_date = datetime(2026, 9, 1, tzinfo=timezone.utc).isoformat()
    try:
        response = client.post(
            "/seasons",
            json={
                "field_id": str(ids["field"]),
                "label": "2026/27",
                "planting_date": planting_date,
            },
        )
        assert response.status_code == 201
        season_id = response.json()["id"]
        assert response.json()["crop"] == "soja"
        assert fake_db.seasons.documents[0]["field_id"] == ids["field"]
        assert "harvest_date" not in fake_db.seasons.documents[0]

        listed = client.get("/seasons", params={"field_id": str(ids["field"])})
        assert listed.status_code == 200 and len(listed.json()) == 1
        assert client.get(f"/seasons/{season_id}").status_code == 200
        assert (
            client.get("/seasons", params={"field_id": str(ids["other_field"])}).status_code == 404
        )
        assert client.delete(f"/seasons/{season_id}").status_code == 204
    finally:
        app.dependency_overrides.clear()


def test_season_rejects_harvest_before_planting_and_duplicate_label(monkeypatch):
    client, _, ids = make_client(monkeypatch)
    planting_date = datetime(2026, 9, 1, tzinfo=timezone.utc).isoformat()
    try:
        invalid = client.post(
            "/seasons",
            json={
                "field_id": str(ids["field"]),
                "label": "2026/27",
                "planting_date": planting_date,
                "harvest_date": datetime(2026, 8, 1, tzinfo=timezone.utc).isoformat(),
            },
        )
        assert invalid.status_code == 422
        valid = {
            "field_id": str(ids["field"]),
            "label": "2026/27",
            "planting_date": planting_date,
        }
        assert client.post("/seasons", json=valid).status_code == 201
        assert client.post("/seasons", json=valid).status_code == 409
    finally:
        app.dependency_overrides.clear()


def test_season_compares_instants_across_offsets_on_create_and_patch(monkeypatch):
    client, fake_db, ids = make_client(monkeypatch)
    planting = "2026-09-01T10:00:00-03:00"  # 13:00Z
    earlier_harvest = "2026-09-01T12:00:00Z"
    later_harvest = "2026-09-01T14:00:00Z"
    try:
        rejected = client.post(
            "/seasons",
            json={
                "field_id": str(ids["field"]),
                "label": "offset-rejected",
                "planting_date": planting,
                "harvest_date": earlier_harvest,
            },
        )
        assert rejected.status_code == 422
        assert fake_db.seasons.documents == []

        created = client.post(
            "/seasons",
            json={
                "field_id": str(ids["field"]),
                "label": "offset-valid",
                "planting_date": planting,
                "harvest_date": later_harvest,
            },
        )
        assert created.status_code == 201
        season_id = created.json()["id"]
        invalid_patch = client.patch(
            f"/seasons/{season_id}", json={"harvest_date": earlier_harvest}
        )
        assert invalid_patch.status_code == 422
        assert fake_db.seasons.documents[0]["harvest_date"].astimezone(timezone.utc) == datetime(
            2026, 9, 1, 14, tzinfo=timezone.utc
        )
    finally:
        app.dependency_overrides.clear()


def test_season_patch_clears_nullable_values_and_rejects_null_required_fields(monkeypatch):
    client, fake_db, ids = make_client(monkeypatch)
    season_id = ObjectId()
    fake_db.seasons.documents.append(
        {
            "_id": season_id,
            "field_id": ids["field"],
            "crop": "soja",
            "label": "2026/27",
            "planting_date": datetime(2026, 9, 1, tzinfo=timezone.utc),
            "harvest_date": datetime(2027, 3, 1, tzinfo=timezone.utc),
            "expected_yield_kg_ha": 4000,
            "yield_kg_ha": 3800,
            "status": "em_andamento",
        }
    )
    try:
        response = client.patch(
            f"/seasons/{season_id}",
            json={
                "harvest_date": None,
                "expected_yield_kg_ha": None,
                "yield_kg_ha": None,
            },
        )
        assert response.status_code == 200
        assert response.json()["harvest_date"] is None
        assert response.json()["expected_yield_kg_ha"] is None
        assert response.json()["yield_kg_ha"] is None
        assert not {
            "harvest_date",
            "expected_yield_kg_ha",
            "yield_kg_ha",
        } & fake_db.seasons.documents[0].keys()
        assert client.patch(f"/seasons/{season_id}", json={"status": None}).status_code == 422
    finally:
        app.dependency_overrides.clear()


def test_operation_requires_owned_field_and_same_field_season(monkeypatch):
    client, fake_db, ids = make_client(monkeypatch)
    planting_date = datetime(2026, 9, 1, tzinfo=timezone.utc)
    season_id = ObjectId()
    fake_db.seasons.documents.append(
        {"_id": season_id, "field_id": ids["field"], "crop": "soja", "label": "2026/27"}
    )
    try:
        body = {
            "field_id": str(ids["field"]),
            "season_id": str(season_id),
            "type": "adubacao",
            "date": planting_date.isoformat(),
            "cost_brl": 25.5,
            "details": {"product": "NPK", "dose": "100 kg/ha"},
        }
        created = client.post("/operations", json=body)
        assert created.status_code == 201
        operation_id = created.json()["id"]
        assert fake_db.operations.documents[0]["season_id"] == season_id
        assert (
            client.get("/operations", params={"field_id": str(ids["field"])}).json()[0]["type"]
            == "adubacao"
        )
        changed = client.patch(f"/operations/{operation_id}", json={"cost_brl": 30})
        assert changed.status_code == 200 and changed.json()["cost_brl"] == 30
        cleared = client.patch(
            f"/operations/{operation_id}", json={"season_id": None, "cost_brl": None}
        )
        assert cleared.status_code == 200
        assert cleared.json()["season_id"] is None and cleared.json()["cost_brl"] is None
        assert "season_id" not in fake_db.operations.documents[0]
        assert "cost_brl" not in fake_db.operations.documents[0]
        assert client.patch(f"/operations/{operation_id}", json={"type": None}).status_code == 422
        body["field_id"] = str(ids["other_field"])
        assert client.post("/operations", json=body).status_code == 404
        assert client.delete(f"/operations/{operation_id}").status_code == 204
    finally:
        app.dependency_overrides.clear()


def test_operation_idempotency_key_replays_only_the_same_owner_and_payload(monkeypatch):
    client, fake_db, ids = make_client(monkeypatch)
    body = {
        "field_id": str(ids["field"]),
        "type": "irrigacao",
        "date": "2026-09-01T00:00:00Z",
        "cost_brl": 25.5,
        "details": {"method": "synthetic"},
    }
    headers = {"Idempotency-Key": "retry-key-001"}
    try:
        created = client.post("/operations", json=body, headers=headers)
        assert created.status_code == 201
        replay = client.post("/operations", json=body, headers=headers)
        assert replay.status_code == 200
        assert replay.json()["id"] == created.json()["id"]
        assert len(fake_db.operations.documents) == 1

        reused = client.post(
            "/operations", json={**body, "cost_brl": 30}, headers=headers
        )
        assert reused.status_code == 409
        assert len(fake_db.operations.documents) == 1

        first_unkeyed = client.post("/operations", json=body)
        second_unkeyed = client.post("/operations", json=body)
        assert first_unkeyed.status_code == second_unkeyed.status_code == 201
        assert first_unkeyed.json()["id"] != second_unkeyed.json()["id"]

        app.dependency_overrides[current_user] = lambda: {
            "_id": ids["other_owner"],
            "role": "produtor",
        }
        other_owner = client.post(
            "/operations",
            json={**body, "field_id": str(ids["other_field"])},
            headers=headers,
        )
        assert other_owner.status_code == 201
        assert other_owner.json()["id"] != created.json()["id"]
    finally:
        app.dependency_overrides.clear()


def test_extreme_nonfinite_number_returns_json_422(monkeypatch):
    client, fake_db, ids = make_client(monkeypatch)
    body = (
        '{"field_id":"'
        + str(ids["field"])
        + '","metric":"soil_moisture","operator":"lt",'
        '"threshold":1e999,"window_minutes":30}'
    )
    try:
        response = client.post(
            "/alert-rules", content=body, headers={"Content-Type": "application/json"}
        )
        assert response.status_code == 422
        assert response.json()["detail"][0]["input"] == "inf"
        assert fake_db.alert_rules.documents == []
    finally:
        app.dependency_overrides.clear()


def test_sensor_uses_farm_from_owned_field_and_handles_duplicate_device(monkeypatch):
    client, fake_db, ids = make_client(monkeypatch)
    body = {"device_id": "AP-001", "field_id": str(ids["field"])}
    try:
        created = client.post("/sensors", json=body)
        assert created.status_code == 201
        assert created.json()["farm_id"] == str(ids["farm"])
        assert fake_db.sensors.documents[0]["farm_id"] == ids["farm"]
        assert client.post("/sensors", json=body).status_code == 409
        assert (
            client.get("/sensors", params={"field_id": str(ids["other_field"])}).status_code == 404
        )
        sensor_id = created.json()["id"]
        assert (
            client.patch(f"/sensors/{sensor_id}", json={"active": False}).json()["active"] is False
        )
        assert client.delete(f"/sensors/{sensor_id}").status_code == 204
    finally:
        app.dependency_overrides.clear()


def test_alert_rule_crud_and_owner_filter(monkeypatch):
    client, fake_db, ids = make_client(monkeypatch)
    body = {
        "field_id": str(ids["field"]),
        "metric": "soil_moisture",
        "operator": "lt",
        "threshold": 20,
        "window_minutes": 30,
    }
    try:
        created = client.post("/alert-rules", json=body)
        assert created.status_code == 201
        rule_id = created.json()["id"]
        assert created.json()["active"] is True
        assert (
            client.post("/alert-rules", json={**body, "owner_id": str(ids["owner"])}).status_code
            == 422
        )
        assert len(client.get("/alert-rules").json()) == 1
        assert (
            client.get("/alert-rules", params={"field_id": str(ids["other_field"])}).status_code
            == 404
        )
        updated = client.patch(f"/alert-rules/{rule_id}", json={"threshold": 18, "active": False})
        assert updated.status_code == 200
        assert updated.json()["threshold"] == 18 and updated.json()["active"] is False
        assert client.delete(f"/alert-rules/{rule_id}").status_code == 204
        assert client.post("/alert-rules", json={**body, "window_minutes": 0}).status_code == 422
    finally:
        app.dependency_overrides.clear()


def test_alert_crud_checks_rule_field_and_tracks_resolution(monkeypatch):
    client, fake_db, ids = make_client(monkeypatch)
    rule_id = ObjectId()
    fake_db.alert_rules.documents.append(
        {
            "_id": rule_id,
            "field_id": ids["field"],
            "metric": "soil_moisture",
            "operator": "lt",
            "threshold": 20,
            "window_minutes": 30,
            "active": True,
        }
    )
    body = {
        "rule_id": str(rule_id),
        "field_id": str(ids["field"]),
        "metric": "soil_moisture",
        "value": 15.2,
        "threshold": 20,
        "triggered_at": datetime(2026, 10, 1, 20, 14, 34, tzinfo=timezone.utc).isoformat(),
    }
    try:
        future_offset = (
            (datetime.now(timezone.utc) + timedelta(minutes=30))
            .astimezone(timezone(timedelta(hours=-3)))
            .isoformat()
        )
        future_alert = client.post("/alerts", json={**body, "triggered_at": future_offset})
        assert future_alert.status_code == 422
        assert fake_db.alerts.documents == []

        created = client.post("/alerts", json=body)
        assert created.status_code == 201
        alert_id = created.json()["id"]
        assert client.get("/alerts", params={"status": "open"}).json()[0]["id"] == alert_id
        assert (
            client.get("/alerts", params={"field_id": str(ids["other_field"])}).status_code == 404
        )
        invalid_resolution = client.patch(
            f"/alerts/{alert_id}",
            json={"resolved_at": datetime(2026, 10, 2, tzinfo=timezone.utc).isoformat()},
        )
        assert invalid_resolution.status_code == 422
        assert "resolved_at" not in fake_db.alerts.documents[0]
        resolved = client.patch(f"/alerts/{alert_id}", json={"status": "resolved"})
        assert resolved.status_code == 200
        assert resolved.json()["status"] == "resolved"
        assert resolved.json()["resolved_at"]
        resolved_at = resolved.json()["resolved_at"]
        repeated_resolution = client.patch(f"/alerts/{alert_id}", json={"status": "resolved"})
        assert repeated_resolution.status_code == 200
        assert repeated_resolution.json()["resolved_at"] == resolved_at
        # 21:14Z is after the alert's 20:14Z trigger despite its earlier local wall time.
        offset_resolution = client.patch(
            f"/alerts/{alert_id}",
            json={
                "status": "resolved",
                "resolved_at": "2026-10-01T18:14:34-03:00",
            },
        )
        assert offset_resolution.status_code == 200
        assert datetime.fromisoformat(offset_resolution.json()["resolved_at"]) == datetime(
            2026, 10, 1, 21, 14, 34, tzinfo=timezone.utc
        )
        future_offset_resolution = (
            (datetime.now(timezone.utc) + timedelta(minutes=30))
            .astimezone(timezone(timedelta(hours=-3)))
            .isoformat()
        )
        assert (
            client.patch(
                f"/alerts/{alert_id}",
                json={"status": "resolved", "resolved_at": future_offset_resolution},
            ).status_code
            == 422
        )
        future_resolution = client.patch(
            f"/alerts/{alert_id}",
            json={
                "status": "resolved",
                "resolved_at": datetime(2100, 1, 1, tzinfo=timezone.utc).isoformat(),
            },
        )
        assert future_resolution.status_code == 422
        reopened = client.patch(f"/alerts/{alert_id}", json={"status": "open"})
        assert reopened.status_code == 200
        assert reopened.json()["status"] == "open"
        assert reopened.json().get("resolved_at") is None
        assert client.delete(f"/alerts/{alert_id}").status_code == 204
        assert (
            client.post("/alerts", json={**body, "field_id": str(ids["other_field"])}).status_code
            == 404
        )
    finally:
        app.dependency_overrides.clear()


def test_cors_preflight_allows_idempotency_key():
    from app.config import settings

    response = TestClient(app).options(
        "/operations",
        headers={
            "Origin": settings.cors_origins.split(",")[0].strip(),
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type,idempotency-key",
        },
    )
    assert response.status_code == 200
    assert "idempotency-key" in response.headers["access-control-allow-headers"].lower()


def test_new_resources_require_authentication():
    response = TestClient(app).get("/alert-rules")
    assert response.status_code == 401
