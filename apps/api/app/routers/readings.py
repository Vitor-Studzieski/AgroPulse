from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends

from app.db import db
from app.deps import get_owned_field

router = APIRouter(prefix="/fields", tags=["readings"])


@router.get("/{field_id}/readings/latest")
async def latest_readings(field: dict = Depends(get_owned_field)):
    since = datetime.now(timezone.utc) - timedelta(hours=24)
    pipeline = [
        {"$match": {"meta.field_id": field["_id"], "ts": {"$gte": since}}},
        {"$sort": {"ts": -1}},
        {
            "$group": {
                "_id": "$meta.sensor_id",
                "ts": {"$first": "$ts"},
                "soil_moisture": {"$first": "$soil_moisture"},
                "soil_temp": {"$first": "$soil_temp"},
                "air_temp": {"$first": "$air_temp"},
                "rainfall_mm": {"$first": "$rainfall_mm"},
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
            }
        },
    ]
    cursor = await db.sensor_readings.aggregate(pipeline)
    return await cursor.to_list(length=None)
