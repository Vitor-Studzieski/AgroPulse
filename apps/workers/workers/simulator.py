import argparse
import hashlib
import logging
import math
import os
import random
import time
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from workers.common import get_db, setup_logging

log = logging.getLogger("simulator")
BATCH_SIZE = 10_000
SIMULATION_VERSION = "2.0"
LOCAL_TZ = ZoneInfo("America/Sao_Paulo")
CROP_COEFFICIENT = {"soja": 1.0, "milho": 1.12, "cana": 1.08, "cafe": 0.92, "trigo": 0.96, "algodao": 1.05}


def _stable_seed(*parts):
    value = "|".join(str(part) for part in parts).encode("utf-8")
    return int.from_bytes(hashlib.sha256(value).digest()[:8], "big")


def _daily_climate(field_id, day):
    rng = random.Random(_stable_seed(field_id, day.isoformat()))
    field_base = 22 + (_stable_seed(field_id) % 600) / 100
    seasonal = 2.5 * math.sin(2 * math.pi * (day.timetuple().tm_yday - 35) / 365)
    center_temp = field_base + seasonal + rng.gauss(0, 1.4)
    if rng.random() < 0.32:
        rain_start = rng.uniform(12 * 60, 19 * 60)
        rain_duration = rng.uniform(1.0, 3.5)
        rain_total = rng.uniform(2.0, 24.0)
    else:
        rain_start = rain_duration = rain_total = 0.0
    return center_temp, rain_start, rain_duration, rain_total


def field_climate(field_id, ts, minutes):
    """Generate coherent synthetic weather shared by sensors in one field."""
    end_local = ts.astimezone(LOCAL_TZ)
    start_local = end_local - timedelta(minutes=minutes)
    hour = end_local.hour + end_local.minute / 60
    center_temp, _, _, _ = _daily_climate(field_id, end_local.date())
    air_temp = center_temp + 5.5 * math.sin(2 * math.pi * (hour - 9) / 24)
    soil_temp = center_temp + 2.0 * math.sin(2 * math.pi * (hour - 11) / 24)
    rainfall = 0.0
    day = start_local.date()
    while day <= end_local.date():
        _, rain_start, rain_duration, rain_total = _daily_climate(field_id, day)
        if rain_total:
            event_start = datetime.combine(day, datetime.min.time(), tzinfo=LOCAL_TZ) + timedelta(minutes=rain_start)
            event_end = event_start + timedelta(hours=rain_duration)
            overlap = max(0.0, (min(end_local, event_end) - max(start_local, event_start)).total_seconds())
            rainfall += rain_total * overlap / (rain_duration * 3600)
        day += timedelta(days=1)
    return {"air_temp": air_temp, "soil_temp": soil_temp, "rainfall_mm": rainfall}


def _utc(value):
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def irrigation_events_for(db, field_ids):
    if not field_ids or not hasattr(db, "operations"):
        return {}
    events = {}
    cutoff = datetime.now(UTC) - timedelta(days=365)
    query = {"field_id": {"$in": list(field_ids)}, "type": "irrigacao", "date": {"$gte": cutoff}}
    for operation in db.operations.find(query):
        if operation.get("source", "simulated") == "simulated":
            events.setdefault(operation["field_id"], []).append(operation)
    return events


def field_metadata_for(db, field_ids):
    if not field_ids or not hasattr(db, "fields"):
        return {}
    fields = db.fields.find({"_id": {"$in": list(field_ids)}})
    return {field["_id"]: field for field in fields}


