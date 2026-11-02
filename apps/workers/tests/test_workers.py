from pathlib import Path

import pandas as pd
import pytest

from workers.alerts import breached, build_payload, claim_alert, dispatch_alert
from workers.ibge import parse_frame, parse_number, read_sidra_csv, upsert_records
from workers.inmet import parse_dates, parse_station, to_documents
from workers.rollup import build_pipeline
from workers.simulator import SensorModel, fill_gaps, refresh_models

STATION_CSV = """REGIAO:;CO
UF:;MT
ESTACAO:;SORRISO
CODIGO (WMO):;A904
LATITUDE:;-12,54
LONGITUDE:;-55,72
ALTITUDE:;365,0
DATA DE FUNDACAO:;01/01/10
Data;Hora UTC;PRECIPITAÇÃO TOTAL, HORÁRIO (mm);TEMPERATURA DO AR - BULBO SECO, HORARIA (°C);UMIDADE RELATIVA DO AR, HORARIA (%);VENTO, VELOCIDADE HORARIA (m/s);
2024/01/01;0000 UTC;0,2;24,5;88;1,2;
2024/01/01;0100 UTC;-9999;24,1;90;0,8;
"""


def test_parse_station_reads_metadata_and_readings():
    station, frame = parse_station(STATION_CSV)
    assert station["code"] == "A904"
    assert station["state"] == "MT"
    assert station["location"]["coordinates"] == [-55.72, -12.54]
    assert len(frame) == 2
    assert frame.iloc[0]["air_temp"] == pytest.approx(24.5)
    assert frame.iloc[1]["ts"].hour == 1


def test_parse_station_logs_and_drops_invalid_dates(caplog):
    invalid_date_csv = STATION_CSV.replace("2024/01/01;0000 UTC", "2024/13/32;0000 UTC", 1)

    _, frame = parse_station(invalid_date_csv, source="A904.csv")

    assert len(frame) == 1
    assert frame.iloc[0]["ts"].hour == 1
    assert "A904.csv linha 10" in caplog.text
    assert "data inválida" in caplog.text
    assert "2024/13/32" in caplog.text


def test_parse_station_drops_out_of_range_measurements(caplog):
    invalid_measure_csv = STATION_CSV.replace(
        "2024/01/01;0000 UTC;0,2;24,5;88;1,2;",
        "2024/01/01;0000 UTC;-2;24,5;150;1,2;",
    )

    station, frame = parse_station(invalid_measure_csv, source="A904.csv")
    documents = to_documents(station, frame)

    assert "rain_mm" not in documents[0]
    assert documents[0]["air_temp"] == pytest.approx(24.5)
    assert "humidity" not in documents[0]
    assert documents[0]["wind_ms"] == pytest.approx(1.2)
    assert "A904.csv linha 10" in caplog.text
    assert "rain_mm fora da faixa" in caplog.text
    assert "humidity fora da faixa" in caplog.text


def test_parse_station_drops_measurements_above_physical_ranges(caplog):
    invalid_measure_csv = STATION_CSV.replace(
        "2024/01/01;0000 UTC;0,2;24,5;88;1,2;",
        "2024/01/01;0000 UTC;1001;61;101;151;",
    )

    station, frame = parse_station(invalid_measure_csv, source="A904.csv")
    documents = to_documents(station, frame)

    assert len(documents) == 1
    assert documents[0]["ts"].hour == 1
    for metric in ("rain_mm", "air_temp", "humidity", "wind_ms"):
        assert f"{metric} fora da faixa" in caplog.text
    assert "nenhuma medida válida" in caplog.text


def test_parse_station_drops_invalid_utc_time(caplog):
    invalid_time_csv = STATION_CSV.replace("0000 UTC", "2500 UTC", 1)

    _, frame = parse_station(invalid_time_csv, source="A904.csv")

    assert len(frame) == 1
    assert frame.iloc[0]["ts"].hour == 1
    assert "hora inválida" in caplog.text


