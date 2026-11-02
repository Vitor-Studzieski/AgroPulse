import math
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.db import client, db
from app.routers import (
    alert_rules,
    alerts,
    analytics,
    auth,
    farms,
    fields,
    operations,
    readings,
    seasons,
    sensors,
)


@asynccontextmanager
async def lifespan(app):
    yield
    await client.close()


app = FastAPI(title="AgroPulse API", version="0.1.0", lifespan=lifespan)


def json_safe_validation_value(value):
    if isinstance(value, float) and not math.isfinite(value):
        return str(value)
    if isinstance(value, BaseException):
        return str(value)
    if isinstance(value, dict):
        return {key: json_safe_validation_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe_validation_value(item) for item in value]
    return value


@app.exception_handler(RequestValidationError)
async def request_validation_exception_handler(
    _request: Request, error: RequestValidationError
):
    return JSONResponse(
        status_code=422,
        content={"detail": jsonable_encoder(json_safe_validation_value(error.errors()))},
    )


app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in settings.cors_origins.split(",")],
    allow_methods=["*"],
    allow_headers=["*", "Idempotency-Key"],
)

for module in (
    auth,
    farms,
    fields,
    seasons,
    operations,
    sensors,
    alert_rules,
    alerts,
    readings,
    analytics,
):
    app.include_router(module.router)


@app.head("/health", include_in_schema=False)
@app.get("/health", tags=["infra"])
async def health():
    await db.command("ping")
    return {"status": "ok"}