class SensorModel:
    def __init__(self, seed, field_id=None, crop="soja"):
        self.rng = random.Random(seed)
        self.field_id = str(field_id if field_id is not None else seed)
        self.crop = crop
        self.moisture = self.rng.uniform(29, 43)
        self.base_temp = self.rng.uniform(22, 28)

    def restore(self, reading):
        if reading and "soil_moisture" in reading:
            self.moisture = min(65.0, max(8.0, float(reading["soil_moisture"])))

    def step(self, ts, minutes, climate=None, irrigation_events=()):
        climate = climate or field_climate(self.field_id, ts, minutes)
        local = ts.astimezone(LOCAL_TZ)
        hour = local.hour + local.minute / 60
        daylight = max(0.0, math.sin(2 * math.pi * (hour - 6) / 24))
        rain = climate["rainfall_mm"]
        irrigation_mm = 0.0
        for event in irrigation_events:
            if ts - timedelta(minutes=minutes) < _utc(event["date"]) <= ts:
                details = event.get("details") or {}
                operation_data = details.get("operation_data") or {}
                irrigation_mm += max(0.0, float(operation_data.get("water_depth_mm") or 0))
        crop_factor = CROP_COEFFICIENT.get(self.crop, 1.0)
        drying = 0.075 * (minutes / 60) * crop_factor * (0.4 + daylight) * max(0.55, climate["air_temp"] / 25)
        moisture = self.moisture - drying + rain * 0.38 + irrigation_mm * 0.34
        moisture += self.rng.gauss(0, 0.025 * math.sqrt(max(minutes, 1) / 5))
        self.moisture = min(65.0, max(8.0, moisture))
        return {
            "soil_moisture": round(self.moisture, 2),
            "soil_temp": round(climate["soil_temp"] + self.rng.gauss(0, 0.18), 2),
            "air_temp": round(climate["air_temp"] + self.rng.gauss(0, 0.28), 2),
            "rainfall_mm": round(rain, 2),
        }


def build_document(sensor, ts, values):
    meta = {
        "sensor_id": sensor["_id"],
        "field_id": sensor["field_id"],
        "farm_id": sensor["farm_id"],
        "source": "simulated",
        "simulation_version": SIMULATION_VERSION,
    }
    return {"ts": ts, "meta": meta, **values}


def load_models(db):
    sensors = list(db.sensors.find({"active": True}))
    sensors = [sensor for sensor in sensors if sensor.get("source", "simulated") == "simulated"]
    field_ids = {sensor["field_id"] for sensor in sensors}
    events = irrigation_events_for(db, field_ids)
    fields = field_metadata_for(db, field_ids)
    models = []
    for sensor in sensors:
        field = fields.get(sensor["field_id"], {})
        model = SensorModel(str(sensor["_id"]), sensor["field_id"], field.get("crop", "soja"))
        model.irrigation_events = events.get(sensor["field_id"], [])
        models.append((sensor, model))
    return models


def refresh_models(db, models):
    """Refresh active sensors while retaining the simulation state by sensor ID."""
    existing = {sensor["_id"]: model for sensor, model in models}
    refreshed = []
    sensors = [
        sensor for sensor in db.sensors.find({"active": True})
        if sensor.get("source", "simulated") == "simulated"
    ]
    field_ids = {sensor["field_id"] for sensor in sensors}
    events = irrigation_events_for(db, field_ids)
    fields = field_metadata_for(db, field_ids)
    for sensor in sensors:
        model = existing.get(sensor["_id"])
        if model is None:
            field = fields.get(sensor["field_id"], {})
            model = SensorModel(str(sensor["_id"]), sensor["field_id"], field.get("crop", "soja"))
            if hasattr(db, "sensor_readings"):
                model.restore(latest_reading(db, sensor["_id"]))
        else:
            model.field_id = str(sensor["field_id"])
            field = fields.get(sensor["field_id"])
            if field:
                model.crop = field.get("crop", "soja")
        model.irrigation_events = events.get(sensor["field_id"], [])
        refreshed.append((sensor, model))
    return refreshed


def wait_for_models(db):
    while True:
        models = load_models(db)
        if models:
            return models
        log.info("nenhum sensor cadastrado ainda; rode 'make seed'. Nova tentativa em 10s")
        time.sleep(10)


def backfill(db, models, days, step_minutes):
    if days < 1 or step_minutes < 1:
        raise ValueError("days e step_minutes devem ser positivos")
    end = datetime.now(UTC).replace(second=0, microsecond=0)
    ts = end - timedelta(days=days)
    batch = []
    total = 0
    while ts < end:
        for sensor, model in models:
            climate = field_climate(model.field_id, ts, step_minutes)
            values = model.step(ts, step_minutes, climate, getattr(model, "irrigation_events", ()))
            batch.append(build_document(sensor, ts, values))
        if len(batch) >= BATCH_SIZE:
            db.sensor_readings.insert_many(batch, ordered=False)
            total += len(batch)
            batch = []
            log.info("backfill: %s leituras inseridas", f"{total:,}")
        ts += timedelta(minutes=step_minutes)
    if batch:
        db.sensor_readings.insert_many(batch, ordered=False)
        total += len(batch)
    log.info("backfill concluído: %s leituras", f"{total:,}")


