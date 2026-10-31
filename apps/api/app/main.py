from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

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

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in settings.cors_origins.split(",")],
    allow_methods=["*"],
    allow_headers=["*"],
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
