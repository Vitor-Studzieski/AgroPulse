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
    field = await db.fields.find_one({"_id": to_object_id(field_id)})
    if field is None:
        raise HTTPException(status_code=404, detail="talhão não encontrado")
    farm = await db.farms.find_one(
        {"_id": field["farm_id"], "owner_id": user["_id"]}, {"_id": 1}
    )
    if farm is None:
        raise HTTPException(status_code=404, detail="talhão não encontrado")
    return field
