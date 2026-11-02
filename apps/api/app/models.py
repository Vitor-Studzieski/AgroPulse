import math
from datetime import datetime
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    BeforeValidator,
    EmailStr,
    Field,
    field_validator,
    model_validator,
)

from app.geo import area_ha, is_closed, validate_polygon

PyObjectId = Annotated[str, BeforeValidator(str)]
Position = Annotated[list[float], Field(min_length=2, max_length=2)]
FiniteFloat = Annotated[float, Field(allow_inf_nan=False)]
NonNegativeFiniteFloat = Annotated[float, Field(ge=0, allow_inf_nan=False)]
Crop = Literal["soja", "milho", "cana", "cafe", "trigo", "algodao"]
Metric = Literal["soil_moisture", "soil_temp", "air_temp", "rainfall_mm"]
SeasonStatus = Literal["planejada", "em_andamento", "colhida"]
OperationType = Literal["plantio", "adubacao", "aplicacao", "irrigacao", "colheita"]
AlertOperator = Literal["lt", "gt"]
AlertStatus = Literal["open", "resolved"]


class ApiModel(BaseModel):
    model_config = {"extra": "ignore"}


class ApiInputModel(ApiModel):
    model_config = {"extra": "forbid"}


def reject_null_patch_fields(model, field_names):
    for name in field_names:
        if name in model.model_fields_set and getattr(model, name) is None:
            raise ValueError(f"{name} não pode ser nulo")


class UserCreate(ApiInputModel):
    name: str = Field(min_length=2, max_length=80)
    email: EmailStr
    password: str = Field(min_length=8, max_length=72)

    @field_validator("password")
    @classmethod
    def password_fits_bcrypt(cls, value):
        if len(value.encode()) > 72:
            raise ValueError("senha excede o limite de 72 bytes")
        return value


class UserUpdate(ApiInputModel):
    current_password: str = Field(min_length=8, max_length=72)
    name: str | None = Field(default=None, min_length=2, max_length=80)
    email: EmailStr | None = None
    new_password: str | None = Field(default=None, min_length=8, max_length=72)

    @field_validator("current_password")
    @classmethod
    def current_password_fits_bcrypt(cls, value):
        if len(value.encode()) > 72:
            raise ValueError("senha excede o limite de 72 bytes")
        return value

    @field_validator("new_password")
    @classmethod
    def new_password_fits_bcrypt(cls, value):
        if value is not None and len(value.encode()) > 72:
            raise ValueError("senha excede o limite de 72 bytes")
        return value

    @model_validator(mode="after")
    def requires_a_change(self):
        if self.name is None and self.email is None and self.new_password is None:
            raise ValueError("informe ao menos um campo para atualizar")
        return self


class UserDelete(ApiInputModel):
    current_password: str = Field(min_length=8, max_length=72)

    @field_validator("current_password")
    @classmethod
    def current_password_fits_bcrypt(cls, value):
        if len(value.encode()) > 72:
            raise ValueError("senha excede o limite de 72 bytes")
        return value


class UserOut(ApiModel):
    id: PyObjectId = Field(validation_alias="_id")
    name: str
    email: str
    role: str


class Token(ApiModel):
    access_token: str
    token_type: str = "bearer"


def validate_wgs84_position(position):
    longitude, latitude = position
    if not math.isfinite(longitude) or not math.isfinite(latitude):
        raise ValueError("coordenadas precisam ser números finitos")
    if not -180 <= longitude <= 180 or not -90 <= latitude <= 90:
        raise ValueError("coordenadas precisam respeitar os limites WGS84")
    return position


class Point(ApiModel):
    type: Literal["Point"] = "Point"
    coordinates: Position

    @field_validator("coordinates")
    @classmethod
    def coordinates_must_be_wgs84(cls, position):
        return validate_wgs84_position(position)


