import asyncio
from decimal import Decimal
from pathlib import Path

from backend.forecast import compare_forecasts, evaluate_baseline
from backend.series import import_csv, quarter_number
from backend.tests.test_mvp import ACCOUNT_PATH, DATA_PATH, HEADERS, PASSWORD, client, database


def test_backtest_uses_only_the_previous_observed_quarter():
    values = {
        quarter_number("2025-Q2"): Decimal("20"),
        quarter_number("2024-Q4"): Decimal("10"),
        quarter_number("2025-Q1"): Decimal("12"),
    }
    result = evaluate_baseline(values)

    assert result["evaluated_count"] == 2
    assert result["skipped_count"] == 1
    assert result["mae"] == Decimal("5")
    assert result["rmse"] == Decimal("34").sqrt()
    assert [(point["period"], point["predicted"]) for point in result["predictions"]] == [
        ("2025-Q1", Decimal("10")), ("2025-Q2", Decimal("12")),
    ]


def test_backtest_skips_gaps_and_keeps_a_zero_baseline():
    result = evaluate_baseline({
        quarter_number("2024-Q1"): Decimal("100"),
        quarter_number("2024-Q4"): Decimal("0"),
        quarter_number("2025-Q1"): Decimal("102"),
    })

    assert result["evaluated_count"] == 1
    assert result["skipped_count"] == 2
    assert result["mae"] == result["rmse"] == Decimal("102")
    assert result["predictions"][0]["base_period"] == "2024-Q4"


def test_backtest_reports_no_metrics_without_consecutive_quarters():
    result = evaluate_baseline({
        quarter_number("2024-Q1"): Decimal("100"),
        quarter_number("2024-Q3"): Decimal("110"),
    })

    assert result["evaluated_count"] == 0
    assert result["skipped_count"] == 2
    assert result["mae"] is None and result["rmse"] is None
    assert result["predictions"] == []

def test_models_share_exact_targets_and_never_fit_on_the_target():
    start = quarter_number("2024-Q1")
    values = {start + index: Decimal(value) for index, value in enumerate([10, 12, 14, 16, 18, 25])}
    report = compare_forecasts(values)
    assert [row["period"] for row in report["predictions"]] == ["2025-Q1", "2025-Q2"]
    assert report["evaluated_count"] == 2 and report["skipped_count"] == 4
    assert report["baseline_metrics"]["mae"] == Decimal("4.5")
    assert report["linear_metrics"]["mae"] == Decimal("2.5")
    assert report["baseline_metrics"]["rmse"] == (Decimal("53") / 2).sqrt()
    assert report["linear_metrics"]["rmse"] == (Decimal("25") / 2).sqrt()

    changed = compare_forecasts({**values, start + 4: Decimal("1000")})
    original_first, changed_first = report["predictions"][0], changed["predictions"][0]
    assert original_first["actual"] != changed_first["actual"]
    assert original_first["baseline"] == changed_first["baseline"] == Decimal("16")
    assert original_first["linear_trend"] == changed_first["linear_trend"] == Decimal("18")


def test_gap_restarts_training_and_four_points_only_allow_an_estimate():
    start = quarter_number("2024-Q1")
    values = {start + index: Decimal(value) for index, value in [
        (0, 10), (1, 12), (3, 16), (4, 18), (5, 20), (6, 22),
    ]}
    report = compare_forecasts(values)
    assert report["predictions"] == []
    assert report["baseline_metrics"] == report["linear_metrics"] == {"mae": None, "rmse": None}
    assert report["next_forecast"] == {
        "period": "2025-Q4", "baseline": Decimal("22"), "linear_trend": Decimal("24"),
    }


def test_forecast_route_uses_selected_range_and_dataset_permissions(database):
    sample = Path(__file__).resolve().parents[2] / "data" / "sample-forecast.csv"

    async def exercise():
        async with client() as owner, client() as other:
            for session, email in [(owner, "forecaster@example.com"), (other, "other@example.com")]:
                credentials = {"email": email, "password": PASSWORD}
                registered = await session.post(f"{ACCOUNT_PATH}/register", headers=HEADERS, json=credentials)
                assert registered.status_code == 201
                if session is owner:
                    account_id = registered.json()["id"]
                assert (await session.post(f"{ACCOUNT_PATH}/login", headers=HEADERS, json=credentials)).status_code == 200
            with sample.open(encoding="utf-8", newline="") as stream:
                dataset = import_csv(database, stream, "Forecast sample", uploaded_by=account_id)

            path = f"{DATA_PATH}/{dataset}/indicators/gdp/forecast"
            params = {"start": "2023-Q1", "end": "2025-Q2"}
            assert (await other.get(path, params=params)).status_code == 404
            response = await owner.get(path, params=params)
            assert response.status_code == 200
            result = response.json()
            assert result["evaluated_count"] == 6
            assert result["baseline_metrics"]["mae"] == "4.000000"
            assert Decimal(result["linear_metrics"]["mae"]) == Decimal("0.5")
            assert result["next_forecast"]["period"] == "2025-Q3"
            assert Decimal(result["next_forecast"]["linear_trend"]) == Decimal("140")

            subset = (await owner.get(path, params={**params, "start": "2024-Q1"})).json()
            assert [point["period"] for point in subset["predictions"]] == ["2025-Q1", "2025-Q2"]
            bad = await owner.get(path, params={"start": "2025-Q2", "end": "2024-Q1"})
            assert bad.status_code == 422

    asyncio.run(exercise())
