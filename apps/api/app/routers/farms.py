from datetime import datetime, timezone

from fastapi import APIRouter, Depends

from app.db import db
from app.deps import get_owned_farm
from app.models import FarmIn, FarmOut, FarmUpdate
from app.security import current_user

router = APIRouter(prefix="/farms", tags=["farms"])


@router.post("", response_model=FarmOut, status_code=201)
async def create_farm(body: FarmIn, user: dict = Depends(current_user)):
    document = body.model_dump()
    document["owner_id"] = user["_id"]
    document["created_at"] = datetime.now(timezone.utc)
    result = await db.farms.insert_one(document)
    document["_id"] = result.inserted_id
    return document


@router.get("", response_model=list[FarmOut])
async def list_farms(user: dict = Depends(current_user)):
    cursor = db.farms.find({"owner_id": user["_id"]}).sort("name", 1)
    return await cursor.to_list(length=None)


@router.get("/{farm_id}", response_model=FarmOut)
async def read_farm(farm: dict = Depends(get_owned_farm)):
    return farm


@router.patch("/{farm_id}", response_model=FarmOut)
async def update_farm(body: FarmUpdate, farm: dict = Depends(get_owned_farm)):
    changes = body.model_dump(exclude_unset=True, exclude_none=True)
    if changes:
        await db.farms.update_one({"_id": farm["_id"]}, {"$set": changes})
    return await db.farms.find_one({"_id": farm["_id"]})


@router.delete("/{farm_id}", status_code=204)
async def delete_farm(farm: dict = Depends(get_owned_farm)):
    field_ids = [f["_id"] async for f in db.fields.find({"farm_id": farm["_id"]}, {"_id": 1})]
    await db.seasons.delete_many({"field_id": {"$in": field_ids}})
    await db.operations.delete_many({"field_id": {"$in": field_ids}})
    await db.sensors.delete_many({"farm_id": farm["_id"]})
    await db.alert_rules.delete_many({"field_id": {"$in": field_ids}})
    await db.fields.delete_many({"farm_id": farm["_id"]})
    await db.farms.delete_one({"_id": farm["_id"]})
