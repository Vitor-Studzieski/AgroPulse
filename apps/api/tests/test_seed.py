import asyncio
from copy import deepcopy

from bson import ObjectId

from app import seed


class FakeResult:
    def __init__(self, inserted_id):
        self.inserted_id = inserted_id


class FakeCollection:
    def __init__(self):
        self.documents = []

    async def find_one(self, query, projection=None):
        document = next(
            (
                item
                for item in self.documents
                if all(item.get(key) == value for key, value in query.items())
            ),
            None,
        )
        return deepcopy(document)

    async def insert_one(self, document):
        saved = deepcopy(document)
        saved["_id"] = ObjectId()
        self.documents.append(saved)
        return FakeResult(saved["_id"])

    async def update_one(self, query, update, upsert=False):
        document = next(
            (
                item
                for item in self.documents
                if all(item.get(key) == value for key, value in query.items())
            ),
            None,
        )
        if document is not None:
            return
        if upsert:
            saved = {
                **deepcopy(query),
                **deepcopy(update.get("$setOnInsert", {})),
                "_id": ObjectId(),
            }
            self.documents.append(saved)


class FakeDatabase:
    def __init__(self):
        self.users = FakeCollection()
        self.farms = FakeCollection()
        self.fields = FakeCollection()
        self.sensors = FakeCollection()
        self.alert_rules = FakeCollection()


def test_seed_is_repeatable_and_repairs_partial_sensor_data(monkeypatch):
    database = FakeDatabase()
    monkeypatch.setattr(seed, "db", database)

    asyncio.run(seed.seed(fields_count=3, sensors_per_field=2))
    database.sensors.documents = [
        sensor for sensor in database.sensors.documents if sensor["device_id"] != "AP-0002-02"
    ]
    database.alert_rules.documents.pop()

    asyncio.run(seed.seed(fields_count=3, sensors_per_field=2))

    assert len(database.users.documents) == 1
    assert len(database.farms.documents) == 1
    assert len(database.fields.documents) == 3
    assert len(database.sensors.documents) == 6
    assert len({sensor["device_id"] for sensor in database.sensors.documents}) == 6
    assert len(database.alert_rules.documents) == 3
    assert {rule["field_id"] for rule in database.alert_rules.documents} == {
        field["_id"] for field in database.fields.documents
    }
