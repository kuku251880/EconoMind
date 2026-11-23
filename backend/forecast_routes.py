from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Path, Query
from pydantic import BaseModel

from backend.accounts import Database, SignedIn
from backend.forecast import compare_forecasts
from backend.series import quarter_number, query_series

router = APIRouter(prefix="/api/v1/datasets", tags=["forecasts"])


class Metrics(BaseModel):
    mae: Decimal | None
    rmse: Decimal | None


class Prediction(BaseModel):
    period: str
    baseline: Decimal
    linear_trend: Decimal


class BacktestPoint(Prediction):
    actual: Decimal


class ForecastComparison(BaseModel):
    unit: str
    evaluated_count: int
    skipped_count: int
    baseline_metrics: Metrics
    linear_metrics: Metrics
    predictions: list[BacktestPoint]
    next_forecast: Prediction | None


@router.get("/{dataset_id}/indicators/{code}/forecast")
def forecast_indicator(
    dataset_id: Annotated[int, Path(gt=0, le=2_147_483_647)],
    code: Literal["gdp", "cpi"],
    start: Annotated[str, Query(max_length=7)],
    end: Annotated[str, Query(max_length=7)],
    account: SignedIn,
    engine: Database,
) -> ForecastComparison:
    try:
        first, last = quarter_number(start), quarter_number(end)
    except ValueError as error:
        raise HTTPException(422, "季度格式应类似 2025-Q1。") from error
    if not 0 <= last - first < 120:
        raise HTTPException(422, "请选择顺序正确且不超过 120 个季度的范围。")
    series = query_series(engine, dataset_id, code, first, last, viewer_id=account.id)
    if series is None:
        raise HTTPException(404, "Dataset not found")
    values = {quarter_number(point["period"]): point["value"] for point in series["points"]}
    return ForecastComparison(unit=series["unit"], **compare_forecasts(values))
