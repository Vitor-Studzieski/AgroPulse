from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordRequestForm
from pymongo.errors import DuplicateKeyError

from app.db import db
from app.models import Token, UserCreate, UserOut
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
