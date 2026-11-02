from bson import ObjectId
from bson.errors import InvalidId
from fastapi import Depends, HTTPException

from app.db import db
from app.security import current_user


def to_object_id(value):
    try:
        return ObjectId(value)
    except (InvalidId, TypeError):
        raise HTTPException(status_code=422, detail="id inválido")


async def get_owned_farm(farm_id: str, user: dict = Depends(current_user)):
    farm = await db.farms.find_one({"_id": to_object_id(farm_id), "owner_id": user["_id"]})
    if farm is None:
        raise HTTPException(status_code=404, detail="fazenda não encontrada")
    return farm


async def get_owned_field(field_id: str, user: dict = Depends(current_user)):
    return await load_owned_field(field_id, user)


async def load_owned_field(field_id, user: dict):
    field = await db.fields.find_one({"_id": to_object_id(field_id)})
    if field is None:
        raise HTTPException(status_code=404, detail="talhão não encontrado")
    farm = await db.farms.find_one({"_id": field["farm_id"], "owner_id": user["_id"]}, {"_id": 1})
    if farm is None:
        raise HTTPException(status_code=404, detail="talhão não encontrado")
    return field


async def owned_field_ids(user: dict):
    farm_ids = [farm["_id"] async for farm in db.farms.find({"owner_id": user["_id"]}, {"_id": 1})]
    if not farm_ids:
        return []
    return [
        field["_id"] async for field in db.fields.find({"farm_id": {"$in": farm_ids}}, {"_id": 1})
    ]


async def delete_fields(field_ids):
    """Remove a set of fields and all data owned by those fields."""
    if not field_ids:
        return
    for field_id in field_ids:
        await db.sensor_readings.delete_many({"meta.field_id": field_id})
    query = {"field_id": {"$in": field_ids}}
    await db.field_daily_stats.delete_many(query)
    await db.alerts.delete_many(query)
    await db.alert_rules.delete_many(query)
    await db.operations.delete_many(query)
    await db.seasons.delete_many(query)
    await db.sensors.delete_many(query)
    await db.fields.delete_many({"_id": {"$in": field_ids}})


async def _owned_resource(collection, resource_id, user, label):
    resource = await collection.find_one({"_id": to_object_id(resource_id)})
    if resource is None:
        raise HTTPException(status_code=404, detail=f"{label} não encontrado")
    try:
        await load_owned_field(resource["field_id"], user)
    except HTTPException as error:
        if error.status_code == 404:
            raise HTTPException(status_code=404, detail=f"{label} não encontrado") from error
        raise
    return resource


async def get_owned_season(season_id: str, user: dict = Depends(current_user)):
    return await _owned_resource(db.seasons, season_id, user, "safra")


async def get_owned_operation(operation_id: str, user: dict = Depends(current_user)):
    return await _owned_resource(db.operations, operation_id, user, "operação")


async def get_owned_sensor(sensor_id: str, user: dict = Depends(current_user)):
    return await _owned_resource(db.sensors, sensor_id, user, "sensor")


async def get_owned_alert_rule(rule_id: str, user: dict = Depends(current_user)):
    return await _owned_resource(db.alert_rules, rule_id, user, "regra de alerta")


async def get_owned_alert(alert_id: str, user: dict = Depends(current_user)):
    return await _owned_resource(db.alerts, alert_id, user, "alerta")
