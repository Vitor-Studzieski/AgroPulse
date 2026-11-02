import argparse
import logging
import math
import os
import random
import time
from datetime import UTC, datetime, timedelta

from workers.common import get_db, setup_logging

log = logging.getLogger("simulator")
BATCH_SIZE = 10_000


class SensorModel:
    def __init__(self, seed):
        self.rng = random.Random(seed)
        self.moisture = self.rng.uniform(25, 45)
        self.base_temp = self.rng.uniform(22, 28)

    def step(self, ts, minutes):
        hour = ts.hour + ts.minute / 60
        daily = math.sin((hour - 9) / 24 * 2 * math.pi)
        air_temp = self.base_temp + 6 * daily + self.rng.gauss(0, 0.4)
        soil_temp = self.base_temp + 3 * math.sin((hour - 12) / 24 * 2 * math.pi)
        soil_temp += self.rng.gauss(0, 0.2)
        rain = 0.0
        if self.rng.random() < 0.004 * minutes / 5:
            rain = self.rng.uniform(1, 12)
        drying = 0.02 * minutes / 5 * (1 + max(daily, 0))
        moisture = self.moisture - drying + rain * 1.2 + self.rng.gauss(0, 0.05)
        self.moisture = min(60.0, max(5.0, moisture))
        return {
            "soil_moisture": round(self.moisture, 2),
            "soil_temp": round(soil_temp, 2),
            "air_temp": round(air_temp, 2),
            "rainfall_mm": round(rain, 2),
        }


def build_document(sensor, ts, values):
    meta = {
        "sensor_id": sensor["_id"],
        "field_id": sensor["field_id"],
        "farm_id": sensor["farm_id"],
    }
    return {"ts": ts, "meta": meta, **values}


def load_models(db):
    sensors = list(db.sensors.find({"active": True}))
    return [(sensor, SensorModel(str(sensor["_id"]))) for sensor in sensors]


def refresh_models(db, models):
    """Refresh active sensors while retaining the simulation state by sensor ID."""
    existing = {sensor["_id"]: model for sensor, model in models}
    refreshed = []
    for sensor in db.sensors.find({"active": True}):
        model = existing.get(sensor["_id"])
        if model is None:
            model = SensorModel(str(sensor["_id"]))
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
            batch.append(build_document(sensor, ts, model.step(ts, step_minutes)))
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
            if "soil_moisture" in last:
                model.moisture = float(last["soil_moisture"])
            if "air_temp" in last:
                hour = last_ts.hour + last_ts.minute / 60
                daily = math.sin((hour - 9) / 24 * 2 * math.pi)
                model.base_temp = float(last["air_temp"]) - 6 * daily
        else:
            # A live-only deployment still emits its first sample promptly.
            start = now

        ts = start
        while ts <= now:
            batch.append(build_document(sensor, ts, model.step(ts, step_seconds / 60)))
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
            build_document(sensor, ts, model.step(ts, interval_seconds / 60))
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
