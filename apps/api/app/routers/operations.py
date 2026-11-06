import hashlib
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote, unquote

from bson import ObjectId
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response
from gridfs import AsyncGridFSBucket
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
attachments = AsyncGridFSBucket(db, bucket_name="operation_attachments")
MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024
ALLOWED_ATTACHMENT_TYPES = {"application/pdf", "image/jpeg", "image/png", "image/webp"}


def audit_value(value):
    if isinstance(value, (ObjectId, datetime)):
        return str(value) if isinstance(value, ObjectId) else value.isoformat()
    if isinstance(value, dict):
        return {key: audit_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [audit_value(item) for item in value]
    return value


def audit_event(user, action, changes=None):
    return {
        "at": datetime.now(timezone.utc),
        "by": user.get("name") or user.get("email", "Usuário"),
        "action": action,
        "changes": audit_value(changes or {}),
    }


def validate_operation_area(details, field):
    area = details.get("area_ha")
    if area is None:
        return
    try:
        parsed = float(area)
    except (TypeError, ValueError) as error:
        raise HTTPException(status_code=422, detail="área trabalhada inválida") from error
    if not math.isfinite(parsed) or parsed < 0 or parsed > float(field.get("area_ha", 0)):
        raise HTTPException(status_code=422, detail="área trabalhada deve estar entre 0 e a área do talhão")


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
    validate_operation_area(body.details, field)
    season_id = await validate_season(field["_id"], body.season_id)
    document = body.model_dump(exclude_none=True, exclude={"field_id", "season_id"})
    document["field_id"] = field["_id"]
    now = datetime.now(timezone.utc)
    document["created_at"] = now
    document["created_by"] = user.get("name") or user.get("email")
    document["history"] = [audit_event(user, "created", {"source": document.get("source", "simulated")})]
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
        for name in ("season_id", "cost_brl", "source")
        if name in requested and requested[name] is None
    }
    changes = {name: value for name, value in requested.items() if value is not None}
    for name in unset:
        changes.pop(name, None)
    field = await load_owned_field(requested.get("field_id", operation["field_id"]), user)
    validate_operation_area(changes.get("details", operation.get("details", {})), field)
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
        now = datetime.now(timezone.utc)
        changed_fields = {}
        for name, new_value in changes.items():
            if name in {"field_id", "season_id"}:
                old_value = operation.get(name)
            else:
                old_value = operation.get(name)
            if audit_value(old_value) != audit_value(new_value):
                changed_fields[name] = {"de": audit_value(old_value), "para": audit_value(new_value)}
        for name in unset:
            if name in operation:
                changed_fields[name] = {"de": audit_value(operation[name]), "para": None}
        event = audit_event(user, "updated", changed_fields)
        history = (operation.get("history") or []) + [event]
        update.setdefault("$set", {}).update({
            "updated_at": now,
            "updated_by": user.get("name") or user.get("email"),
            "history": history[-100:],
        })
        await db.operations.update_one({"_id": operation["_id"]}, update)
    return await db.operations.find_one({"_id": operation["_id"]})


@router.delete("/{operation_id}", status_code=204)
async def delete_operation(operation: dict = Depends(get_owned_operation)):
    for attachment in operation.get("details", {}).get("attachments", []):
        try:
            await attachments.delete(to_object_id(attachment.get("file_id", "")))
        except Exception:
            continue
    await db.operations.delete_one({"_id": operation["_id"]})


@router.post("/{operation_id}/attachments", status_code=201)
async def upload_operation_attachment(
    request: Request,
    operation: dict = Depends(get_owned_operation),
    user: dict = Depends(current_user),
):
    content_type = request.headers.get("content-type", "application/octet-stream").split(";", 1)[0].strip().lower()
    if content_type not in ALLOWED_ATTACHMENT_TYPES:
        raise HTTPException(status_code=415, detail="Use PDF, JPEG, PNG ou WebP.")
    content_length = request.headers.get("content-length")
    try:
        if content_length and int(content_length) > MAX_ATTACHMENT_BYTES:
            raise HTTPException(status_code=413, detail="O arquivo deve ter no máximo 8 MB.")
    except ValueError as error:
        raise HTTPException(status_code=400, detail="Tamanho de arquivo inválido.") from error
    content = await request.body()
    if not content:
        raise HTTPException(status_code=400, detail="O arquivo está vazio.")
    if len(content) > MAX_ATTACHMENT_BYTES:
        raise HTTPException(status_code=413, detail="O arquivo deve ter no máximo 8 MB.")
    current = operation.get("details", {}).get("attachments", [])
    if len(current) >= 10:
        raise HTTPException(status_code=409, detail="Cada operação pode ter até 10 anexos.")
    filename = Path(unquote(request.headers.get("x-filename", "anexo"))).name[:180] or "anexo"
    now = datetime.now(timezone.utc)
    async with attachments.open_upload_stream(
        filename,
        metadata={"operation_id": str(operation["_id"]), "uploaded_by": str(user["_id"]), "content_type": content_type},
    ) as stream:
        await stream.write(content)
    attachment = {
        "file_id": str(stream._id),
        "filename": filename,
        "content_type": content_type,
        "size": len(content),
        "uploaded_at": now,
        "uploaded_by": user.get("name") or user.get("email"),
    }
    details = dict(operation.get("details", {}))
    details["attachments"] = [*current, attachment]
    history = (operation.get("history") or []) + [audit_event(user, "attachment_added", {"filename": filename})]
    await db.operations.update_one(
        {"_id": operation["_id"]},
        {"$set": {
            "details": details,
            "history": history[-100:],
            "updated_at": now,
            "updated_by": user.get("name") or user.get("email"),
        }},
    )
    return {**attachment, "uploaded_at": now.isoformat()}


@router.get("/{operation_id}/attachments/{file_id}")
async def download_operation_attachment(
    file_id: str,
    operation: dict = Depends(get_owned_operation),
):
    match = next((item for item in operation.get("details", {}).get("attachments", []) if item.get("file_id") == file_id), None)
    if match is None:
        raise HTTPException(status_code=404, detail="anexo não encontrado")
    try:
        stream = await attachments.open_download_stream(to_object_id(file_id))
        content = await stream.read()
    except Exception as error:
        raise HTTPException(status_code=404, detail="anexo não encontrado") from error
    filename = match.get("filename", "anexo")
    headers = {"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"}
    return Response(content, media_type=match.get("content_type", "application/octet-stream"), headers=headers)
