import logging
import os

from pymongo import MongoClient

DEFAULT_URI = "mongodb://localhost:27017/?directConnection=true"


def setup_logging():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )


def get_db():
    client = MongoClient(os.environ.get("MONGO_URI", DEFAULT_URI), tz_aware=True)
    return client[os.environ.get("MONGO_DB", "agropulse")]
