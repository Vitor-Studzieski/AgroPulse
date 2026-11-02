from fastapi import APIRouter, Depends, HTTPException, Query
from pymongo.errors import DuplicateKeyError

from app.db import db
from app.deps import get_owned_sensor, load_owned_field, owned_field_ids
from app.models import SensorIn, SensorOut, SensorUpdate
from app.security import current_user

router = APIRouter(prefix="/sensors", tags=["sensors"])


@router.post("", response_model=SensorOut, status_code=201)
async def create_sensor(body: SensorIn, user: dict = Depends(current_user)):
    field = await load_owned_field(body.field_id, user)
    document = body.model_dump(exclude={"field_id"})
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
    return await cursor.skip(offset).limit(limit).to_list(length=limit)


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
    field = await load_owned_field(changes.get("field_id", sensor["field_id"]), user)
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
