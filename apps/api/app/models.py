from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, BeforeValidator, EmailStr, Field, field_validator

from app.geo import is_closed

PyObjectId = Annotated[str, BeforeValidator(str)]
Position = Annotated[list[float], Field(min_length=2, max_length=2)]
Crop = Literal["soja", "milho", "cana", "cafe", "trigo", "algodao"]
Metric = Literal["soil_moisture", "soil_temp", "air_temp", "rainfall_mm"]


class UserCreate(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    email: EmailStr
    password: str = Field(min_length=8, max_length=72)


class UserOut(BaseModel):
    id: PyObjectId = Field(validation_alias="_id")
    name: str
    email: str
    role: str


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class Point(BaseModel):
    type: Literal["Point"] = "Point"
    coordinates: Position


class Polygon(BaseModel):
    type: Literal["Polygon"] = "Polygon"
    coordinates: list[list[Position]]

    @field_validator("coordinates")
    @classmethod
    def rings_must_be_closed(cls, rings):
        if not rings or not all(is_closed(ring) for ring in rings):
            raise ValueError("cada anel do polígono precisa ter 4+ pontos e fechar no primeiro")
        return rings


class FarmIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    municipality: str = Field(min_length=2, max_length=120)
    state: str = Field(pattern=r"^[A-Z]{2}$")
    location: Point


class FarmUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    municipality: str | None = Field(default=None, min_length=2, max_length=120)
    state: str | None = Field(default=None, pattern=r"^[A-Z]{2}$")
    location: Point | None = None


class FarmOut(FarmIn):
    id: PyObjectId = Field(validation_alias="_id")
    created_at: datetime


class FieldIn(BaseModel):
    farm_id: PyObjectId
    name: str = Field(min_length=1, max_length=120)
    crop: Crop
    boundary: Polygon
    attributes: dict = Field(default_factory=dict)


class FieldUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    crop: Crop | None = None
    boundary: Polygon | None = None
    attributes: dict | None = None


class FieldOut(BaseModel):
    id: PyObjectId = Field(validation_alias="_id")
    farm_id: PyObjectId
    name: str
    crop: Crop
    area_ha: float
    boundary: Polygon
    centroid: Point
    attributes: dict
    created_at: datetime
