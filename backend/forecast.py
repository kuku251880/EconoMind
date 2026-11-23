from decimal import Decimal

from backend.series import quarter_label, quarter_number

TRAINING_QUARTERS = 4
MAX_QUARTER = quarter_number("9999-Q4")


def error_metrics(errors: list[Decimal]) -> dict[str, Decimal | None]:
    if not errors:
        return {"mae": None, "rmse": None}
    count = len(errors)
    return {
        "mae": sum(errors) / count,
        "rmse": (sum(error ** 2 for error in errors) / count).sqrt(),
    }


def evaluate_baseline(values: dict[int, Decimal]) -> dict:
    """Backtest one-quarter-ahead forecasts using the previous actual value."""
    predictions = []
    for quarter, actual in sorted(values.items()):
        previous = values.get(quarter - 1)
        if previous is None:
            continue
        predictions.append({
            "period": quarter_label(quarter),
            "base_period": quarter_label(quarter - 1),
            "actual": actual,
            "predicted": previous,
            "absolute_error": abs(actual - previous),
        })
    return {
        "evaluated_count": len(predictions),
        "skipped_count": len(values) - len(predictions),
        **error_metrics([point["absolute_error"] for point in predictions]),
        "predictions": predictions,
    }


def predict_quarter(values: dict[int, Decimal], quarter: int) -> dict | None:
    training = []
    for period in range(quarter - TRAINING_QUARTERS, quarter):
        if period not in values:
            return None
        training.append(values[period])
    # Fit least squares at x=0,1,2,3 and evaluate at x=4.
    mean_x = Decimal(TRAINING_QUARTERS - 1) / 2
    mean_y = sum(training) / TRAINING_QUARTERS
    offsets = [x - mean_x for x in range(TRAINING_QUARTERS)]
    slope = sum(dx * (value - mean_y) for dx, value in zip(offsets, training)) / sum(
        dx ** 2 for dx in offsets
    )
    return {
        "period": quarter_label(quarter),
        "baseline": training[-1],
        "linear_trend": mean_y + slope * (TRAINING_QUARTERS - mean_x),
    }


def compare_forecasts(values: dict[int, Decimal]) -> dict:
    predictions = []
    for quarter, actual in sorted(values.items()):
        prediction = predict_quarter(values, quarter)
        if prediction is not None:
            predictions.append({**prediction, "actual": actual})

    latest = max(values, default=MAX_QUARTER)
    return {
        "evaluated_count": len(predictions),
        "skipped_count": len(values) - len(predictions),
        "baseline_metrics": error_metrics([abs(row["actual"] - row["baseline"]) for row in predictions]),
        "linear_metrics": error_metrics([abs(row["actual"] - row["linear_trend"]) for row in predictions]),
        "predictions": predictions,
        "next_forecast": predict_quarter(values, latest + 1) if latest < MAX_QUARTER else None,
    }
