import argparse
import io
import logging
import shutil
import tempfile
import urllib.request
import zipfile
from pathlib import Path

import pandas as pd

from workers.common import get_db, setup_logging

log = logging.getLogger("inmet")

URL_TEMPLATE = "https://portal.inmet.gov.br/uploads/dadoshistoricos/{year}.zip"
METADATA_LINES = 8
BATCH_SIZE = 10_000
COLUMN_KEYS = {
    "rain_mm": "PRECIPITA",
    "air_temp": "TEMPERATURA DO AR - BULBO SECO",
    "humidity": "UMIDADE RELATIVA DO AR",
    "wind_ms": "VENTO, VELOCIDADE",
}


def to_float(text):
    try:
        return float(text.replace(",", "."))
    except ValueError:
        return None


def parse_metadata(lines):
    values = {}
    for line in lines:
        key, _, value = line.partition(";")
        values[key.strip().rstrip(":").upper()] = value.strip().strip(";").strip()
    return {
        "code": values["CODIGO (WMO)"],
        "name": values["ESTACAO"],
        "state": values["UF"],
        "region": values["REGIAO"],
        "location": {
            "type": "Point",
            "coordinates": [to_float(values["LONGITUDE"]), to_float(values["LATITUDE"])],
        },
        "altitude_m": to_float(values.get("ALTITUDE", "")),
    }


def parse_dates(series):
    text = series.astype(str).str.strip().str.replace("/", "-", regex=False)
    year_first = len(text.iloc[0].split("-")[0]) == 4
    return pd.to_datetime(text, format="%Y-%m-%d" if year_first else "%d-%m-%Y", errors="coerce")


def parse_station(text):
    lines = text.splitlines()
    station = parse_metadata(lines[:METADATA_LINES])
    frame = pd.read_csv(
        io.StringIO("\n".join(lines[METADATA_LINES:])),
        sep=";",
        decimal=",",
        na_values=["-9999"],
    )
    if frame.empty:
        return station, pd.DataFrame(columns=["ts", *COLUMN_KEYS])

    hours = frame[frame.columns[1]].astype(str).str.extract(r"(\d{1,2}):?(\d{2})")
    ts = (
        parse_dates(frame[frame.columns[0]])
        + pd.to_timedelta(pd.to_numeric(hours[0], errors="coerce"), unit="h")
        + pd.to_timedelta(pd.to_numeric(hours[1], errors="coerce"), unit="m")
    ).dt.tz_localize("UTC")

    columns = {"ts": ts}
    for name, key in COLUMN_KEYS.items():
        match = next((c for c in frame.columns if key in str(c).upper()), None)
        columns[name] = pd.to_numeric(frame[match], errors="coerce") if match else float("nan")
    return station, pd.DataFrame(columns).dropna(subset=["ts"])


def to_documents(station, frame):
    meta = {"code": station["code"], "state": station["state"]}
    documents = []
    for row in frame.to_dict("records"):
        document = {"ts": row.pop("ts").to_pydatetime(), "station": dict(meta)}
        document.update({key: float(value) for key, value in row.items() if pd.notna(value)})
        documents.append(document)
    return documents


def load_station(db, station, frame):
    db.weather_stations.replace_one({"code": station["code"]}, station, upsert=True)
    if frame.empty:
        return 0
    start = frame["ts"].min().to_pydatetime()
    end = frame["ts"].max().to_pydatetime()
    db.weather_hourly.delete_many(
        {"station.code": station["code"], "ts": {"$gte": start, "$lte": end}}
    )
    documents = to_documents(station, frame)
    for offset in range(0, len(documents), BATCH_SIZE):
        db.weather_hourly.insert_many(documents[offset : offset + BATCH_SIZE], ordered=False)
    return len(documents)


def import_zip(db, path, states):
    total = 0
    with zipfile.ZipFile(path) as archive:
        for name in sorted(archive.namelist()):
            if not name.upper().endswith(".CSV"):
                continue
            station, frame = parse_station(archive.read(name).decode("latin-1"))
            if states and station["state"] not in states:
                continue
            count = load_station(db, station, frame)
            total += count
            log.info("%s (%s): %s leituras", station["name"], station["state"], f"{count:,}")
    return total


def download(year):
    target = Path(tempfile.gettempdir()) / f"inmet-{year}.zip"
    if not target.exists():
        request = urllib.request.Request(
            URL_TEMPLATE.format(year=year), headers={"User-Agent": "agropulse-importer"}
        )
        with urllib.request.urlopen(request, timeout=120) as response, open(target, "wb") as out:
            shutil.copyfileobj(response, out)
    return target


def main():
    setup_logging()
    parser = argparse.ArgumentParser()
    parser.add_argument("--year", type=int, required=True)
    parser.add_argument("--states", nargs="*", default=[])
    parser.add_argument("--file", type=Path)
    args = parser.parse_args()

    path = args.file or download(args.year)
    total = import_zip(get_db(), path, set(args.states))
    log.info("importação concluída: %s leituras", f"{total:,}")


if __name__ == "__main__":
    main()