class Polygon(ApiModel):
    type: Literal["Polygon"] = "Polygon"
    coordinates: list[list[Position]]

    @field_validator("coordinates")
    @classmethod
    def rings_must_be_closed(cls, rings):
        if not rings or not all(is_closed(ring) for ring in rings):
            raise ValueError("cada anel do polígono precisa ter 4+ pontos e fechar no primeiro")
        for ring in rings:
            for position in ring:
                validate_wgs84_position(position)
        try:
            validate_polygon(rings)
            if area_ha(rings) <= 0:
                raise ValueError("área líquida do polígono precisa ser positiva")
        except ValueError as error:
            raise ValueError(f"polígono inválido: {error}") from error
        return rings


class FarmIn(ApiInputModel):
    name: str = Field(min_length=2, max_length=120)
    municipality: str = Field(min_length=2, max_length=120)
    state: str = Field(pattern=r"^[A-Z]{2}$")
    location: Point


class FarmUpdate(ApiInputModel):
    name: str = Field(default=None, min_length=2, max_length=120)
    municipality: str = Field(default=None, min_length=2, max_length=120)
    state: str = Field(default=None, pattern=r"^[A-Z]{2}$")
    location: Point = None

    @model_validator(mode="after")
    def required_update_values_are_not_null(self):
        reject_null_patch_fields(self, ("name", "municipality", "state", "location"))
        return self


class FarmOut(ApiModel):
    id: PyObjectId = Field(validation_alias="_id")
    name: str
    municipality: str
    state: str
    location: Point
    created_at: datetime


class FieldIn(ApiInputModel):
    farm_id: PyObjectId
    name: str = Field(min_length=1, max_length=120)
    crop: Crop
    boundary: Polygon
    attributes: dict = Field(default_factory=dict)


class FieldUpdate(ApiInputModel):
    name: str = Field(default=None, min_length=1, max_length=120)
    crop: Crop = None
    boundary: Polygon = None
    attributes: dict = None

    @model_validator(mode="after")
    def required_update_values_are_not_null(self):
        reject_null_patch_fields(self, ("name", "crop", "boundary", "attributes"))
        return self


class FieldOut(ApiModel):
    id: PyObjectId = Field(validation_alias="_id")
    farm_id: PyObjectId
    name: str
    crop: Crop
    area_ha: float
    boundary: Polygon
    centroid: Point
    attributes: dict
    created_at: datetime


class SeasonIn(ApiInputModel):
    field_id: PyObjectId
    label: str = Field(min_length=1, max_length=32)
    planting_date: datetime
    harvest_date: datetime | None = None
    expected_yield_kg_ha: NonNegativeFiniteFloat | None = None
    yield_kg_ha: NonNegativeFiniteFloat | None = None
    status: SeasonStatus = "planejada"


class SeasonUpdate(ApiInputModel):
    label: str = Field(default=None, min_length=1, max_length=32)
    planting_date: datetime = None
    harvest_date: datetime | None = None
    expected_yield_kg_ha: NonNegativeFiniteFloat | None = None
    yield_kg_ha: NonNegativeFiniteFloat | None = None
    status: SeasonStatus = None

    @model_validator(mode="after")
    def required_update_values_are_not_null(self):
        reject_null_patch_fields(self, ("label", "planting_date", "status"))
        return self


class SeasonOut(ApiModel):
    id: PyObjectId = Field(validation_alias="_id")
    field_id: PyObjectId
    crop: Crop
    label: str
    planting_date: datetime
    harvest_date: datetime | None = None
    expected_yield_kg_ha: float | None = None
    yield_kg_ha: float | None = None
    status: SeasonStatus


class OperationIn(ApiInputModel):
    field_id: PyObjectId
    season_id: PyObjectId | None = None
    type: OperationType
    date: datetime
    cost_brl: NonNegativeFiniteFloat | None = None
    details: dict = Field(default_factory=dict)


class OperationUpdate(ApiInputModel):
    field_id: str = None
    season_id: PyObjectId | None = None
    type: OperationType = None
    date: datetime = None
    cost_brl: NonNegativeFiniteFloat | None = None
    details: dict = None

    @model_validator(mode="after")
    def required_update_values_are_not_null(self):
        reject_null_patch_fields(self, ("field_id", "type", "date", "details"))
        return self


