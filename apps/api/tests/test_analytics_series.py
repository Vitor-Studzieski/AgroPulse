from datetime import datetime, timedelta, timezone

from bson import ObjectId
from fastapi.testclient import TestClient

from app import deps
from app.config import settings
from app.main import app
from app.routers import analytics
from app.security import current_user


class FakeCursor:
    def __init__(self, documents):
        self.documents = list(documents)

    def sort(self, key, direction):
        self.documents.sort(key=lambda document: document[key], reverse=direction < 0)
        return self

    async def to_list(self, length=None):
        return self.documents if length is None else self.documents[:length]


class FakeStats:
    def __init__(self, documents):
        self.documents = documents
        self.last_query = None

    def find(self, query):
        self.last_query = query
        start, end = query["day"]["$gte"], query["day"]["$lt"]
        return FakeCursor(
            document
            for document in self.documents
            if document["field_id"] == query["field_id"] and start <= document["day"] < end
        )


class FakeSensorReadings:
    def __init__(self, documents):
        self.documents = documents
        self.last_pipeline = None

    async def aggregate(self, pipeline):
        self.last_pipeline = pipeline
        return FakeCursor(self.documents)


class FakeDatabase:
    def __init__(self, owner_id, farm_id, field_id, summaries, raw_points):
        self.farms = type(
            "Farms",
            (),
            {"find_one": lambda collection, query, projection=None: None},
        )()
        self.farms.find_one = self._find_farm(owner_id, farm_id)
        self.fields = type("Fields", (), {})()
        self.fields.find_one = self._find_field(farm_id, field_id)
        self.field_daily_stats = FakeStats(summaries)
        self.sensor_readings = FakeSensorReadings(raw_points)

    @staticmethod
    def _find_farm(owner_id, farm_id):
        async def find_one(query, projection=None):
            if query == {"_id": farm_id, "owner_id": owner_id}:
                return {"_id": farm_id, "owner_id": owner_id}
            return None

        return find_one

    @staticmethod
    def _find_field(farm_id, field_id):
        async def find_one(query, projection=None):
            if query == {"_id": field_id}:
                return {"_id": field_id, "farm_id": farm_id}
            return None

        return find_one


def test_daily_series_joins_archived_stats_and_recent_raw_data(monkeypatch):
    owner_id, farm_id, field_id = ObjectId(), ObjectId(), ObjectId()
    now = datetime.now(timezone.utc)
    ttl_days = 30
    monkeypatch.setattr(settings, "readings_ttl_days", ttl_days)
    cutoff = now - timedelta(days=ttl_days)
    raw_start = cutoff.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
    old_day = (now - timedelta(days=89)).replace(hour=0, minute=0, second=0, microsecond=0)
    cutoff_day = cutoff.replace(hour=0, minute=0, second=0, microsecond=0)
    raw_day = raw_start + timedelta(days=2)
    later_raw_day = raw_start + timedelta(days=5)
    summaries = [
        {
            "field_id": field_id,
            "day": cutoff_day,
            "moisture_avg": 19,
            "moisture_min": 12,
            "moisture_max": 28,
            "readings": 80,
        },
        {
            "field_id": field_id,
            "day": old_day,
            "moisture_avg": 14,
            "moisture_min": 8,
            "moisture_max": 20,
            "readings": 100,
        },
    ]
    raw_points = [
        {"bucket": later_raw_day, "value": 32, "min": 25, "max": 39, "readings": 12},
        {"bucket": raw_day, "value": 27, "min": 21, "max": 34, "readings": 24},
    ]
    database = FakeDatabase(owner_id, farm_id, field_id, summaries, raw_points)
    monkeypatch.setattr(deps, "db", database)
    monkeypatch.setattr(analytics, "db", database)
    app.dependency_overrides[current_user] = lambda: {"_id": owner_id, "role": "produtor"}
    try:
        response = TestClient(app).get(
            f"/analytics/fields/{field_id}/series",
            params={"metric": "soil_moisture", "unit": "day", "days": 90},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    points = response.json()
    assert [point["bucket"] for point in points] == [
        old_day.isoformat().replace("+00:00", "Z"),
        cutoff_day.isoformat().replace("+00:00", "Z"),
        raw_day.isoformat().replace("+00:00", "Z"),
        later_raw_day.isoformat().replace("+00:00", "Z"),
    ]
    assert [point["value"] for point in points] == [14, 19, 27, 32]
    assert points[0]["min"] == 8 and points[0]["max"] == 20
    assert database.field_daily_stats.last_query["day"]["$lt"] == raw_start
    assert database.sensor_readings.last_pipeline[0]["$match"]["ts"]["$gte"] == raw_start
