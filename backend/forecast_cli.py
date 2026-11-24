import argparse
import json
from pathlib import Path

from backend.forecast import compare_forecasts, evaluate_baseline
from backend.series import INDICATORS, MONTHLY_CODES, YTD_CODES, SHARE_CODES, MAX_CSV_BYTES, decode_csv, read_csv


def main():
    parser = argparse.ArgumentParser(description="Backtest a previous-quarter baseline on a CSV")
    parser.add_argument("file", type=Path)
    parser.add_argument("--indicator", required=True, choices=sorted(INDICATORS.keys() - YTD_CODES - SHARE_CODES - MONTHLY_CODES))
    parser.add_argument("--compare", action="store_true", help="Compare both models on common quarters")
    args = parser.parse_args()

    try:
        with args.file.open("rb") as file:
            rows = read_csv(decode_csv(file.read(MAX_CSV_BYTES + 1)))
    except (OSError, ValueError) as error:
        parser.exit(1, f"Backtest failed: {error}\n")
    values = {quarter: value for (code, quarter), value in rows.items() if code == args.indicator}
    if not values:
        parser.exit(1, f"Backtest failed: CSV has no observations for {args.indicator}\n")
    if args.compare:
        report = {"indicator": args.indicator, **compare_forecasts(values)}
    else:
        report = {"indicator": args.indicator, "model": "previous_quarter", **evaluate_baseline(values)}
    print(json.dumps(report, default=str, indent=2))


if __name__ == "__main__":
    main()
