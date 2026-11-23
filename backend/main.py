from decimal import Decimal
from enum import StrEnum
from typing import Annotated

from fastapi import FastAPI, HTTPException, Path, Query
from pydantic import BaseModel
from sqlalchemy.exc import OperationalError

from backend.series import INDICATORS, database_url, engine_for, quarter_number, query_series


class IndicatorCode(StrEnum):
    GDP = "gdp"
    CPI = "cpi"


class Indicator(BaseModel):
    code: IndicatorCode
    name: str


app = FastAPI(title="EconoMind API")


@app.get("/api/v1/indicators/{code}", response_model=Indicator)
def get_indicator(code: IndicatorCode) -> Indicator:
    return Indicator(code=code, name=INDICATORS[code][0])


class SeriesPoint(BaseModel):
    period: str
    value: Decimal
    yoy_percent: Decimal | None
    qoq_percent: Decimal | None


class IndicatorSeries(BaseModel):
    dataset_id: int
    code: IndicatorCode
    source: str
    unit: str
    frequency: str
    points: list[SeriesPoint]


@app.get("/api/v1/datasets/{dataset_id}/indicators/{code}/series", response_model=IndicatorSeries)
def get_series(
    dataset_id: Annotated[int, Path(gt=0, le=2_147_483_647)],
    code: IndicatorCode,
    start: Annotated[str, Query()],
    end: Annotated[str, Query()],
):
    try:
        first, last = quarter_number(start), quarter_number(end)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    if first > last:
        raise HTTPException(422, "start must be before or equal to end")
    url = database_url()
    if not url:
        raise HTTPException(503, "Database is not configured")
    try:
        series = query_series(engine_for(url), dataset_id, code.value, first, last)
    except (ValueError, OperationalError) as error:
        raise HTTPException(503, "Database is unavailable") from error
    if series is None:
        raise HTTPException(404, "Dataset not found")
    return series