def latest_reading(db, sensor_id):
    return db.sensor_readings.find_one(
        {"meta.sensor_id": sensor_id}, sort=[("ts", -1)]
    )


def fill_gaps(db, models, now=None, step_seconds=60, max_days=7):
    """Fill missed live samples per sensor, capped to the guide's seven days."""
    if step_seconds < 1:
        raise ValueError("step_seconds deve ser positivo")
    now = now or datetime.now(UTC)
    if now.tzinfo is None:
        now = now.replace(tzinfo=UTC)
    now = now.astimezone(UTC).replace(microsecond=0)
    step = timedelta(seconds=step_seconds)
    max_age = timedelta(days=max_days)
    batch = []
    total = 0
    for sensor, model in models:
        last = latest_reading(db, sensor["_id"])
        if last:
            last_ts = last["ts"]
            if last_ts.tzinfo is None:
                last_ts = last_ts.replace(tzinfo=UTC)
            last_ts = last_ts.astimezone(UTC)
            start = last_ts + step
            if now - last_ts > max_age:
                # Retain no more than seven days of synthetic catch-up work.
                start = now - max_age
            model.restore(last)
            if "air_temp" in last:
                model.base_temp = float(last["air_temp"])
        else:
            # A live-only deployment still emits its first sample promptly.
            start = now

        ts = start
        while ts <= now:
            minutes = step_seconds / 60
            climate = field_climate(model.field_id, ts, minutes)
            values = model.step(ts, minutes, climate, getattr(model, "irrigation_events", ()))
            batch.append(build_document(sensor, ts, values))
            if len(batch) >= BATCH_SIZE:
                db.sensor_readings.insert_many(batch, ordered=False)
                total += len(batch)
                batch = []
            ts += step
    if batch:
        db.sensor_readings.insert_many(batch, ordered=False)
        total += len(batch)
    if total:
        log.info("lacunas preenchidas: %s leituras", f"{total:,}")
    return total


def live(db, models, interval_seconds):
    if interval_seconds < 1:
        raise ValueError("interval_seconds deve ser positivo")
    log.info("modo ao vivo: %s sensores a cada %ss", len(models), interval_seconds)
    while True:
        models = refresh_models(db, models)
        if not models:
            log.info("nenhum sensor ativo; nova tentativa em %ss", interval_seconds)
            time.sleep(interval_seconds)
            continue
        ts = datetime.now(UTC).replace(microsecond=0)
        documents = [
            build_document(
                sensor,
                ts,
                model.step(
                    ts,
                    interval_seconds / 60,
                    field_climate(model.field_id, ts, interval_seconds / 60),
                    getattr(model, "irrigation_events", ()),
                ),
            )
            for sensor, model in models
        ]
        db.sensor_readings.insert_many(documents, ordered=False)
        time.sleep(interval_seconds)


def main():
    setup_logging()
    parser = argparse.ArgumentParser()
    parser.add_argument("--backfill-days", type=int, default=0)
    parser.add_argument("--step-minutes", type=int, default=5)
    parser.add_argument("--live", action="store_true")
    parser.add_argument(
        "--interval", type=int, default=int(os.environ.get("SIM_INTERVAL_SECONDS", "10"))
    )
    args = parser.parse_args()
    if args.backfill_days < 0 or args.step_minutes < 1 or args.interval < 1:
        parser.error(
            "backfill-days não pode ser negativo; step-minutes e interval devem ser positivos"
        )

    db = get_db()
    models = wait_for_models(db)

    if args.backfill_days:
        if db.sensor_readings.count_documents({}, limit=1) == 0:
            backfill(db, models, args.backfill_days, args.step_minutes)
        else:
            log.info("já existem leituras; backfill ignorado")

    if args.live:
        fill_gaps(
            db,
            models,
            now=datetime.now(UTC) - timedelta(seconds=args.interval),
            step_seconds=args.interval,
            max_days=7,
        )
        live(db, models, args.interval)


if __name__ == "__main__":
    main()
