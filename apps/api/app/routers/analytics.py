from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query

from app.config import settings
from app.db import db
from app.deps import get_owned_farm, get_owned_field
from app.models import (
    Crop,
    FarmSummaryOut,
    Metric,
    NearbyStationOut,
    ProductionRankingOut,
    SeriesPointOut,
    WeatherHistoryOut,
)
from app.security import current_user

router = APIRouter(prefix="/analytics", tags=["analytics"])

DAILY_SUMMARY_FIELDS = {
    "soil_moisture": ("moisture_avg", "moisture_min", "moisture_max"),
    "soil_temp": ("soil_temp_avg", "soil_temp_min", "soil_temp_max"),
    "air_temp": ("air_temp_avg", "air_temp_min", "air_temp_max"),
    "rainfall_mm": ("rain_mm", "rain_mm_min", "rain_mm_max"),
}


def daily_summary_point(document, metric):
    value_field, min_field, max_field = DAILY_SUMMARY_FIELDS[metric]
    value = document.get(value_field)
    if value is None:
        return None
    return {
        "bucket": document["day"],
        "value": round(float(value), 2),
        "min": round(float(document[min_field]), 2)
        if document.get(min_field) is not None
        else None,
        "max": round(float(document[max_field]), 2)
        if document.get(max_field) is not None
        else None,
        "readings": int(document.get("readings", 0)),
    }


@router.get("/fields/{field_id}/series", response_model=list[SeriesPointOut])
async def field_series(
    metric: Metric = "soil_moisture",
    unit: Literal["hour", "day"] = "day",
    days: int = Query(7, ge=1, le=365),
    field: dict = Depends(get_owned_field),
):
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=days)
    retention_cutoff = now - timedelta(days=settings.readings_ttl_days)
    raw_since = max(since, retention_cutoff) if unit == "hour" else since
    points = []

    if unit == "day" and since < retention_cutoff:
        # Daily summaries own whole buckets through the TTL boundary day;
        # raw readings start on the following UTC day to avoid duplicate buckets.
        raw_since = retention_cutoff.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(
            days=1
        )
        summary_start = since.replace(hour=0, minute=0, second=0, microsecond=0)
        summaries = (
            await db.field_daily_stats.find(
                {
                    "field_id": field["_id"],
                    "day": {"$gte": summary_start, "$lt": raw_since},
                }
            )
            .sort("day", 1)
            .to_list(length=None)
        )
        points.extend(
            point
            for summary in summaries
            if (point := daily_summary_point(summary, metric)) is not None
        )

    accumulator = "$sum" if metric == "rainfall_mm" else "$avg"
    pipeline = [
        {
            "$match": {
                "meta.field_id": field["_id"],
                "ts": {"$gte": raw_since},
                metric: {"$type": "number"},
            }
        },
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
    points.extend(await cursor.to_list(length=None))
    return sorted(points, key=lambda point: point["bucket"])


@router.get("/fields/{field_id}/stations", response_model=list[NearbyStationOut])
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


@router.get("/fields/{field_id}/weather", response_model=WeatherHistoryOut)
async def field_weather(
    days: int = Query(
        7, ge=1, le=30, description="Janela recente, usada quando year não é informado."
    ),
    year: int | None = Query(
        None,
        ge=1900,
        le=2100,
        description="Ano-calendário importado; quando informado, consulta o ano inteiro.",
    ),
    field: dict = Depends(get_owned_field),
):
    stations = await nearby_stations(max_km=100, field=field)
    if not stations:
        return {"station": None, "available_years": [], "selected_year": None, "readings": []}

    station = stations[0]
    years_cursor = await db.weather_hourly.aggregate(
        [
            {"$match": {"station.code": station["code"]}},
            {"$group": {"_id": {"$year": "$ts"}}},
            {"$sort": {"_id": -1}},
        ]
    )
    available_years = [item["_id"] for item in await years_cursor.to_list(length=None)]

    query = {"station.code": station["code"]}
    if year is not None:
        if year not in available_years:
            raise HTTPException(status_code=422, detail="ano sem dados importados para a estação")
        query["ts"] = {
            "$gte": datetime(year, 1, 1, tzinfo=timezone.utc),
            "$lt": datetime(year + 1, 1, 1, tzinfo=timezone.utc),
        }
        readings = await db.weather_hourly.find(
            query,
            {"_id": 0, "ts": 1, "rain_mm": 1, "air_temp": 1, "humidity": 1, "wind_ms": 1},
        ).sort("ts", 1).limit(9_000).to_list(length=9_000)
    else:
        limit = days * 24
        query["ts"] = {"$gte": datetime.now(timezone.utc) - timedelta(days=days)}
        latest_first = (
            await db.weather_hourly.find(
                query,
                {"_id": 0, "ts": 1, "rain_mm": 1, "air_temp": 1, "humidity": 1, "wind_ms": 1},
            )
            .sort("ts", -1)
            .limit(limit)
            .to_list(length=limit)
        )
        readings = list(reversed(latest_first))

    return {
        "station": station,
        "available_years": available_years,
        "selected_year": year,
        "readings": readings,
    }


@router.get("/farms/{farm_id}/summary", response_model=list[FarmSummaryOut])
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


@router.get("/production/ranking", response_model=list[ProductionRankingOut])
async def production_ranking(
    crop: Crop,
    year: int | None = Query(default=None, ge=1974, le=2100),
    state: str | None = Query(default=None, pattern=r"^[A-Z]{2}$"),
    limit: int = Query(10, ge=1, le=100),
    user: dict = Depends(current_user),
):
    if year is None:
        latest_match = {"crop": crop}
        if state:
            latest_match["state"] = state
        latest = (
            await db.ibge_production.find(latest_match, {"year": 1, "_id": 0})
            .sort("year", -1)
            .limit(1)
            .to_list(length=1)
        )
        if not latest:
            return []
        year = latest[0]["year"]

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
                "year": 1,
                "yield_kg_ha": 1,
                "production_t": 1,
                "planted_area_ha": 1,
            }
        },
    ]
    cursor = await db.ibge_production.aggregate(pipeline)
    return await cursor.to_list(length=None)
