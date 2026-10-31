from fastapi import APIRouter, Depends, Query

from app.db import db
from app.deps import get_owned_alert_rule, load_owned_field, owned_field_ids
from app.models import AlertRuleIn, AlertRuleOut, AlertRuleUpdate
from app.security import current_user

router = APIRouter(prefix="/alert-rules", tags=["alert-rules"])


@router.post("", response_model=AlertRuleOut, status_code=201)
async def create_alert_rule(body: AlertRuleIn, user: dict = Depends(current_user)):
    field = await load_owned_field(body.field_id, user)
    document = body.model_dump(exclude={"field_id"})
    document["field_id"] = field["_id"]
    result = await db.alert_rules.insert_one(document)
    document["_id"] = result.inserted_id
    return document


@router.get("", response_model=list[AlertRuleOut])
async def list_alert_rules(
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
    cursor = db.alert_rules.find(query).sort("field_id", 1)
    return await cursor.skip(offset).limit(limit).to_list(length=limit)


@router.get("/{rule_id}", response_model=AlertRuleOut)
async def read_alert_rule(rule: dict = Depends(get_owned_alert_rule)):
    return rule


@router.patch("/{rule_id}", response_model=AlertRuleOut)
async def update_alert_rule(
    body: AlertRuleUpdate,
    rule: dict = Depends(get_owned_alert_rule),
    user: dict = Depends(current_user),
):
    changes = body.model_dump(exclude_unset=True, exclude_none=True)
    field = await load_owned_field(changes.get("field_id", rule["field_id"]), user)
    changes["field_id"] = field["_id"]
    if changes:
        await db.alert_rules.update_one({"_id": rule["_id"]}, {"$set": changes})
    return await db.alert_rules.find_one({"_id": rule["_id"]})


@router.delete("/{rule_id}", status_code=204)
async def delete_alert_rule(rule: dict = Depends(get_owned_alert_rule)):
    await db.alert_rules.delete_one({"_id": rule["_id"]})
