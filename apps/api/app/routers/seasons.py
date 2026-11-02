from fastapi import APIRouter, Depends, HTTPException, Query

from app.datetime_utils import as_utc
from app.db import db
from app.deps import get_owned_season, load_owned_field
from app.models import SeasonIn, SeasonOut, SeasonUpdate
from app.security import current_user

router = APIRouter(prefix="/seasons", tags=["seasons"])


def validate_date_order(planting_date, harvest_date):
    if harvest_date is not None and as_utc(harvest_date) < as_utc(planting_date):
        raise HTTPException(status_code=422, detail="harvest_date não pode anteceder planting_date")


@router.post("", response_model=SeasonOut, status_code=201)
async def create_season(body: SeasonIn, user: dict = Depends(current_user)):
    field = await load_owned_field(body.field_id, user)
    validate_date_order(body.planting_date, body.harvest_date)
    field_id = field["_id"]
    if await db.seasons.find_one({"field_id": field_id, "label": body.label}, {"_id": 1}):
        raise HTTPException(
            status_code=409, detail="já existe uma safra com este período no talhão"
        )
    document = body.model_dump(exclude_none=True, exclude={"field_id"})
    document.update({"field_id": field_id, "crop": field["crop"]})
    result = await db.seasons.insert_one(document)
    document["_id"] = result.inserted_id
    return document


@router.get("", response_model=list[SeasonOut])
async def list_seasons(
    field_id: str,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    user: dict = Depends(current_user),
):
    field = await load_owned_field(field_id, user)
    cursor = db.seasons.find({"field_id": field["_id"]}).sort("planting_date", -1)
    return await cursor.skip(offset).limit(limit).to_list(length=limit)


@router.get("/{season_id}", response_model=SeasonOut)
async def read_season(season: dict = Depends(get_owned_season)):
    return season


@router.patch("/{season_id}", response_model=SeasonOut)
async def update_season(body: SeasonUpdate, season: dict = Depends(get_owned_season)):
    changes = body.model_dump(exclude_unset=True)
    unset = {
        name: ""
        for name in ("harvest_date", "expected_yield_kg_ha", "yield_kg_ha")
        if name in changes and changes[name] is None
    }
    for name in unset:
        changes.pop(name)
    planting_date = changes.get("planting_date", season["planting_date"])
    harvest_date = (
        None if "harvest_date" in unset else changes.get("harvest_date", season.get("harvest_date"))
    )
    validate_date_order(planting_date, harvest_date)
    if "label" in changes and await db.seasons.find_one(
        {
            "_id": {"$ne": season["_id"]},
            "field_id": season["field_id"],
            "label": changes["label"],
        },
        {"_id": 1},
    ):
        raise HTTPException(
            status_code=409, detail="já existe uma safra com este período no talhão"
        )
    update = {}
    if changes:
        update["$set"] = changes
    if unset:
        update["$unset"] = unset
    if update:
        await db.seasons.update_one({"_id": season["_id"]}, update)
    return await db.seasons.find_one({"_id": season["_id"]})


@router.delete("/{season_id}", status_code=204)
async def delete_season(season: dict = Depends(get_owned_season)):
    await db.operations.update_many({"season_id": season["_id"]}, {"$unset": {"season_id": ""}})
    await db.seasons.delete_one({"_id": season["_id"]})
