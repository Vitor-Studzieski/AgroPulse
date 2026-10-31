from copy import deepcopy
from types import SimpleNamespace

from bson import ObjectId
from fastapi.testclient import TestClient

from app.geo import area_ha
from app.main import app
from app.routers import fields
from app.security import current_user


class FakeFarms:
    def __init__(self, owner_id, farm_id):
        self.owner_id = owner_id
        self.farm_id = farm_id

    async def find_one(self, query, projection=None):
        if query == {"_id": self.farm_id, "owner_id": self.owner_id}:
            return {"_id": self.farm_id, "owner_id": self.owner_id}
        return None


class FakeFields:
    async def insert_one(self, document):
        self.document = deepcopy(document)
        return SimpleNamespace(inserted_id=ObjectId())


def test_create_field_persists_area_and_centroid_for_polygon_with_hole(monkeypatch):
    owner_id, farm_id = ObjectId(), ObjectId()
    fake_fields = FakeFields()
    monkeypatch.setattr(
        fields,
        "db",
        SimpleNamespace(farms=FakeFarms(owner_id, farm_id), fields=fake_fields),
    )
    app.dependency_overrides[current_user] = lambda: {"_id": owner_id, "role": "produtor"}
    outer = [[-2, -2], [2, -2], [2, 2], [-2, 2], [-2, -2]]
    hole = [[-1, -1], [-1, 1], [1, 1], [1, -1], [-1, -1]]
    try:
        response = TestClient(app).post(
            "/fields",
            json={
                "farm_id": str(farm_id),
                "name": "Talhão central",
                "crop": "soja",
                "boundary": {"type": "Polygon", "coordinates": [outer, hole]},
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 201
    assert response.json()["area_ha"] == round(area_ha([outer, hole]), 2)
    assert response.json()["centroid"]["coordinates"] == [0, 0]
    assert fake_fields.document["farm_id"] == farm_id