@pytest.mark.parametrize("replacement", ["LATITUDE:;nan", "LATITUDE:;91"])
def test_parse_station_rejects_invalid_wgs84_coordinates(replacement):
    with pytest.raises(ValueError, match="coordenadas WGS84 inválidas"):
        parse_station(STATION_CSV.replace("LATITUDE:;-12,54", replacement))


def test_missing_values_are_dropped_from_documents():
    station, frame = parse_station(STATION_CSV)
    documents = to_documents(station, frame)
    assert documents[0]["rain_mm"] == pytest.approx(0.2)
    assert "rain_mm" not in documents[1]
    assert documents[1]["station"] == {"code": "A904", "state": "MT"}


def test_to_documents_drops_nonfinite_measurements():
    frame = pd.DataFrame(
        [
            {
                "ts": pd.Timestamp("2024-01-01T00:00:00Z"),
                "rain_mm": float("inf"),
                "air_temp": float("nan"),
                "humidity": 75.0,
                "wind_ms": float("-inf"),
            }
        ]
    )
    documents = to_documents({"code": "A904", "state": "MT"}, frame)
    assert documents[0]["humidity"] == 75.0
    assert set(documents[0]) == {"ts", "station", "humidity"}


def test_breached_operators():
    assert breached(15, "lt", 20)
    assert not breached(25, "lt", 20)
    assert breached(40, "gt", 35)


def test_alert_payload_is_json_friendly():
    from datetime import UTC, datetime

    from bson import ObjectId

    alert = {
        "_id": ObjectId(),
        "field_id": ObjectId(),
        "metric": "soil_moisture",
        "value": 18.5,
        "threshold": 20.0,
        "triggered_at": datetime.now(UTC),
    }
    payload = build_payload(alert)
    assert isinstance(payload["alert_id"], str)
    assert isinstance(payload["triggered_at"], str)


def test_sensor_model_is_deterministic_and_bounded():
    from datetime import UTC, datetime

    ts = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)
    first = SensorModel("abc")
    second = SensorModel("abc")
    for _ in range(500):
        a, b = first.step(ts, 5), second.step(ts, 5)
        assert a == b
        assert 5 <= a["soil_moisture"] <= 60


def test_inmet_date_parser_accepts_mixed_formats():
    dates = parse_dates(pd.Series(["2024/01/02", "03/01/2024"]))
    assert dates.iloc[0].strftime("%Y-%m-%d") == "2024-01-02"
    assert dates.iloc[1].strftime("%Y-%m-%d") == "2024-01-03"


def test_sidra_import_filters_and_pivots_long_rows():
    rows = []
    for variable, value in (
        ("Área plantada ou destinada à colheita (Hectares)", "1.234"),
        ("Quantidade produzida (Toneladas)", "5.678,5"),
        ("Rendimento médio da produção (Quilogramas por Hectare)", "4.600"),
    ):
        rows.append(
            {
                "Ano": "2024",
                "Município (Código)": "5100201",
                "Município": "Água Boa",
                "Unidade da Federação": "Mato Grosso",
                "Produto das lavouras temporárias e permanentes": "Soja (em grão)",
                "Variável": variable,
                "Valor": value,
            }
        )
    rows.extend(
        [
            {**rows[0], "Município (Código)": "3500105", "Unidade da Federação": "SP"},
            {**rows[0], "Ano": "2023"},
            {**rows[0], "Produto das lavouras temporárias e permanentes": "Café"},
        ]
    )
    records = parse_frame(pd.DataFrame(rows), 2024, ["MT"], ["soja"])
    assert records == [
        {
            "year": 2024,
            "ibge_code": "5100201",
            "municipality": "Água Boa",
            "state": "MT",
            "crop": "soja",
            "planted_area_ha": 1234,
            "production_t": 5678.5,
            "yield_kg_ha": 4600,
        }
    ]


