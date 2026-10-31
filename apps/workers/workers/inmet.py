import argparse
import io
import logging
import math
import os
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
        value = float(text.replace(",", "."))
    except (AttributeError, ValueError):
        return None
    return value if math.isfinite(value) else None


def parse_metadata(lines):
    values = {}
    for line in lines:
        key, _, value = line.partition(";")
        values[key.strip().rstrip(":").upper()] = value.strip().strip(";").strip()
    longitude = to_float(values.get("LONGITUDE", ""))
    latitude = to_float(values.get("LATITUDE", ""))
    if (
        longitude is None
        or latitude is None
        or not -180 <= longitude <= 180
        or not -90 <= latitude <= 90
    ):
        raise ValueError("estação INMET com coordenadas WGS84 inválidas")

    return {
        "code": values["CODIGO (WMO)"],
        "name": values["ESTACAO"],
        "state": values["UF"],
        "region": values["REGIAO"],
        "location": {
            "type": "Point",
            "coordinates": [longitude, latitude],
        },
        "altitude_m": to_float(values.get("ALTITUDE", "")),
    }


def parse_dates(series):
    def parse_one(value):
        text = str(value).strip().replace("/", "-")
        if not text or text.lower() == "nan":
            return pd.NaT
        if len(text.split("-")[0]) == 4:
            formats = ("%Y-%m-%d", "%Y%m%d")
        else:
            formats = ("%d-%m-%Y", "%d-%m-%y")
        for date_format in formats:
            parsed = pd.to_datetime(text, format=date_format, errors="coerce")
            if pd.notna(parsed):
                return parsed
        return pd.NaT

    return pd.to_datetime(series.map(parse_one), errors="coerce")


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
        for key, value in row.items():
            if pd.notna(value):
                number = float(value)
                if math.isfinite(number):
                    document[key] = number
        documents.append(document)
    return documents


def load_station(db, station, frame):
    db.weather_stations.replace_one({"code": station["code"]}, station, upsert=True)
    if frame.empty:
        return 0
    frame = frame.drop_duplicates(subset=["ts"], keep="last").sort_values("ts")
    start = frame["ts"].min().to_pydatetime()
    end = frame["ts"].max().to_pydatetime()
    db.weather_hourly.delete_many(
        {"station.code": station["code"], "ts": {"$gte": start, "$lte": end}}
    )
    documents = to_documents(station, frame)
    for offset in range(0, len(documents), BATCH_SIZE):
        db.weather_hourly.insert_many(documents[offset : offset + BATCH_SIZE], ordered=False)
    return len(documents)


def import_zip(db, path, states, year=None):
    total = 0
    states = {state.strip().upper() for state in states if state.strip()}
    if not states:
        raise ValueError("Informe ao menos uma UF para limitar a importação do INMET.")
    with zipfile.ZipFile(path) as archive:
        for name in sorted(archive.namelist()):
            if not name.upper().endswith(".CSV"):
                continue
            try:
                station, frame = parse_station(archive.read(name).decode("latin-1"))
            except (KeyError, ValueError, pd.errors.ParserError) as error:
                log.warning("CSV de estação ignorado (%s): %s", name, error)
                continue
            if states and station["state"] not in states:
                continue
            if year is not None:
                frame = frame[frame["ts"].dt.year == year]
            count = load_station(db, station, frame)
            total += count
            log.info("%s (%s): %s leituras", station["name"], station["state"], f"{count:,}")
    return total


def download(year):
    target = Path(tempfile.gettempdir()) / f"inmet-{year}.zip"
    if not target.exists():
        temporary = target.with_suffix(".zip.part")
        request = urllib.request.Request(
            URL_TEMPLATE.format(year=year), headers={"User-Agent": "agropulse-importer"}
        )
        try:
            with urllib.request.urlopen(request, timeout=120) as response, open(
                temporary, "wb"
            ) as out:
                shutil.copyfileobj(response, out)
            os.replace(temporary, target)
        finally:
            temporary.unlink(missing_ok=True)
    return target


def main():
    setup_logging()
    parser = argparse.ArgumentParser()
    parser.add_argument("--year", type=int, required=True)
    parser.add_argument("--states", nargs="+", required=True)
    parser.add_argument("--file", type=Path)
    args = parser.parse_args()

    path = args.file or download(args.year)
    total = import_zip(get_db(), path, set(args.states), args.year)
    log.info("importação concluída: %s leituras", f"{total:,}")


if __name__ == "__main__":
    main()
