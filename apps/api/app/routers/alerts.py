from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query

from app.datetime_utils import as_utc
from app.db import db
from app.deps import get_owned_alert, load_owned_field, owned_field_ids, to_object_id
from app.models import AlertIn, AlertOut, AlertStatus, AlertUpdate
from app.security import current_user

router = APIRouter(prefix="/alerts", tags=["alerts"])


@router.post("", response_model=AlertOut, status_code=201)
async def create_alert(body: AlertIn, user: dict = Depends(current_user)):
    field = await load_owned_field(body.field_id, user)
    rule = await db.alert_rules.find_one(
        {"_id": to_object_id(body.rule_id), "field_id": field["_id"]}
    )
    if (
        rule is None
        or rule["metric"] != body.metric
        or not rule["active"]
        or float(rule["threshold"]) != body.threshold
    ):
        raise HTTPException(status_code=404, detail="regra não encontrada neste talhão")
    is_breached = (
        body.value < body.threshold if rule["operator"] == "lt" else body.value > body.threshold
    )
    if not is_breached:
        raise HTTPException(status_code=422, detail="value não viola a regra de alerta")
    if as_utc(body.triggered_at) > datetime.now(timezone.utc):
        raise HTTPException(status_code=422, detail="triggered_at não pode estar no futuro")
    document = body.model_dump(exclude={"field_id", "rule_id"})
    document.update({"field_id": field["_id"], "rule_id": rule["_id"], "status": "open"})
    result = await db.alerts.insert_one(document)
    document["_id"] = result.inserted_id
    return document


@router.get("", response_model=list[AlertOut])
async def list_alerts(
    field_id: str | None = None,
    status: AlertStatus | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    user: dict = Depends(current_user),
):
    if field_id is not None:
        field = await load_owned_field(field_id, user)
        query = {"field_id": field["_id"]}
    else:
        query = {"field_id": {"$in": await owned_field_ids(user)}}
    if status is not None:
        query["status"] = status
    return (
        await db.alerts.find(query)
        .sort("triggered_at", -1)
        .skip(offset)
        .limit(limit)
        .to_list(length=limit)
    )


@router.get("/{alert_id}", response_model=AlertOut)
async def read_alert(alert: dict = Depends(get_owned_alert)):
    return alert


@router.patch("/{alert_id}", response_model=AlertOut)
async def update_alert(
    body: AlertUpdate,
    alert: dict = Depends(get_owned_alert),
):
    changes = body.model_dump(exclude_unset=True, exclude_none=True)
    target_status = changes.get("status", alert["status"])
    if target_status != "resolved" and changes.get("resolved_at") is not None:
        raise HTTPException(status_code=422, detail="alerta aberto não pode ter resolved_at")
    if changes.get("status") == "resolved" and "resolved_at" not in changes:
        if alert.get("resolved_at") is None:
            changes["resolved_at"] = datetime.now(timezone.utc)
    elif changes.get("status") == "open" and "resolved_at" not in changes:
        await db.alerts.update_one({"_id": alert["_id"]}, {"$unset": {"resolved_at": ""}})
    resolved_at = changes.get("resolved_at")
    if resolved_at is not None:
        normalized_resolved_at = as_utc(resolved_at)
        if normalized_resolved_at < as_utc(alert["triggered_at"]):
            raise HTTPException(
                status_code=422, detail="resolved_at não pode anteceder triggered_at"
            )
        if normalized_resolved_at > datetime.now(timezone.utc):
            raise HTTPException(status_code=422, detail="resolved_at não pode estar no futuro")
    if changes:
        await db.alerts.update_one({"_id": alert["_id"]}, {"$set": changes})
    return await db.alerts.find_one({"_id": alert["_id"]})


@router.delete("/{alert_id}", status_code=204)
async def delete_alert(alert: dict = Depends(get_owned_alert)):
    await db.alerts.delete_one({"_id": alert["_id"]})