def test_sidra_import_parses_official_pam_sample():
    fixture = Path(__file__).parent / "fixtures" / "sidra-pam-sorriso-2023.csv"
    records = parse_frame(read_sidra_csv(fixture), 2023, ["MT"])

    assert records == [
        {
            "year": 2023,
            "ibge_code": "5107925",
            "municipality": "Sorriso (MT)",
            "state": "MT",
            "crop": "soja",
            "planted_area_ha": 598500,
            "production_t": 2244375,
            "yield_kg_ha": 3750,
        },
        {
            "year": 2023,
            "ibge_code": "5107925",
            "municipality": "Sorriso (MT)",
            "state": "MT",
            "crop": "milho",
            "planted_area_ha": 535000,
            "production_t": 3819900,
            "yield_kg_ha": 7140,
        },
        {
            "year": 2023,
            "ibge_code": "5107925",
            "municipality": "Sorriso (MT)",
            "state": "MT",
            "crop": "cana",
            "planted_area_ha": 1800,
            "production_t": 126000,
            "yield_kg_ha": 70000,
        },
    ]


def test_sidra_numeric_parser_handles_brazilian_format_and_missing_values():
    assert parse_number("1.234,56") == pytest.approx(1234.56)
    assert parse_number("...") is None
    assert parse_number("Infinity") is None
    assert parse_number("1e999") is None


@pytest.mark.parametrize(
    ("variable", "value", "metric"),
    [
        ("Área plantada ou destinada à colheita (Hectares)", "-5", "planted_area_ha"),
        ("Quantidade produzida (Toneladas)", "-10", "production_t"),
        (
            "Rendimento médio da produção (Quilogramas por Hectare)",
            "-2",
            "yield_kg_ha",
        ),
    ],
)
def test_sidra_import_drops_negative_metrics(variable, value, metric, caplog):
    rows = [
        {
            "Ano": "2024",
            "Município (Código)": "5100201",
            "Município": "Água Boa",
            "Unidade da Federação": "MT",
            "Produto das lavouras temporárias e permanentes": "Soja (em grão)",
            "Variável": "Área plantada ou destinada à colheita (Hectares)",
            "Valor": "1.234",
        },
        {
            "Ano": "2024",
            "Município (Código)": "5100201",
            "Município": "Água Boa",
            "Unidade da Federação": "MT",
            "Produto das lavouras temporárias e permanentes": "Soja (em grão)",
            "Variável": "Quantidade produzida (Toneladas)",
            "Valor": "5.678",
        },
        {
            "Ano": "2024",
            "Município (Código)": "5100201",
            "Município": "Água Boa",
            "Unidade da Federação": "MT",
            "Produto das lavouras temporárias e permanentes": "Soja (em grão)",
            "Variável": "Rendimento médio da produção (Quilogramas por Hectare)",
            "Valor": "4.600",
        },
    ]
    target = next(row for row in rows if row["Variável"] == variable)
    target["Valor"] = value

    records = parse_frame(pd.DataFrame(rows), 2024, ["MT"], ["soja"])

    assert records == []
    assert "linha SIDRA" in caplog.text
    assert metric in caplog.text
    assert "valor ignorado" in caplog.text


def test_sidra_import_drops_negative_metrics_in_wide_format(caplog):
    frame = pd.DataFrame(
        [
            {
                "Ano": "2024",
                "Município (Código)": "5100201",
                "Município": "Água Boa",
                "UF": "MT",
                "Produto": "Soja",
                "Área plantada (Hectares)": "-5",
                "Quantidade produzida (Toneladas)": "10",
                "Rendimento médio da produção (Quilogramas por Hectare)": "4600",
            }
        ]
    )

    records = parse_frame(frame, 2024, ["MT"], ["soja"])

    assert records == []
    assert "planted_area_ha fora da faixa" in caplog.text


def test_ibge_upsert_rejects_negative_metrics(caplog):
    class FakeCollection:
        def __init__(self):
            self.documents = {}

        def bulk_write(self, operations, ordered):
            raise AssertionError("registro inválido não deve chegar ao bulk_write")

    class FakeDb:
        ibge_production = FakeCollection()

    db = FakeDb()
    record = {
        "ibge_code": "5100201",
        "crop": "soja",
        "year": 2024,
        "municipality": "Água Boa",
        "state": "MT",
        "planted_area_ha": -5,
        "production_t": 10,
        "yield_kg_ha": 4600,
    }

    assert upsert_records(db, [record]) == 0
    assert db.ibge_production.documents == {}
    assert "registro SIDRA descartado" in caplog.text
    assert "planted_area_ha" in caplog.text


