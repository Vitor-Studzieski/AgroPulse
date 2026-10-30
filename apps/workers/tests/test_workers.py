import pytest

from workers.alerts import breached, build_payload
from workers.inmet import parse_station, to_documents
from workers.simulator import SensorModel

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


def test_missing_values_are_dropped_from_documents():
    station, frame = parse_station(STATION_CSV)
    documents = to_documents(station, frame)
    assert documents[0]["rain_mm"] == pytest.approx(0.2)
    assert "rain_mm" not in documents[1]
    assert documents[1]["station"] == {"code": "A904", "state": "MT"}


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
