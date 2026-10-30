from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, Query

from app.db import db
from app.deps import get_owned_farm, get_owned_field
from app.models import Crop, Metric
from app.security import current_user

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/fields/{field_id}/series")
async def field_series(
    metric: Metric = "soil_moisture",
    unit: Literal["hour", "day"] = "day",
    days: int = Query(7, ge=1, le=365),
    field: dict = Depends(get_owned_field),
):
    since = datetime.now(timezone.utc) - timedelta(days=days)
    accumulator = "$sum" if metric == "rainfall_mm" else "$avg"
    pipeline = [
        {"$match": {"meta.field_id": field["_id"], "ts": {"$gte": since}}},
        {
            "$group": {
                "_id": {"$dateTrunc": {"date": "$ts", "unit": unit}},
                "value": {accumulator: f"${metric}"},
                "min": {"$min": f"${metric}"},
                "max": {"$max": f"${metric}"},
                "readings": {"$sum": 1},
            }
        },
        {"$sort": {"_id": 1}},
        {
            "$project": {
                "_id": 0,
                "bucket": "$_id",
                "value": {"$round": ["$value", 2]},
                "min": {"$round": ["$min", 2]},
                "max": {"$round": ["$max", 2]},
                "readings": 1,
            }
        },
    ]
    cursor = await db.sensor_readings.aggregate(pipeline)
    return await cursor.to_list(length=None)


@router.get("/fields/{field_id}/stations")
async def nearby_stations(
    max_km: float = Query(100, gt=0, le=500),
    field: dict = Depends(get_owned_field),
):
    pipeline = [
        {
            "$geoNear": {
                "near": field["centroid"],
                "distanceField": "distance_m",
                "maxDistance": max_km * 1000,
                "spherical": True,
            }
        },
        {"$limit": 5},
        {
            "$project": {
                "_id": 0,
                "code": 1,
                "name": 1,
                "state": 1,
                "distance_km": {"$round": [{"$divide": ["$distance_m", 1000]}, 1]},
            }
        },
    ]
    cursor = await db.weather_stations.aggregate(pipeline)
    return await cursor.to_list(length=None)


@router.get("/farms/{farm_id}/summary")
async def farm_summary(farm: dict = Depends(get_owned_farm)):
    pipeline = [
        {"$match": {"farm_id": farm["_id"]}},
        {
            "$group": {
                "_id": "$crop",
                "fields": {"$sum": 1},
                "area_ha": {"$sum": "$area_ha"},
            }
        },
        {"$sort": {"area_ha": -1}},
        {
            "$project": {
                "_id": 0,
                "crop": "$_id",
                "fields": 1,
                "area_ha": {"$round": ["$area_ha", 2]},
            }
        },
    ]
    cursor = await db.fields.aggregate(pipeline)
    return await cursor.to_list(length=None)


@router.get("/production/ranking")
async def production_ranking(
    crop: Crop,
    year: int = Query(ge=1974, le=2100),
    state: str | None = Query(default=None, pattern=r"^[A-Z]{2}$"),
    limit: int = Query(10, ge=1, le=100),
    user: dict = Depends(current_user),
):
    match = {"crop": crop, "year": year}
    if state:
        match["state"] = state
    pipeline = [
        {"$match": match},
        {"$sort": {"yield_kg_ha": -1}},
        {"$limit": limit},
        {
            "$project": {
                "_id": 0,
                "municipality": 1,
                "state": 1,
                "yield_kg_ha": 1,
                "production_t": 1,
                "planted_area_ha": 1,
            }
        },
    ]
    cursor = await db.ibge_production.aggregate(pipeline)
    return await cursor.to_list(length=None)
