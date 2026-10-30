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
        urllib.request.urlopen(request, timeout=5).close()
    except OSError:
        log.exception("webhook indisponível")


def notifier_loop(db, webhook_url):
    pipeline = [{"$match": {"operationType": "insert"}}]
    with db.alerts.watch(pipeline) as stream:
        for change in stream:
            payload = build_payload(change["fullDocument"])
            log.warning("ALERTA %s", payload)
            if webhook_url:
                send_webhook(webhook_url, payload)


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
