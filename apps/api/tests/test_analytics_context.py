from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from bson import ObjectId
from fastapi.testclient import TestClient

from app import deps
from app.main import app
from app.routers import analytics
from app.security import current_user


class FakeCursor:
    def __init__(self, documents):
        self.documents = list(documents)

    def sort(self, key, direction):
        self.documents.sort(key=lambda item: item.get(key), reverse=direction < 0)
        return self

    def limit(self, count):
        self.documents = self.documents[:count]
        return self

    async def to_list(self, length=None):
        return self.documents if length is None else self.documents[:length]


class OwnedFields:
    def __init__(self, farm_id, field_id):
        self.farm_id = farm_id
        self.field_id = field_id

    async def find_one(self, query, projection=None):
        if query == {"_id": self.field_id}:
            return {
                "_id": self.field_id,
                "farm_id": self.farm_id,
                "centroid": {"type": "Point", "coordinates": [-55.72, -12.54]},
            }
        return None


class OwnedFarms:
    def __init__(self, owner_id, farm_id):
        self.owner_id = owner_id
        self.farm_id = farm_id

    async def find_one(self, query, projection=None):
        if query == {"_id": self.farm_id, "owner_id": self.owner_id}:
            return {"_id": self.farm_id, "owner_id": self.owner_id}
        return None


def bind_owner(monkeypatch, owner_id, farm_id, field_id):
    monkeypatch.setattr(
        deps,
        "db",
        SimpleNamespace(
            fields=OwnedFields(farm_id, field_id),
            farms=OwnedFarms(owner_id, farm_id),
        ),
    )
    app.dependency_overrides[current_user] = lambda: {"_id": owner_id, "role": "produtor"}


class FakeWeather:
    def __init__(self, documents, years=()):
        self.documents = list(documents)
        self.years = list(years)
        self.query = None
        self.year_pipeline = None

    def find(self, query, projection=None):
        self.query = query
        code = query["station.code"]
        time_range = query["ts"]
        return FakeCursor(
            item
            for item in self.documents
            if item["station"]["code"] == code
            and item["ts"] >= time_range["$gte"]
            and ("$lt" not in time_range or item["ts"] < time_range["$lt"])
        )

    async def aggregate(self, pipeline):
        self.year_pipeline = pipeline
        return FakeCursor({"_id": year} for year in self.years)


def test_field_weather_returns_recent_rows_from_nearest_inmet_station(monkeypatch):
    owner_id, farm_id, field_id = ObjectId(), ObjectId(), ObjectId()
    now = datetime.now(timezone.utc)
    station = {"code": "A904", "name": "Sorriso", "state": "MT", "distance_km": 18.2}
    weather = FakeWeather(
        [
            {"station": {"code": "A904"}, "ts": now - timedelta(hours=2), "air_temp": 26.0},
            {"station": {"code": "A904"}, "ts": now - timedelta(hours=1), "air_temp": 27.0},
            {"station": {"code": "OTHER"}, "ts": now, "air_temp": 40.0},
        ],
        years=[now.year],
    )
    monkeypatch.setattr(analytics, "db", SimpleNamespace(weather_hourly=weather))

    async def nearest(max_km, field):
        assert max_km == 100
        assert field["_id"] == field_id
        return [station]

    monkeypatch.setattr(analytics, "nearby_stations", nearest)
    bind_owner(monkeypatch, owner_id, farm_id, field_id)
    try:
        response = TestClient(app).get(f"/analytics/fields/{field_id}/weather?days=1")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["station"] == station
    assert [row["air_temp"] for row in payload["readings"]] == [26.0, 27.0]
    assert payload["available_years"] == [now.year]
    assert payload["selected_year"] is None
    assert weather.query["station.code"] == "A904"
    assert weather.query["ts"]["$gte"] > now - timedelta(days=1, seconds=1)


