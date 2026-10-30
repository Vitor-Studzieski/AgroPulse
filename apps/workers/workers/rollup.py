import argparse
import logging
from datetime import UTC, datetime, timedelta

from workers.common import get_db, setup_logging

log = logging.getLogger("rollup")


def build_pipeline(since):
    return [
        {"$match": {"ts": {"$gte": since}}},
        {
            "$group": {
                "_id": {
                    "field_id": "$meta.field_id",
                    "day": {"$dateTrunc": {"date": "$ts", "unit": "day"}},
                },
                "moisture_avg": {"$avg": "$soil_moisture"},
                "moisture_min": {"$min": "$soil_moisture"},
                "moisture_max": {"$max": "$soil_moisture"},
                "air_temp_avg": {"$avg": "$air_temp"},
                "rain_mm": {"$sum": "$rainfall_mm"},
                "readings": {"$sum": 1},
            }
        },
        {
            "$project": {
                "_id": 0,
                "field_id": "$_id.field_id",
                "day": "$_id.day",
                "moisture_avg": {"$round": ["$moisture_avg", 2]},
                "moisture_min": 1,
                "moisture_max": 1,
                "air_temp_avg": {"$round": ["$air_temp_avg", 2]},
                "rain_mm": {"$round": ["$rain_mm", 2]},
                "readings": 1,
            }
        },
        {
            "$merge": {
                "into": "field_daily_stats",
                "on": ["field_id", "day"],
                "whenMatched": "replace",
                "whenNotMatched": "insert",
            }
        },
    ]


def main():
    setup_logging()
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=30)
    args = parser.parse_args()

    db = get_db()
    since = (datetime.now(UTC) - timedelta(days=args.days)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    list(db.sensor_readings.aggregate(build_pipeline(since)))
    total = db.field_daily_stats.estimated_document_count()
    log.info("rollup concluído: %s documentos em field_daily_stats", total)


if __name__ == "__main__":
    main()
