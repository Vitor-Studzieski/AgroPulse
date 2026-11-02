#!/usr/bin/env python3
"""Regenerate the versioned São Paulo sample from the public IBGE APIs."""

import argparse
import csv
import gzip
import json
import time
from pathlib import Path
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
LOCALITIES_URL = (
    "https://servicodados.ibge.gov.br/api/v1/localidades/estados/35/municipios"
    "?orderBy=nome"
)
SIDRA_URL = (
    "https://apisidra.ibge.gov.br/values/t/5457/n6/{codes}"
    "/v/8331,214,112/p/2023/c782/40124,40122,40106"
)
OUTPUT_FIELDS = [
    "Ano",
    "Município (Código)",
    "Município",
    "Produto das lavouras temporárias e permanentes",
    "Variável",
    "Valor",
]


def fetch_json(url):
    request = Request(
        url,
        headers={"User-Agent": "AgroPulse demo", "Accept-Encoding": "gzip"},
    )
    with urlopen(request, timeout=60) as response:
        payload = response.read()
    if payload[:2] == bytes([31, 139]):
        payload = gzip.decompress(payload)
    return json.loads(payload.decode("utf-8-sig"))


def fetch_sidra_rows(codes, batch_size=40):
    rows = []
    for offset in range(0, len(codes), batch_size):
        batch = codes[offset : offset + batch_size]
        url = SIDRA_URL.format(codes=",".join(batch))
        for attempt in range(4):
            try:
                payload = fetch_json(url)
                rows.extend(payload[1:])
                break
            except Exception:
                if attempt == 3:
                    raise
                time.sleep(2 * (attempt + 1))
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output",
        type=Path,
        default=ROOT / "data/imports/pam-sp-2023.csv",
        help="caminho do CSV SIDRA de saída",
    )
    args = parser.parse_args()

    municipalities = fetch_json(LOCALITIES_URL)
    codes = [str(municipality["id"]) for municipality in municipalities]
    rows = fetch_sidra_rows(codes)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", newline="", encoding="utf-8-sig") as output:
        writer = csv.writer(output, delimiter=";")
        writer.writerow(OUTPUT_FIELDS)
        writer.writerows(
            [
                row["D3C"],
                row["D1C"],
                row["D1N"],
                row["D4N"],
                row["D2N"],
                row["V"],
            ]
            for row in rows
        )
    print(
        f"CSV SIDRA salvo em {args.output} "
        f"({len(codes)} municípios consultados, {len(rows)} linhas)"
    )


if __name__ == "__main__":
    main()
