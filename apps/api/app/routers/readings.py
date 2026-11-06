from fastapi import APIRouter, Depends

from app.db import db
from app.deps import get_owned_field
from app.models import ReadingLatestOut

router = APIRouter(prefix="/fields", tags=["readings"])


@router.get("/{field_id}/readings/latest", response_model=list[ReadingLatestOut])
async def latest_readings(field: dict = Depends(get_owned_field)):
    active_sensors = await db.sensors.find(
        {"field_id": field["_id"], "active": True}, {"_id": 1, "source": 1}
    ).to_list(length=None)
    simulated_ids = [
        sensor["_id"] for sensor in active_sensors
        if sensor.get("source", "simulated") == "simulated"
    ]
    real_ids = [sensor["_id"] for sensor in active_sensors if sensor.get("source") == "real"]
    source_queries = []
    if simulated_ids:
        source_queries.append(
            {
                "meta.sensor_id": {"$in": simulated_ids},
                "$or": [
                    {"meta.source": "simulated"},
                    {"meta.source": {"$exists": False}},
                ],
            }
        )
    if real_ids:
        source_queries.append(
            {"meta.sensor_id": {"$in": real_ids}, "meta.source": "real"}
        )
    if not source_queries:
        return []
    pipeline = [
        {
            "$match": {
                "meta.field_id": field["_id"],
                "$or": source_queries,
            }
        },
        {"$sort": {"ts": -1}},
        {
            "$group": {
                "_id": "$meta.sensor_id",
                "ts": {"$first": "$ts"},
                "soil_moisture": {"$first": "$soil_moisture"},
                "soil_temp": {"$first": "$soil_temp"},
                "air_temp": {"$first": "$air_temp"},
                "rainfall_mm": {"$first": "$rainfall_mm"},
                "source": {"$first": {"$ifNull": ["$meta.source", "simulated"]}},
            }
        },
        {
            "$project": {
                "_id": 0,
                "sensor_id": {"$toString": "$_id"},
                "ts": 1,
                "soil_moisture": 1,
                "soil_temp": 1,
                "air_temp": 1,
                "rainfall_mm": 1,
                "source": 1,
            }
        },
        {"$sort": {"ts": -1}},
    ]
    cursor = await db.sensor_readings.aggregate(pipeline)
    return await cursor.to_list(length=None)
