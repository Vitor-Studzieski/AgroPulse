import json
import logging
import os
import threading
import time
import urllib.request
from datetime import UTC, datetime, timedelta

from workers.common import get_db, setup_logging

log = logging.getLogger("alerts")

OPERATORS = {"lt": lambda value, limit: value < limit, "gt": lambda value, limit: value > limit}
CLAIM_FIELD = "notification_claimed_at"
NOTIFIED_FIELD = "notified_at"
CLAIM_LEASE_SECONDS = 120


def breached(value, operator, threshold):
    return OPERATORS[operator](value, threshold)


def window_average(db, rule):
    since = datetime.now(UTC) - timedelta(minutes=rule["window_minutes"])
    pipeline = [
        {"$match": {"meta.field_id": rule["field_id"], "ts": {"$gte": since}}},
        {"$group": {"_id": None, "value": {"$avg": f"${rule['metric']}"}}},
    ]
    result = list(db.sensor_readings.aggregate(pipeline))
    return result[0]["value"] if result else None


def evaluate_rule(db, rule):
    value = window_average(db, rule)
    if value is None:
        return
    open_alert = db.alerts.find_one({"rule_id": rule["_id"], "status": "open"})
    if breached(value, rule["operator"], rule["threshold"]):
        if open_alert is None:
            db.alerts.insert_one(
                {
                    "rule_id": rule["_id"],
                    "field_id": rule["field_id"],
                    "metric": rule["metric"],
                    "value": round(value, 2),
                    "threshold": float(rule["threshold"]),
                    "status": "open",
                    "triggered_at": datetime.now(UTC),
                }
            )
    elif open_alert is not None:
        db.alerts.update_one(
            {"_id": open_alert["_id"]},
            {"$set": {"status": "resolved", "resolved_at": datetime.now(UTC)}},
        )


def evaluator_loop(db, interval_seconds):
    while True:
        for rule in db.alert_rules.find({"active": True}):
            try:
                evaluate_rule(db, rule)
            except Exception:
                log.exception("falha ao avaliar regra %s", rule["_id"])
        time.sleep(interval_seconds)


def build_payload(alert):
    return {
        "alert_id": str(alert["_id"]),
        "field_id": str(alert["field_id"]),
        "metric": alert["metric"],
        "value": alert["value"],
        "threshold": alert["threshold"],
        "triggered_at": alert["triggered_at"].isoformat(),
    }


def send_webhook(url, payload):
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            return 200 <= response.status < 300
    except OSError:
        log.exception("webhook indisponível")
        return False


def claim_alert(db, alert_id, now=None):
    """Atomically claim an unnotified alert, reclaiming expired worker leases."""
    now = now or datetime.now(UTC)
    expired_before = now - timedelta(seconds=CLAIM_LEASE_SECONDS)
    result = db.alerts.update_one(
        {
            "_id": alert_id,
            NOTIFIED_FIELD: {"$exists": False},
            "$or": [
                {CLAIM_FIELD: {"$exists": False}},
                {CLAIM_FIELD: {"$lte": expired_before}},
            ],
        },
        {"$set": {CLAIM_FIELD: now}},
    )
    return result.modified_count == 1


def dispatch_alert(db, alert, webhook_url):
    now = datetime.now(UTC)
    if not claim_alert(db, alert["_id"], now):
        return False
    payload = build_payload(alert)
    log.warning("ALERTA %s", payload)
    if webhook_url and not send_webhook(webhook_url, payload):
        db.alerts.update_one(
            {"_id": alert["_id"], CLAIM_FIELD: now},
            {"$unset": {CLAIM_FIELD: ""}},
        )
        log.error("webhook do alerta %s falhou; o alerta continuará pendente", alert["_id"])
        return False
    db.alerts.update_one(
        {"_id": alert["_id"], CLAIM_FIELD: now},
        {
            "$set": {NOTIFIED_FIELD: datetime.now(UTC)},
            "$unset": {CLAIM_FIELD: ""},
        },
    )
    return True


def dispatch_pending(db, webhook_url):
    """Recover alerts created while the notifier was offline."""
    cursor = db.alerts.find({NOTIFIED_FIELD: {"$exists": False}}).sort("triggered_at", 1)
    return sum(dispatch_alert(db, alert, webhook_url) for alert in cursor)


def notifier_loop(db, webhook_url):
    pipeline = [{"$match": {"operationType": "insert"}}]
    while True:
        try:
            # Open the stream before scanning pending alerts. An insert racing
            # with the scan is then either found by the scan or delivered by
            # the stream; the atomic claim makes the overlap harmless.
            with db.alerts.watch(pipeline, max_await_time_ms=1000) as stream:
                recovered = dispatch_pending(db, webhook_url)
                if recovered:
                    log.info("alertas pendentes recuperados: %s", recovered)
                next_retry = time.monotonic() + 30
                while stream.alive:
                    change = stream.try_next()
                    if change:
                        dispatch_alert(db, change["fullDocument"], webhook_url)
                    if time.monotonic() >= next_retry:
                        recovered = dispatch_pending(db, webhook_url)
                        if recovered:
                            log.info("alertas pendentes recuperados: %s", recovered)
                        next_retry = time.monotonic() + 30
        except Exception:
            log.exception("change stream de alertas indisponível; nova tentativa em 5s")
            time.sleep(5)


def main():
    setup_logging()
    db = get_db()
    interval = int(os.environ.get("ALERT_EVAL_SECONDS", "30"))
    webhook_url = os.environ.get("ALERT_WEBHOOK_URL", "")
    threading.Thread(target=notifier_loop, args=(db, webhook_url), daemon=True).start()
    log.info("avaliando regras a cada %ss", interval)
    evaluator_loop(db, interval)


if __name__ == "__main__":
    main()
