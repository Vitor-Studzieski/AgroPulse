import argparse
import asyncio
from datetime import datetime, timezone

from app.db import client, db
from app.geo import area_ha, centroid, square
from app.security import hash_password

DEMO_EMAIL = "demo@agropulse.dev"
DEMO_PASSWORD = "demo12345"
FARM_NAME = "Área demonstrativa Fatec Pompéia"
LEGACY_FARM_NAME = "Fazenda Santa Clara"
BASE_LON = -50.1994
BASE_LAT = -22.1110
CROPS = ["soja", "milho", "cana"]


async def ensure_user(now):
    user = await db.users.find_one({"email": DEMO_EMAIL})
    if user:
        return user["_id"]
    result = await db.users.insert_one(
        {
            "name": "Produtor Demo",
            "email": DEMO_EMAIL,
            "password_hash": hash_password(DEMO_PASSWORD),
            "role": "produtor",
            "created_at": now,
        }
    )
    return result.inserted_id


async def ensure_farm(owner_id, now):
    farm = await db.farms.find_one({"owner_id": owner_id, "name": FARM_NAME})
    if farm is None:
        farm = await db.farms.find_one(
            {"owner_id": owner_id, "name": LEGACY_FARM_NAME}
        )

    document = {
        "name": FARM_NAME,
        "municipality": "Pompéia",
        "state": "SP",
        "location": {"type": "Point", "coordinates": [BASE_LON, BASE_LAT]},
    }
    if farm:
        await db.farms.update_one({"_id": farm["_id"]}, {"$set": document})
        return farm["_id"]

    result = await db.farms.insert_one({**document, "owner_id": owner_id, "created_at": now})
    return result.inserted_id


async def ensure_field(farm_id, index, now):
    document = build_field(farm_id, index, now)
    identity = {"farm_id": farm_id, "name": document["name"]}
    existing = await db.fields.find_one(identity, {"_id": 1})
    if existing:
        # These are generated demonstration geometries. Keep them aligned with
        # the current campus reference when the seed is rerun.
        await db.fields.update_one(
            identity,
            {
                "$set": {
                    "area_ha": document["area_ha"],
                    "boundary": document["boundary"],
                    "centroid": document["centroid"],
                    "attributes": document["attributes"],
                }
            },
        )
    else:
        await db.fields.update_one(identity, {"$setOnInsert": document}, upsert=True)
    field = await db.fields.find_one(identity, {"_id": 1})
    return field["_id"]


async def ensure_sensor(farm_id, field_id, field_index, sensor_index):
    document = {
        "device_id": f"AP-{field_index + 1:04d}-{sensor_index + 1:02d}",
        "field_id": field_id,
        "farm_id": farm_id,
        "active": True,
    }
    await db.sensors.update_one(
        {"device_id": document["device_id"]},
        {"$setOnInsert": document},
        upsert=True,
    )


async def ensure_alert_rule(field_id):
    identity = {
        "field_id": field_id,
        "metric": "soil_moisture",
        "operator": "lt",
        "window_minutes": 30,
    }
    document = {**identity, "threshold": 20.0, "active": True}
    await db.alert_rules.update_one(identity, {"$setOnInsert": document}, upsert=True)


def build_field(farm_id, index, now):
    spacing = 0.002
    lon = BASE_LON + (index % 2) * spacing
    lat = BASE_LAT + (index // 2) * spacing
    # Small synthetic polygons around the campus make the map useful in a
    # presentation without implying that these are surveyed farm boundaries.
    boundary = square(lon, lat, 0.1 + (index % 3) * 0.02)
    ring = boundary["coordinates"][0]
    return {
        "farm_id": farm_id,
        "name": f"Talhão {index + 1:03d}",
        "crop": CROPS[index % len(CROPS)],
        "area_ha": round(area_ha(ring), 2),
        "boundary": boundary,
        "centroid": centroid(ring),
        "attributes": {"origem": "sintética", "uso": "demonstração"},
        "created_at": now,
    }


async def seed(fields_count, sensors_per_field):
    if fields_count < 1 or sensors_per_field < 1:
        raise ValueError("fields e sensors-per-field devem ser positivos")
    now = datetime.now(timezone.utc)
    owner_id = await ensure_user(now)
    farm_id = await ensure_farm(owner_id, now)

    field_ids = []
    for index in range(fields_count):
        field_id = await ensure_field(farm_id, index, now)
        field_ids.append(field_id)
        for sensor_index in range(sensors_per_field):
            await ensure_sensor(farm_id, field_id, index, sensor_index)
        await ensure_alert_rule(field_id)

    print(
        f"garantidos: {len(field_ids)} talhões, "
        f"{len(field_ids) * sensors_per_field} sensores e {len(field_ids)} regras"
    )
    print(f"login demo: {DEMO_EMAIL} / {DEMO_PASSWORD}")


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--fields", type=int, default=3)
    parser.add_argument("--sensors-per-field", type=int, default=2)
    args = parser.parse_args()
    try:
        await seed(args.fields, args.sensors_per_field)
    finally:
        await client.close()


if __name__ == "__main__":
    asyncio.run(main())