def test_field_weather_can_query_an_imported_calendar_year(monkeypatch):
    owner_id, farm_id, field_id = ObjectId(), ObjectId(), ObjectId()
    station = {"code": "A763", "name": "MARILIA", "state": "SP", "distance_km": 27.8}
    weather = FakeWeather(
        [
            {
                "station": {"code": "A763"},
                "ts": datetime(2023, 12, 31, 23, tzinfo=timezone.utc),
                "air_temp": 19.0,
            },
            {
                "station": {"code": "A763"},
                "ts": datetime(2024, 1, 1, tzinfo=timezone.utc),
                "air_temp": 25.9,
            },
            {
                "station": {"code": "A763"},
                "ts": datetime(2024, 12, 31, 23, tzinfo=timezone.utc),
                "air_temp": 22.0,
            },
            {
                "station": {"code": "A763"},
                "ts": datetime(2025, 1, 1, tzinfo=timezone.utc),
                "air_temp": 21.0,
            },
        ],
        years=[2024, 2023],
    )
    monkeypatch.setattr(analytics, "db", SimpleNamespace(weather_hourly=weather))

    async def nearest(max_km, field):
        assert max_km == 100
        assert field["_id"] == field_id
        return [station]

    monkeypatch.setattr(analytics, "nearby_stations", nearest)
    bind_owner(monkeypatch, owner_id, farm_id, field_id)
    try:
        response = TestClient(app).get(f"/analytics/fields/{field_id}/weather?year=2024")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["station"] == station
    assert payload["available_years"] == [2024, 2023]
    assert payload["selected_year"] == 2024
    assert [row["air_temp"] for row in payload["readings"]] == [25.9, 22.0]
    assert weather.query["ts"] == {
        "$gte": datetime(2024, 1, 1, tzinfo=timezone.utc),
        "$lt": datetime(2025, 1, 1, tzinfo=timezone.utc),
    }


def test_field_weather_rejects_a_year_without_imported_rows(monkeypatch):
    owner_id, farm_id, field_id = ObjectId(), ObjectId(), ObjectId()
    weather = FakeWeather([], years=[2024])
    monkeypatch.setattr(analytics, "db", SimpleNamespace(weather_hourly=weather))

    async def nearest(max_km, field):
        return [{"code": "A763", "name": "MARILIA", "state": "SP", "distance_km": 27.8}]

    monkeypatch.setattr(analytics, "nearby_stations", nearest)
    bind_owner(monkeypatch, owner_id, farm_id, field_id)
    try:
        response = TestClient(app).get(f"/analytics/fields/{field_id}/weather?year=2023")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 422
    assert response.json()["detail"] == "ano sem dados importados para a estação"


class FakeProduction:
    def __init__(self, documents):
        self.documents = list(documents)
        self.latest_query = None
        self.ranking_match = None

    def find(self, query, projection=None):
        self.latest_query = query
        return FakeCursor(
            item
            for item in self.documents
            if all(item.get(key) == value for key, value in query.items())
        )

    async def aggregate(self, pipeline):
        self.ranking_match = pipeline[0]["$match"]
        matches = [
            item
            for item in self.documents
            if "yield_kg_ha" in item
            if all(
                item.get(key) == value
                for key, value in self.ranking_match.items()
            )
        ]
        matches.sort(key=lambda item: item["yield_kg_ha"], reverse=True)
        matches = matches[: pipeline[2]["$limit"]]
        return FakeCursor(matches)


def test_ranking_defaults_to_latest_year_in_selected_state(monkeypatch):
    production = FakeProduction(
        [
            {"crop": "soja", "state": "MT", "year": 2023},
            {"crop": "soja", "state": "MT", "year": 2024},
            {"crop": "soja", "state": "SP", "year": 2025},
            {
                "crop": "soja",
                "state": "MT",
                "year": 2024,
                "municipality": "Sorriso",
                "yield_kg_ha": 3900,
                "production_t": 165750,
                "planted_area_ha": 42500,
            },
        ]
    )
    monkeypatch.setattr(analytics, "db", SimpleNamespace(ibge_production=production))
    app.dependency_overrides[current_user] = lambda: {"_id": ObjectId(), "role": "produtor"}
    try:
        response = TestClient(app).get("/analytics/production/ranking?crop=soja&state=MT")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert production.latest_query == {"crop": "soja", "state": "MT"}
    assert production.ranking_match == {"crop": "soja", "year": 2024, "state": "MT"}
    assert response.json()[0]["year"] == 2024
