from decimal import Decimal
from enum import StrEnum
from typing import Annotated

from fastapi import FastAPI, HTTPException, Path, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.exc import OperationalError

from backend.accounts import find_account, require_database, router as accounts_router
from backend.dataset_routes import router as datasets_router
from backend.series import INDICATORS, quarter_number, query_series


class IndicatorCode(StrEnum):
    GDP = "gdp"
    CPI = "cpi"


class Indicator(BaseModel):
    code: IndicatorCode
    name: str


app = FastAPI(title="EconoMind API", max_body_size=2 * 1024 * 1024 + 65536)
app.include_router(accounts_router)
app.include_router(datasets_router)


@app.middleware("http")
async def prevent_api_caching(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.exception_handler(RequestValidationError)
async def validation_error(_request: Request, error: RequestValidationError):
    details = [{key: entry[key] for key in ("type", "loc", "msg")} for entry in error.errors()]
    return JSONResponse(status_code=422, content={"detail": details})


@app.exception_handler(OperationalError)
async def unavailable_database(_request: Request, _error: OperationalError):
    return JSONResponse(status_code=503, content={"detail": "Database is unavailable"})


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
    request: Request,
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
    engine = require_database()
    viewer = find_account(request, engine)
    series = query_series(
        engine, dataset_id, code.value, first, last, viewer_id=viewer.id if viewer else None,
    )
    if series is None:
        raise HTTPException(404, "Dataset not found")
    return series