def test_ibge_upsert_uses_compound_key_and_is_repeatable():
    class FakeCollection:
        def __init__(self):
            self.documents = {}

        def bulk_write(self, operations, ordered):
            assert ordered is False
            for operation in operations:
                key = tuple(operation._filter[name] for name in ("ibge_code", "crop", "year"))
                self.documents[key] = operation._doc["$set"]

    class FakeDb:
        ibge_production = FakeCollection()

    db = FakeDb()
    record = {
        "ibge_code": "5100201",
        "crop": "soja",
        "year": 2024,
        "municipality": "Água Boa",
        "state": "MT",
        "yield_kg_ha": 4600,
    }
    assert upsert_records(db, [record]) == 1
    assert upsert_records(db, [{**record, "yield_kg_ha": 4700}]) == 1
    assert len(db.ibge_production.documents) == 1
    assert next(iter(db.ibge_production.documents.values()))["yield_kg_ha"] == 4700


def test_simulator_fills_only_missing_sensor_intervals():
    from datetime import UTC, datetime, timedelta

    class FakeReadings:
        def __init__(self):
            self.documents = []

        def find_one(self, query, sort):
            matches = [
                doc for doc in self.documents if doc["meta"]["sensor_id"] == query["meta.sensor_id"]
            ]
            return max(matches, key=lambda doc: doc["ts"]) if matches else None

        def insert_many(self, documents, ordered):
            self.documents.extend(documents)

    class FakeDb:
        sensor_readings = FakeReadings()

    db = FakeDb()
    now = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)
    sensor = {"_id": "sensor-1", "field_id": "field-1", "farm_id": "farm-1"}
    db.sensor_readings.documents.append(
        {
            "ts": now - timedelta(seconds=20),
            "meta": {"sensor_id": sensor["_id"]},
            "soil_moisture": 30,
            "air_temp": 25,
        }
    )
    models = [(sensor, SensorModel("sensor-1"))]
    assert fill_gaps(db, models, now=now, step_seconds=10) == 2
    assert [doc["ts"] for doc in db.sensor_readings.documents[1:]] == [
        now - timedelta(seconds=10), now
    ]
    assert fill_gaps(db, models, now=now, step_seconds=10) == 0


def test_simulator_refresh_preserves_models_adds_new_and_drops_inactive():
    class FakeSensors:
        active = []

        def find(self, query):
            assert query == {"active": True}
            return list(self.active)

    class FakeDb:
        sensors = FakeSensors()

    db = FakeDb()
    old_sensor = {"_id": "sensor-1", "field_id": "field-1", "farm_id": "farm-1"}
    inactive_sensor = {"_id": "sensor-2", "field_id": "field-2", "farm_id": "farm-2"}
    existing_model = SensorModel("sensor-1")
    existing_model.moisture = 42.0
    db.sensors.active = [old_sensor, inactive_sensor]
    models = [(old_sensor, existing_model), (inactive_sensor, SensorModel("sensor-2"))]

    updated_sensor = {**old_sensor, "field_id": "field-3"}
    new_sensor = {"_id": "sensor-3", "field_id": "field-4", "farm_id": "farm-4"}
    db.sensors.active = [updated_sensor, new_sensor]
    refreshed = refresh_models(db, models)

    assert [sensor["_id"] for sensor, _ in refreshed] == ["sensor-1", "sensor-3"]
    assert refreshed[0][0]["field_id"] == "field-3"
    assert refreshed[0][1] is existing_model
    assert refreshed[0][1].moisture == 42.0
    assert refreshed[1][1] is not existing_model


