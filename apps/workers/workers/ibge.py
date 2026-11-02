"""Importa a PAM/SIDRA exportada em CSV para ``ibge_production``.

O CSV pode estar no formato longo do SIDRA (uma linha por variável) ou no
formato largo (uma coluna por variável). O importador exige ano e UFs para
evitar carregar a PAM inteira em um cluster MongoDB gratuito.
"""

import argparse
import logging
import math
import re
import unicodedata
from pathlib import Path

import pandas as pd
from pymongo import UpdateOne

from workers.common import get_db, setup_logging

log = logging.getLogger("ibge")
BATCH_SIZE = 500
DEFAULT_CROPS = ("soja", "milho", "cana")
METRIC_NAMES = ("planted_area_ha", "production_t", "yield_kg_ha")


def invalid_metrics(record):
    invalid = {}
    for metric in METRIC_NAMES:
        value = record.get(metric)
        if value is None:
            continue
        try:
            number = float(value)
        except (TypeError, ValueError, OverflowError):
            invalid[metric] = value
            continue
        if not math.isfinite(number) or number < 0:
            invalid[metric] = value
    return invalid


def set_metric(record, metric, value, row_number):
    if value is not None and (not math.isfinite(value) or value < 0):
        log.warning(
            "linha SIDRA %s: %s fora da faixa [0, sem máximo]: %s; valor ignorado",
            row_number,
            metric,
            value,
        )
        record[metric] = None
        return
    record[metric] = value

STATE_CODES = {
    "11": "RO", "12": "AC", "13": "AM", "14": "RR", "15": "PA", "16": "AP",
    "17": "TO", "21": "MA", "22": "PI", "23": "CE", "24": "RN", "25": "PB",
    "26": "PE", "27": "AL", "28": "SE", "29": "BA", "31": "MG", "32": "ES",
    "33": "RJ", "35": "SP", "41": "PR", "42": "SC", "43": "RS", "50": "MS",
    "51": "MT", "52": "GO", "53": "DF",
}
STATE_NAMES = {
    "rondonia": "RO", "acre": "AC", "amazonas": "AM", "roraima": "RR",
    "para": "PA", "amapa": "AP", "tocantins": "TO", "maranhao": "MA",
    "piaui": "PI", "ceara": "CE", "rio grande do norte": "RN",
    "paraiba": "PB", "pernambuco": "PE", "alagoas": "AL", "sergipe": "SE",
    "bahia": "BA", "minas gerais": "MG", "espirito santo": "ES",
    "rio de janeiro": "RJ", "sao paulo": "SP", "parana": "PR",
    "santa catarina": "SC", "rio grande do sul": "RS", "mato grosso do sul": "MS",
    "mato grosso": "MT", "goias": "GO", "distrito federal": "DF",
}

COLUMN_ALIASES = {
    "year": ("ano", "year"),
    "ibge_code": ("municipio codigo", "codigo do municipio", "ibge code", "ibge_code"),
    "municipality": ("municipio", "municipality", "nome do municipio"),
    "state": ("unidade da federacao", "uf", "state", "unidade federativa"),
    "state_code": ("unidade da federacao codigo", "uf codigo", "state code"),
    "crop": (
        "produto das lavouras temporarias e permanentes",
        "produto das lavouras temporarias", "produto", "cultura", "crop",
    ),
    "variable": ("variavel", "variable"),
    "value": ("valor", "value"),
    "planted_area_ha": (
        "area plantada ou destinada a colheita", "area plantada", "planted area ha",
    ),
    "production_t": ("quantidade produzida", "producao t", "production t"),
    "yield_kg_ha": (
        "rendimento medio da producao", "rendimento medio", "yield kg ha",
    ),
}


def normalize_text(value):
    text = unicodedata.normalize("NFKD", str(value))
    text = "".join(char for char in text if not unicodedata.combining(char))
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def normalize_state(value):
    text = str(value).strip().upper()
    if text in STATE_CODES.values():
        return text
    if text in STATE_CODES:
        return STATE_CODES[text]
    return STATE_NAMES.get(normalize_text(value))


