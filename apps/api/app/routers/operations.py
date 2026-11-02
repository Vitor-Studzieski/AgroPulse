import hashlib
import json

from bson import ObjectId
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response
from pymongo.errors import DuplicateKeyError

from app.db import db
from app.deps import (
    get_owned_operation,
    load_owned_field,
    owned_field_ids,
    to_object_id,
)
from app.models import OperationIn, OperationOut, OperationUpdate
from app.security import current_user

router = APIRouter(prefix="/operations", tags=["operations"])


async def validate_season(field_id, season_id):
    if season_id is None:
        return None
    season = await db.seasons.find_one({"_id": to_object_id(season_id)})
    if season is None or season["field_id"] != field_id:
        raise HTTPException(status_code=404, detail="safra não encontrada neste talhão")
    return season["_id"]


def idempotency_object_id(owner_id, idempotency_key):
    identity = f"{owner_id}\0{idempotency_key}".encode()
    return ObjectId(hashlib.sha256(identity).digest()[:12])


def operation_fingerprint(body: OperationIn) -> str:
    serialized = json.dumps(
        body.model_dump(mode="json", exclude_none=True),
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(serialized.encode()).hexdigest()


@router.post("", response_model=OperationOut, status_code=201)
async def create_operation(
    body: OperationIn,
    response: Response,
    idempotency_key: str | None = Header(
        default=None, alias="Idempotency-Key", min_length=1, max_length=128
    ),
    user: dict = Depends(current_user),
):
    field = await load_owned_field(body.field_id, user)
    season_id = await validate_season(field["_id"], body.season_id)
    document = body.model_dump(exclude_none=True, exclude={"field_id", "season_id"})
    document["field_id"] = field["_id"]
    if season_id is not None:
        document["season_id"] = season_id

    fingerprint = None
    if idempotency_key is not None:
        document["_id"] = idempotency_object_id(user["_id"], idempotency_key)
        fingerprint = operation_fingerprint(body)
        document["idempotency_fingerprint"] = fingerprint

    try:
        result = await db.operations.insert_one(document)
    except DuplicateKeyError:
        if idempotency_key is None:
            raise
        existing = await db.operations.find_one({"_id": document["_id"]})
        if existing is None:
            raise
        if existing.get("idempotency_fingerprint") != fingerprint:
            raise HTTPException(
                status_code=409,
                detail="Idempotency-Key já utilizado com outro conteúdo",
            )
        response.status_code = 200
        return existing

    document["_id"] = result.inserted_id
    return document


@router.get("", response_model=list[OperationOut])
async def list_operations(
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
    cursor = db.operations.find(query).sort("date", -1)
    return await cursor.skip(offset).limit(limit).to_list(length=limit)


@router.get("/{operation_id}", response_model=OperationOut)
async def read_operation(operation: dict = Depends(get_owned_operation)):
    return operation


@router.patch("/{operation_id}", response_model=OperationOut)
async def update_operation(
    body: OperationUpdate,
    operation: dict = Depends(get_owned_operation),
    user: dict = Depends(current_user),
):
    requested = body.model_dump(exclude_unset=True)
    unset = {
        name: ""
        for name in ("season_id", "cost_brl")
        if name in requested and requested[name] is None
    }
    changes = {name: value for name, value in requested.items() if value is not None}
    for name in unset:
        changes.pop(name, None)
    field = await load_owned_field(requested.get("field_id", operation["field_id"]), user)
    changes["field_id"] = field["_id"]
    if "season_id" not in unset:
        season_value = requested.get("season_id", operation.get("season_id"))
        season_id = await validate_season(field["_id"], season_value)
        changes.pop("season_id", None)
        if season_id is not None:
            changes["season_id"] = season_id
    update = {}
    if changes:
        update["$set"] = changes
    if unset:
        update["$unset"] = unset
    if update:
        await db.operations.update_one({"_id": operation["_id"]}, update)
    return await db.operations.find_one({"_id": operation["_id"]})


@router.delete("/{operation_id}", status_code=204)
async def delete_operation(operation: dict = Depends(get_owned_operation)):
    await db.operations.delete_one({"_id": operation["_id"]})
