from fastapi import APIRouter, Depends, HTTPException, Query
from pymongo.errors import DuplicateKeyError

from app.db import db
from app.deps import get_owned_sensor, load_owned_field, owned_field_ids
from app.geo import interior_point, point_in_polygon, spread_points
from app.models import SensorIn, SensorOut, SensorUpdate
from app.security import current_user

router = APIRouter(prefix="/sensors", tags=["sensors"])


@router.post("", response_model=SensorOut, status_code=201)
async def create_sensor(body: SensorIn, user: dict = Depends(current_user)):
    field = await load_owned_field(body.field_id, user)
    document = body.model_dump(exclude={"field_id"})
    location = body.location.model_dump() if body.location else interior_point(field["boundary"]["coordinates"])
    if not point_in_polygon(field["boundary"]["coordinates"], location["coordinates"]):
        raise HTTPException(status_code=422, detail="a posição do sensor precisa ficar dentro do talhão")
    document["location"] = location
    document.update({"field_id": field["_id"], "farm_id": field["farm_id"]})
    try:
        result = await db.sensors.insert_one(document)
    except DuplicateKeyError as error:
        raise HTTPException(status_code=409, detail="device_id já cadastrado") from error
    document["_id"] = result.inserted_id
    return document


@router.get("", response_model=list[SensorOut])
async def list_sensors(
    field_id: str | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    user: dict = Depends(current_user),
):
    if field_id is not None:
        field = await load_owned_field(field_id, user)
        query = {"field_id": field["_id"]}
    else:
        query = {"field_id": {"$in": await owned_field_ids(user)}}
    cursor = db.sensors.find(query).sort("device_id", 1)
    sensors = await cursor.skip(offset).limit(limit).to_list(length=limit)

    # Backfill provenance and deterministic locations for legacy sensors when first listed.
    for sensor in sensors:
        if "source" not in sensor:
            await db.sensors.update_one(
                {"_id": sensor["_id"], "source": {"$exists": False}},
                {"$set": {"source": "simulated"}},
            )
            sensor["source"] = "simulated"

    grouped = {}
    for sensor in sensors:
        grouped.setdefault(sensor["field_id"], []).append(sensor)
    for field_id, page_sensors in grouped.items():
        field = await db.fields.find_one({"_id": field_id})
        if not field:
            continue
        all_sensors = await db.sensors.find({"field_id": field_id}).to_list(length=None)
        boundary = field["boundary"]["coordinates"]
        occupied = [
            sensor["location"]["coordinates"]
            for sensor in all_sensors
            if sensor.get("location")
            and point_in_polygon(boundary, sensor["location"].get("coordinates", []))
        ]
        missing = [
            sensor for sensor in page_sensors
            if not sensor.get("location")
            or not point_in_polygon(boundary, sensor["location"].get("coordinates", []))
        ]
        positions = spread_points(boundary, len(missing), occupied)
        for sensor, coordinates in zip(missing, positions):
            location = {"type": "Point", "coordinates": coordinates}
            await db.sensors.update_one({"_id": sensor["_id"]}, {"$set": {"location": location}})
            sensor["location"] = location
    return sensors


@router.get("/{sensor_id}", response_model=SensorOut)
async def read_sensor(sensor: dict = Depends(get_owned_sensor)):
    return sensor


@router.patch("/{sensor_id}", response_model=SensorOut)
async def update_sensor(
    body: SensorUpdate,
    sensor: dict = Depends(get_owned_sensor),
    user: dict = Depends(current_user),
):
    changes = body.model_dump(exclude_unset=True, exclude_none=True)
    field_changed = "field_id" in changes and changes["field_id"] != str(sensor["field_id"])
    field = await load_owned_field(changes.get("field_id", sensor["field_id"]), user)
    if "location" in changes:
        location = body.location.model_dump()
    elif field_changed:
        location = sensor.get("location")
        if not location or not point_in_polygon(field["boundary"]["coordinates"], location["coordinates"]):
            location = interior_point(field["boundary"]["coordinates"])
    else:
        location = sensor.get("location")
    if location and not point_in_polygon(field["boundary"]["coordinates"], location["coordinates"]):
        raise HTTPException(status_code=422, detail="a posição do sensor precisa ficar dentro do talhão")
    if location:
        changes["location"] = location
    changes["field_id"] = field["_id"]
    changes["farm_id"] = field["farm_id"]
    try:
        await db.sensors.update_one({"_id": sensor["_id"]}, {"$set": changes})
    except DuplicateKeyError as error:
        raise HTTPException(status_code=409, detail="device_id já cadastrado") from error
    return await db.sensors.find_one({"_id": sensor["_id"]})


@router.delete("/{sensor_id}", status_code=204)
async def delete_sensor(sensor: dict = Depends(get_owned_sensor)):
    await db.sensors.delete_one({"_id": sensor["_id"]})
