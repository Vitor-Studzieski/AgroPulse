from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from pymongo.errors import DuplicateKeyError

from app.db import db
from app.deps import delete_fields
from app.models import Token, UserCreate, UserDelete, UserOut, UserUpdate
from app.security import create_token, current_user, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=UserOut, status_code=201)
async def register(body: UserCreate):
    document = {
        "name": body.name,
        "email": body.email.lower(),
        "password_hash": hash_password(body.password),
        "role": "produtor",
        "created_at": datetime.now(timezone.utc),
    }
    try:
        result = await db.users.insert_one(document)
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="e-mail já cadastrado")
    document["_id"] = result.inserted_id
    return document


@router.post("/login", response_model=Token)
async def login(form: OAuth2PasswordRequestForm = Depends()):
    user = await db.users.find_one({"email": form.username.lower()})
    if user is None or not verify_password(form.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="e-mail ou senha incorretos")
    return Token(access_token=create_token(str(user["_id"]), user["role"]))


@router.get("/me", response_model=UserOut)
async def me(user: dict = Depends(current_user)):
    return user


@router.patch("/me", response_model=UserOut)
async def update_me(body: UserUpdate, user: dict = Depends(current_user)):
    if not verify_password(body.current_password, user["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="senha atual incorreta",
            headers={"WWW-Authenticate": "Bearer"},
        )

    changes = {}
    if body.name is not None:
        changes["name"] = body.name
    if body.email is not None:
        changes["email"] = str(body.email).lower()
    if body.new_password is not None:
        changes["password_hash"] = hash_password(body.new_password)

    try:
        await db.users.update_one({"_id": user["_id"]}, {"$set": changes})
    except DuplicateKeyError as error:
        raise HTTPException(status_code=409, detail="e-mail já cadastrado") from error
    return await db.users.find_one({"_id": user["_id"]})


@router.delete("/me", status_code=204)
async def delete_me(body: UserDelete, user: dict = Depends(current_user)):
    if not verify_password(body.current_password, user["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="senha atual incorreta",
            headers={"WWW-Authenticate": "Bearer"},
        )

    farms = await db.farms.find({"owner_id": user["_id"]}, {"_id": 1}).to_list(length=None)
    farm_ids = [farm["_id"] for farm in farms]
    fields = await db.fields.find({"farm_id": {"$in": farm_ids}}, {"_id": 1}).to_list(
        length=None
    )
    field_ids = [field["_id"] for field in fields]

    await delete_fields(field_ids)
    if farm_ids:
        await db.sensors.delete_many({"farm_id": {"$in": farm_ids}})
        await db.farms.delete_many({"_id": {"$in": farm_ids}})
    await db.users.delete_one({"_id": user["_id"]})
