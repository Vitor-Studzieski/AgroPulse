import argparse
import asyncio
from datetime import datetime, timezone

from app.db import client, db
from app.geo import area_ha, centroid, square
from app.security import hash_password

DEMO_EMAIL = "demo@agropulse.dev"
DEMO_PASSWORD = "demo12345"
FARM_NAME = "Fazenda Santa Clara"
BASE_LON = -55.7211
BASE_LAT = -12.5425
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
    if farm:
        return farm["_id"]
    result = await db.farms.insert_one(
        {
            "owner_id": owner_id,
            "name": FARM_NAME,
            "municipality": "Sorriso",
            "state": "MT",
            "location": {"type": "Point", "coordinates": [BASE_LON, BASE_LAT]},
            "created_at": now,
        }
    )
    return result.inserted_id


def build_field(farm_id, index, now):
    lon = BASE_LON + (index % 10) * 0.02
    lat = BASE_LAT + (index // 10) * 0.02
    boundary = square(lon, lat, 1.0 + (index % 3) * 0.5)
    ring = boundary["coordinates"][0]
    return {
        "farm_id": farm_id,
        "name": f"Talhão {index + 1:03d}",
        "crop": CROPS[index % len(CROPS)],
        "area_ha": round(area_ha(ring), 2),
        "boundary": boundary,
        "centroid": centroid(ring),
        "attributes": {"solo": "latossolo", "irrigado": index % 2 == 0},
        "created_at": now,
    }


async def seed(fields_count, sensors_per_field):
    now = datetime.now(timezone.utc)
    owner_id = await ensure_user(now)
    farm_id = await ensure_farm(owner_id, now)

    existing = await db.fields.count_documents({"farm_id": farm_id})
    indexes = range(existing, fields_count)
    if len(indexes) == 0:
        print("nada a criar: já existem talhões suficientes")
        return

    fields = [build_field(farm_id, index, now) for index in indexes]
    inserted = await db.fields.insert_many(fields)

    sensors = []
    rules = []
    for index, field_id in zip(indexes, inserted.inserted_ids):
        for n in range(sensors_per_field):
            sensors.append(
                {
                    "device_id": f"AP-{index + 1:04d}-{n + 1:02d}",
                    "field_id": field_id,
                    "farm_id": farm_id,
                    "active": True,
                }
            )
        rules.append(
            {
                "field_id": field_id,
                "metric": "soil_moisture",
                "operator": "lt",
                "threshold": 20.0,
                "window_minutes": 30,
                "active": True,
            }
        )
    await db.sensors.insert_many(sensors)
    await db.alert_rules.insert_many(rules)
    print(f"criados: {len(fields)} talhões, {len(sensors)} sensores, {len(rules)} regras")
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