def test_alert_claim_is_atomic_and_idempotent():
    class Result:
        def __init__(self, modified_count):
            self.modified_count = modified_count

    class FakeAlerts:
        def __init__(self):
            self.alert = {"_id": "alert-1"}

        def update_one(self, query, update):
            if not self._matches(self.alert, query):
                return Result(0)
            self.alert.update(update.get("$set", {}))
            for key in update.get("$unset", {}):
                self.alert.pop(key, None)
            return Result(1)

        @classmethod
        def _matches(cls, document, query):
            for key, expected in query.items():
                if key == "$or":
                    if not any(cls._matches(document, item) for item in expected):
                        return False
                    continue
                actual = document.get(key)
                if isinstance(expected, dict):
                    if "$exists" in expected and (key in document) != expected["$exists"]:
                        return False
                    if "$lte" in expected and (actual is None or actual > expected["$lte"]):
                        return False
                elif actual != expected:
                    return False
            return True

    class FakeDb:
        alerts = FakeAlerts()

    db = FakeDb()
    assert claim_alert(db, "alert-1")
    assert not claim_alert(db, "alert-1")


def test_failed_webhook_remains_pending_and_can_be_retried(monkeypatch):
    from datetime import UTC, datetime

    from workers import alerts

    class Result:
        def __init__(self, modified_count):
            self.modified_count = modified_count

    class FakeAlerts:
        def __init__(self):
            self.alert = {"_id": "alert-1"}

        def update_one(self, query, update):
            if not FakeAlerts._matches(self.alert, query):
                return Result(0)
            self.alert.update(update.get("$set", {}))
            for key in update.get("$unset", {}):
                self.alert.pop(key, None)
            return Result(1)

        @staticmethod
        def _matches(document, query):
            for key, expected in query.items():
                if key == "$or":
                    if not any(FakeAlerts._matches(document, item) for item in expected):
                        return False
                elif isinstance(expected, dict) and "$exists" in expected:
                    if (key in document) != expected["$exists"]:
                        return False
                elif document.get(key) != expected:
                    return False
            return True

    class FakeDb:
        alerts = FakeAlerts()

    db = FakeDb()
    outcomes = iter([False, True])
    monkeypatch.setattr(alerts, "send_webhook", lambda url, payload: next(outcomes))
    alert = {
        "_id": "alert-1",
        "field_id": "field-1",
        "metric": "soil_moisture",
        "value": 10,
        "threshold": 20,
        "triggered_at": datetime.now(UTC),
    }

    assert not dispatch_alert(db, alert, "https://example.test/webhook")
    assert "notification_claimed_at" not in db.alerts.alert
    assert "notified_at" not in db.alerts.alert
    assert dispatch_alert(db, alert, "https://example.test/webhook")
    assert "notification_claimed_at" not in db.alerts.alert
    assert "notified_at" in db.alerts.alert
    assert not dispatch_alert(db, alert, "https://example.test/webhook")


def test_daily_rollup_keeps_all_series_metrics_and_merge_key():
    from datetime import UTC, datetime

    pipeline = build_pipeline(datetime(2026, 1, 1, tzinfo=UTC))
    grouped = pipeline[1]["$group"]
    assert grouped["soil_temp_avg"] == {"$avg": "$soil_temp"}
    assert grouped["soil_temp_min"] == {"$min": "$soil_temp"}
    assert grouped["soil_temp_max"] == {"$max": "$soil_temp"}
    assert grouped["air_temp_avg"] == {"$avg": "$air_temp"}
    assert grouped["air_temp_min"] == {"$min": "$air_temp"}
    assert grouped["air_temp_max"] == {"$max": "$air_temp"}
    assert grouped["rain_mm"] == {"$sum": "$rainfall_mm"}
    assert grouped["rainfall_mm_min"] == {"$min": "$rainfall_mm"}
    assert grouped["rainfall_mm_max"] == {"$max": "$rainfall_mm"}
    assert pipeline[-1]["$merge"]["on"] == ["field_id", "day"]
    assert pipeline[-1]["$merge"]["whenMatched"] == "replace"
