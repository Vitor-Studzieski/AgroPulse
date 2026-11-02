from datetime import datetime, timezone


def as_utc(value: datetime) -> datetime:
    """Interpret naive API timestamps as UTC and normalize aware timestamps to UTC."""
    if value.tzinfo is None or value.utcoffset() is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)
