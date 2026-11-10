from typing import Annotated
from pydantic import AfterValidator, BaseModel, Field, model_validator


def nonblank(value: str) -> str:
    if not value.strip():
        raise ValueError('Enter a nonblank name or identifier.')
    return value


Coordinate = Annotated[float, Field(ge=0, le=100, allow_inf_nan=False)]
Label = Annotated[str, Field(min_length=1, max_length=120), AfterValidator(nonblank)]


class Station(BaseModel):
    id: Label
    name: Label
    x: Coordinate
    y: Coordinate


class StationSet(BaseModel):
    stations: list[Station] = Field(max_length=200)

    @model_validator(mode='after')
    def unique_stations(self):
        ids, points = set(), set()
        for s in self.stations:
            if s.id in ids:
                raise ValueError('Station IDs must be unique.')
            if (s.x, s.y) in points:
                raise ValueError('A station already exists at these coordinates.')
            ids.add(s.id)
            points.add((s.x, s.y))
        return self

    def points(self):
        return [s.model_dump() for s in self.stations]


class PlanInput(StationSet):
    name: Label
    show_districts: bool


class Query(StationSet):
    x: Coordinate
    y: Coordinate