def normalize_crop(value):
    text = normalize_text(value)
    if "soja" in text:
        return "soja"
    if "milho" in text:
        return "milho"
    if "cana" in text:
        return "cana"
    return None


def parse_number(value):
    """Converte valores SIDRA brasileiros e ignora marcadores de dado ausente."""
    text = str(value).strip().replace("\xa0", "")
    if not text or text.lower() in {"...", "-", "x", "na", "nan"}:
        return None
    text = text.replace("%", "")
    if "," in text and "." in text:
        if text.rfind(",") > text.rfind("."):
            text = text.replace(".", "").replace(",", ".")
        else:
            text = text.replace(",", "")
    elif "," in text:
        text = text.replace(".", "").replace(",", ".")
    elif "." in text:
        parts = text.split(".")
        if len(parts) > 1 and all(len(part) == 3 for part in parts[1:]):
            text = "".join(parts)
    try:
        number = float(text)
    except ValueError:
        return None
    return number if math.isfinite(number) else None


def find_column(frame, key, required=True):
    aliases = {normalize_text(alias) for alias in COLUMN_ALIASES[key]}
    columns = {normalize_text(column): column for column in frame.columns}
    for alias in aliases:
        if alias in columns:
            return columns[alias]
    # SIDRA exports may append units, such as “(Hectares)”, to a variable.
    for normalized, original in columns.items():
        if any(normalized.startswith(alias + " ") for alias in aliases):
            return original
    if required:
        raise ValueError(f"CSV do SIDRA sem coluna reconhecida para {key!r}: {list(frame.columns)}")
    return None


def infer_state(state_value, state_code, ibge_code):
    state = normalize_state(state_value) if state_value else None
    if not state and state_code:
        state = normalize_state(state_code)
    if not state and ibge_code:
        state = STATE_CODES.get(str(ibge_code).strip()[:2])
    return state


def _base_dimensions(frame):
    columns = {
        key: find_column(frame, key, required=key not in {"state", "state_code"})
        for key in ("year", "ibge_code", "municipality", "state", "state_code", "crop")
    }
    # Município exports sometimes provide only a code. The API ranking still
    # needs a readable name, so reject that incomplete input clearly.
    return columns


def parse_frame(frame, year, states, crops=DEFAULT_CROPS):
    """Return complete, canonical documents after applying storage-safe filters."""
    if frame.empty:
        return []
    dimensions = _base_dimensions(frame)
    variable_column = find_column(frame, "variable", required=False)
    value_column = find_column(frame, "value", required=False)
    wide_columns = {
        key: find_column(frame, key, required=False)
        for key in ("planted_area_ha", "production_t", "yield_kg_ha")
    }
    long_format = variable_column is not None and value_column is not None
    if not long_format and not all(wide_columns.values()):
        raise ValueError(
            "CSV precisa ter as variáveis SIDRA em colunas ou as colunas 'Variável' e 'Valor'."
        )

    selected_states = {normalize_state(state) for state in states}
    selected_states.discard(None)
    selected_crops = {normalize_crop(crop) for crop in crops}
    selected_crops.discard(None)
    if not selected_states:
        raise ValueError("Informe ao menos uma UF válida (ex.: --states MT SP).")
    if not selected_crops:
        raise ValueError("Informe ao menos uma cultura suportada: soja, milho ou cana.")

    # SIDRA CSV values are strings: retain their spelling for Brazilian decimal
    # separators and avoid converting municipality codes to floating point.
    records = {}
    for row_number, row in enumerate(frame.to_dict("records"), start=2):
        row_year = parse_number(row[dimensions["year"]])
        code_value = str(row[dimensions["ibge_code"]]).strip()
        if code_value.endswith(".0"):
            code_value = code_value[:-2]
        try:
            code = str(int(float(code_value)))
        except (TypeError, ValueError, OverflowError):
            continue
        crop = normalize_crop(row[dimensions["crop"]])
        state = infer_state(
            row.get(dimensions["state"]) if dimensions["state"] else None,
            row.get(dimensions["state_code"]) if dimensions["state_code"] else None,
            code,
        )
        if row_year != year or state not in selected_states or crop not in selected_crops:
            continue
        municipality = str(row[dimensions["municipality"]]).strip()
        if not municipality:
            continue
        # Match the MongoDB unique index exactly, so duplicate SIDRA rows
        # cannot emit competing upserts for the same municipality/crop/year.
        identity = (int(year), code, crop)
        record = records.setdefault(
            identity,
            {
                "year": int(year),
                "ibge_code": code,
                "municipality": municipality,
                "state": state,
                "crop": crop,
            },
        )
        if long_format:
            metric = normalize_text(row[variable_column])
            if "area plantada" in metric or "area destinada a colheita" in metric:
                target = "planted_area_ha"
            elif "quantidade produzida" in metric:
                target = "production_t"
            elif "rendimento medio" in metric:
                target = "yield_kg_ha"
            else:
                continue
            set_metric(record, target, parse_number(row[value_column]), row_number)
        else:
            for target, column in wide_columns.items():
                set_metric(record, target, parse_number(row[column]), row_number)

    return [
        record
        for record in records.values()
        if all(record.get(metric) is not None for metric in METRIC_NAMES)
    ]


