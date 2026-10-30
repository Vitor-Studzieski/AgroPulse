from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from app.db import db
from app.deps import get_owned_field, to_object_id
from app.geo import area_ha, centroid
from app.models import FieldIn, FieldOut, FieldUpdate
from app.security import current_user

router = APIRouter(prefix="/fields", tags=["fields"])


async def ensure_farm_owner(farm_id, user):
    farm = await db.farms.find_one({"_id": farm_id, "owner_id": user["_id"]}, {"_id": 1})
    if farm is None:
        raise HTTPException(status_code=404, detail="fazenda não encontrada")


def geometry_fields(boundary):
    ring = boundary["coordinates"][0]
    return {"boundary": boundary, "area_ha": round(area_ha(ring), 2), "centroid": centroid(ring)}


@router.post("", response_model=FieldOut, status_code=201)
async def create_field(body: FieldIn, user: dict = Depends(current_user)):
    farm_id = to_object_id(body.farm_id)
    await ensure_farm_owner(farm_id, user)
    document = body.model_dump(exclude={"boundary"})
    document.update(geometry_fields(body.boundary.model_dump()))
    document["farm_id"] = farm_id
    document["created_at"] = datetime.now(timezone.utc)
    result = await db.fields.insert_one(document)
    document["_id"] = result.inserted_id
    return document


@router.get("", response_model=list[FieldOut])
async def list_fields(farm_id: str, user: dict = Depends(current_user)):
    oid = to_object_id(farm_id)
    await ensure_farm_owner(oid, user)
    return await db.fields.find({"farm_id": oid}).sort("name", 1).to_list(length=None)


@router.get("/{field_id}", response_model=FieldOut)
async def read_field(field: dict = Depends(get_owned_field)):
    return field


@router.patch("/{field_id}", response_model=FieldOut)
async def update_field(body: FieldUpdate, field: dict = Depends(get_owned_field)):
    changes = body.model_dump(exclude_unset=True, exclude_none=True, exclude={"boundary"})
    if body.boundary is not None:
        changes.update(geometry_fields(body.boundary.model_dump()))
    if changes:
        await db.fields.update_one({"_id": field["_id"]}, {"$set": changes})
    return await db.fields.find_one({"_id": field["_id"]})


@router.delete("/{field_id}", status_code=204)
async def delete_field(field: dict = Depends(get_owned_field)):
    await db.seasons.delete_many({"field_id": field["_id"]})
    await db.operations.delete_many({"field_id": field["_id"]})
    await db.sensors.delete_many({"field_id": field["_id"]})
    await db.alert_rules.delete_many({"field_id": field["_id"]})
    await db.fields.delete_one({"_id": field["_id"]})
