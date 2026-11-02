import pytest
from pydantic import ValidationError

from app.models import (
    AlertIn,
    AlertRuleIn,
    AlertRuleUpdate,
    AlertUpdate,
    FarmIn,
    FarmUpdate,
    FieldIn,
    FieldUpdate,
    OperationIn,
    OperationUpdate,
    SeasonIn,
    SeasonUpdate,
    SensorUpdate,
)

FARM = {
    "name": "Fazenda Teste",
    "municipality": "Pompéia",
    "state": "SP",
    "location": {"type": "Point", "coordinates": [-50.1994, -22.1110]},
}
FIELD = {
    "farm_id": "507f1f77bcf86cd799439011",
    "name": "Talhão 001",
    "crop": "soja",
    "boundary": {
        "type": "Polygon",
        "coordinates": [[
            [-50.200, -22.112],
            [-50.199, -22.112],
            [-50.199, -22.111],
            [-50.200, -22.111],
            [-50.200, -22.112],
        ]],
    },
}


@pytest.mark.parametrize(
    ("model", "payload", "unexpected"),
    [
        (FarmIn, FARM, {"owner_id": "507f1f77bcf86cd799439011"}),
        (FarmUpdate, {"name": "Fazenda Atualizada"}, {"unexpected": True}),
        (FieldIn, FIELD, {"area_ha": 999}),
        (FieldUpdate, {"name": "Talhão Atualizado"}, {"centroid": {"type": "Point"}}),
    ],
)
def test_farm_and_field_inputs_reject_unknown_fields(model, payload, unexpected):
    model.model_validate(payload)
    with pytest.raises(ValidationError):
        model.model_validate({**payload, **unexpected})


@pytest.mark.parametrize(
    ("model", "payload"),
    [
        (FarmUpdate, {"name": None}),
        (FieldUpdate, {"crop": None}),
        (SeasonUpdate, {"status": None}),
        (OperationUpdate, {"type": None}),
        (SensorUpdate, {"active": None}),
        (AlertRuleUpdate, {"threshold": None}),
        (AlertUpdate, {"status": None}),
    ],
)
def test_patch_models_reject_null_for_required_fields(model, payload):
    with pytest.raises(ValidationError):
        model.model_validate(payload)


def test_patch_openapi_matches_nullability_contract():
    from app.main import app

    schemas = app.openapi()["components"]["schemas"]
    non_nullable_fields = {
        "FarmUpdate": ("name", "municipality", "state", "location"),
        "FieldUpdate": ("name", "crop", "boundary", "attributes"),
        "SeasonUpdate": ("label", "planting_date", "status"),
        "OperationUpdate": ("field_id", "type", "date", "details"),
        "SensorUpdate": ("device_id", "field_id", "active"),
        "AlertRuleUpdate": (
            "field_id", "metric", "operator", "threshold", "window_minutes", "active"
        ),
        "AlertUpdate": ("status",),
    }

    def permits_null(schema):
        if schema.get("type") == "null":
            return True
        return any(permits_null(option) for option in schema.get("anyOf", []))

    for model_name, fields in non_nullable_fields.items():
        for field_name in fields:
            assert not permits_null(schemas[model_name]["properties"][field_name]), (
                model_name,
                field_name,
            )

    assert permits_null(schemas["SeasonUpdate"]["properties"]["harvest_date"])
    assert permits_null(schemas["OperationUpdate"]["properties"]["season_id"])
    assert permits_null(schemas["OperationUpdate"]["properties"]["cost_brl"])
    assert permits_null(schemas["AlertUpdate"]["properties"]["resolved_at"])


@pytest.mark.parametrize(
    ("model", "payload"),
    [
        (
            SeasonIn,
            {
                "field_id": "507f1f77bcf86cd799439011",
                "label": "2026/27",
                "planting_date": "2026-09-01T00:00:00Z",
                "expected_yield_kg_ha": float("nan"),
            },
        ),
        (SeasonUpdate, {"yield_kg_ha": float("inf")}),
        (
            OperationIn,
            {
                "field_id": "507f1f77bcf86cd799439011",
                "type": "irrigacao",
                "date": "2026-09-01T00:00:00Z",
                "cost_brl": float("inf"),
            },
        ),
        (OperationUpdate, {"cost_brl": float("nan")}),
        (
            AlertRuleIn,
            {
                "field_id": "507f1f77bcf86cd799439011",
                "metric": "soil_moisture",
                "operator": "lt",
                "threshold": float("nan"),
                "window_minutes": 30,
            },
        ),
        (AlertRuleUpdate, {"threshold": float("inf")}),
        (
            AlertIn,
            {
                "rule_id": "507f1f77bcf86cd799439011",
                "field_id": "507f1f77bcf86cd799439012",
                "metric": "soil_moisture",
                "value": float("nan"),
                "threshold": 20,
                "triggered_at": "2026-09-01T00:00:00Z",
            },
        ),
    ],
)
def test_agriculture_numeric_inputs_reject_nonfinite_values(model, payload):
    with pytest.raises(ValidationError):
        model.model_validate(payload)