class OperationOut(ApiModel):
    id: PyObjectId = Field(validation_alias="_id")
    field_id: PyObjectId
    season_id: PyObjectId | None = None
    type: OperationType
    date: datetime
    cost_brl: float | None = None
    details: dict = Field(default_factory=dict)


class SensorIn(ApiInputModel):
    device_id: str = Field(min_length=1, max_length=120)
    field_id: PyObjectId
    active: bool = True


class SensorUpdate(ApiInputModel):
    device_id: str = Field(default=None, min_length=1, max_length=120)
    field_id: str = None
    active: bool = None

    @model_validator(mode="after")
    def required_update_values_are_not_null(self):
        reject_null_patch_fields(self, ("device_id", "field_id", "active"))
        return self


class SensorOut(ApiModel):
    id: PyObjectId = Field(validation_alias="_id")
    device_id: str
    field_id: PyObjectId
    farm_id: PyObjectId
    active: bool


class AlertRuleIn(ApiInputModel):
    field_id: PyObjectId
    metric: Metric
    operator: AlertOperator
    threshold: FiniteFloat
    window_minutes: int = Field(ge=1, le=525600)
    active: bool = True


class AlertRuleUpdate(ApiInputModel):
    field_id: str = None
    metric: Metric = None
    operator: AlertOperator = None
    threshold: FiniteFloat = None
    window_minutes: int = Field(default=None, ge=1, le=525600)
    active: bool = None

    @model_validator(mode="after")
    def required_update_values_are_not_null(self):
        reject_null_patch_fields(
            self, ("field_id", "metric", "operator", "threshold", "window_minutes", "active")
        )
        return self


class AlertRuleOut(ApiModel):
    id: PyObjectId = Field(validation_alias="_id")
    field_id: PyObjectId
    metric: Metric
    operator: AlertOperator
    threshold: float
    window_minutes: int
    active: bool


class AlertIn(ApiInputModel):
    rule_id: PyObjectId
    field_id: PyObjectId
    metric: Metric
    value: FiniteFloat
    threshold: FiniteFloat
    triggered_at: datetime


class AlertUpdate(ApiInputModel):
    status: AlertStatus = None
    resolved_at: datetime | None = None

    @model_validator(mode="after")
    def status_is_not_null_when_provided(self):
        reject_null_patch_fields(self, ("status",))
        return self


class AlertOut(ApiModel):
    id: PyObjectId = Field(validation_alias="_id")
    rule_id: PyObjectId
    field_id: PyObjectId
    metric: Metric
    value: float
    threshold: float
    status: AlertStatus
    triggered_at: datetime
    resolved_at: datetime | None = None
    notified_at: datetime | None = None


class ReadingLatestOut(ApiModel):
    sensor_id: PyObjectId
    ts: datetime
    soil_moisture: float | None = None
    soil_temp: float | None = None
    air_temp: float | None = None
    rainfall_mm: float | None = None


class SeriesPointOut(ApiModel):
    bucket: datetime
    value: float
    min: float | None = None
    max: float | None = None
    readings: int


class NearbyStationOut(ApiModel):
    code: str
    name: str | None = None
    state: str | None = None
    distance_km: float


class WeatherPointOut(ApiModel):
    ts: datetime
    rain_mm: float | None = None
    air_temp: float | None = None
    humidity: float | None = None
    wind_ms: float | None = None


class WeatherHistoryOut(ApiModel):
    station: NearbyStationOut | None = None
    available_years: list[int] = Field(default_factory=list)
    selected_year: int | None = None
    readings: list[WeatherPointOut]


class FarmSummaryOut(ApiModel):
    crop: Crop
    fields: int
    area_ha: float


class ProductionRankingOut(ApiModel):
    municipality: str
    state: str
    year: int
    yield_kg_ha: float
    production_t: float
    planted_area_ha: float