def read_sidra_csv(path):
    """Read a SIDRA CSV with either comma or semicolon delimiter."""
    return pd.read_csv(path, sep=None, engine="python", dtype=str, keep_default_na=False)


def upsert_records(db, records, batch_size=BATCH_SIZE):
    """Idempotently upsert records using the schema's unique compound key."""
    valid_records = []
    for record in records:
        invalid = invalid_metrics(record)
        if invalid:
            log.warning(
                "registro SIDRA descartado (código=%s, cultura=%s, ano=%s): "
                "medidas inválidas ou fora da faixa: %s",
                record.get("ibge_code"),
                record.get("crop"),
                record.get("year"),
                invalid,
            )
            continue
        valid_records.append(record)

    total = 0
    for offset in range(0, len(valid_records), batch_size):
        batch = valid_records[offset : offset + batch_size]
        operations = [
            UpdateOne(
                {"ibge_code": doc["ibge_code"], "crop": doc["crop"], "year": doc["year"]},
                {"$set": doc},
                upsert=True,
            )
            for doc in batch
        ]
        if operations:
            db.ibge_production.bulk_write(operations, ordered=False)
            total += len(operations)
    return total


def import_csv(db, path, year, states, crops=DEFAULT_CROPS):
    records = parse_frame(read_sidra_csv(path), year, states, crops)
    return upsert_records(db, records)


def main():
    setup_logging()
    parser = argparse.ArgumentParser(
        description="Importa CSV exportado do SIDRA/PAM para MongoDB, limitado por ano e UF.",
        epilog=(
            "Exemplo: python -m workers.ibge --file pam.csv --year 2024 "
            "--states MT SP --crops soja milho cana"
        ),
    )
    parser.add_argument("--file", type=Path, required=True, help="CSV exportado do SIDRA")
    parser.add_argument("--year", type=int, required=True, help="Ano agrícola a importar")
    parser.add_argument("--states", nargs="+", required=True, help="UFs (ex.: MT SP GO)")
    parser.add_argument(
        "--crops", nargs="+", default=list(DEFAULT_CROPS), help="soja, milho e/ou cana"
    )
    args = parser.parse_args()
    if not args.file.is_file():
        parser.error(f"arquivo não encontrado: {args.file}")
    total = import_csv(get_db(), args.file, args.year, args.states, args.crops)
    log.info(
        "importação SIDRA concluída: %s registros upsertados (ano=%s, UFs=%s, culturas=%s)",
        f"{total:,}", args.year, ",".join(args.states), ",".join(args.crops),
    )


if __name__ == "__main__":
    main()
