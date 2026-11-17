"""Run offline rolling-origin baseline evaluation on the synthetic fixture."""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from .baselines import MODEL_NAMES, model_predictor, recursive_forecast
from .data import DataValidationError, SalesDataset, SalesRow, load_dataset
from .metrics import calculate_metrics, mae, mase_scale, rmsle, wape
from .split import (
    TEST_END,
    TEST_START,
    TRAIN_END,
    TRAIN_START,
    VALIDATION_END,
    VALIDATION_START,
    split_dataset,
)

PACKAGE_ROOT = Path(__file__).resolve().parents[2]
HORIZONS = (7, 14, 30)


def _date_range(start: date, end: date):
    current = start
    while current <= end:
        yield current
        current += timedelta(days=1)


def _rows_by_product(rows: tuple[SalesRow, ...] | list[SalesRow]) -> dict[str, dict[date, SalesRow]]:
    grouped: dict[str, dict[date, SalesRow]] = defaultdict(dict)
    for row in rows:
        grouped[row.synthetic_product_id][row.date] = row
    return grouped


def _evaluate_period(
    sku_rows: dict[date, SalesRow],
    sku: str,
    split_name: str,
    split_start: date,
    split_end: date,
    training_values: list[float],
    horizons: tuple[int, ...],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    scale = mase_scale(training_values, period=7)
    forecast_runs: list[dict[str, Any]] = []
    summaries: list[dict[str, Any]] = []
    first_origin = split_start - timedelta(days=1)

    for horizon in horizons:
        last_origin = split_end - timedelta(days=horizon)
        all_actual: list[int] = []
        all_predicted: list[float] = []
        origin_count = 0
        for origin in _date_range(first_origin, last_origin):
            history_dates = sorted(day for day in sku_rows if day <= origin)
            history = [float(sku_rows[day].quantity_sold) for day in history_dates]
            if len(history) < 28:
                continue
            target_dates = [origin + timedelta(days=step) for step in range(1, horizon + 1)]
            if any(day not in sku_rows for day in target_dates):
                raise ValueError(f"Missing actual test values for {sku} at origin {origin}.")
            actual = [sku_rows[day].quantity_sold for day in target_dates]
            origin_count += 1

            for model_name in MODEL_NAMES:
                predicted = recursive_forecast(history, horizon, model_predictor(model_name))
                forecast_runs.append({
                    "split": split_name,
                    "model": model_name,
                    "synthetic_product_id": sku,
                    "horizon_days": horizon,
                    "origin_date": origin.isoformat(),
                    "forecast_dates": [day.isoformat() for day in target_dates],
                    "forecast": predicted,
                    "actual": actual,
                })

        for model_name in MODEL_NAMES:
            model_runs = [run for run in forecast_runs if run["split"] == split_name and run["model"] == model_name and run["synthetic_product_id"] == sku and run["horizon_days"] == horizon]
            actual_values = [value for run in model_runs for value in run["actual"]]
            predicted_values = [value for run in model_runs for value in run["forecast"]]
            summaries.append({
                "split": split_name,
                "model": model_name,
                "synthetic_product_id": sku,
                "horizon_days": horizon,
                "forecast_origins": origin_count,
                "observations": len(actual_values),
                "metrics": calculate_metrics(actual_values, predicted_values, scale) if actual_values else {"MAE": None, "WAPE": None, "RMSLE": None, "MASE": None},
            })

    return forecast_runs, summaries


def build_report(dataset: SalesDataset, horizons: tuple[int, ...] = HORIZONS) -> dict[str, Any]:
    if not horizons or any(isinstance(h, bool) or not isinstance(h, int) or h < 1 for h in horizons):
        raise ValueError("horizons must contain positive integers.")
    split = split_dataset(dataset)
    train_by_sku = _rows_by_product(split.train)
    all_by_sku = _rows_by_product(dataset.rows)
    all_forecasts: list[dict[str, Any]] = []
    sku_summaries: list[dict[str, Any]] = []

    periods = (
        ("validation", VALIDATION_START, VALIDATION_END),
        ("test", TEST_START, TEST_END),
    )
    for sku in dataset.product_ids:
        sku_rows = all_by_sku[sku]
        training_values = [float(row.quantity_sold) for _, row in sorted(train_by_sku[sku].items())]
        for split_name, period_start, period_end in periods:
            forecasts, summaries = _evaluate_period(
                sku_rows, sku, split_name, period_start, period_end, training_values, horizons
            )
            all_forecasts.extend(forecasts)
            sku_summaries.extend(summaries)

    global_summaries: list[dict[str, Any]] = []
    for split_name, _, _ in periods:
        for horizon in horizons:
            for model_name in MODEL_NAMES:
                matching = [run for run in all_forecasts if run["split"] == split_name and run["model"] == model_name and run["horizon_days"] == horizon]
                actual = [value for run in matching for value in run["actual"]]
                predicted = [value for run in matching for value in run["forecast"]]
                per_sku_mase = [
                    item["metrics"]["MASE"]
                    for item in sku_summaries
                    if item["split"] == split_name
                    and item["model"] == model_name
                    and item["horizon_days"] == horizon
                    and item["metrics"]["MASE"] is not None
                ]
                aggregate_metrics = {
                    "MAE": mae(actual, predicted) if actual else None,
                    "WAPE": wape(actual, predicted) if actual else None,
                    "RMSLE": rmsle(actual, predicted) if actual else None,
                    "MASE": None,
                }
                # MASE is scale-dependent, so the overall figure is the macro-average
                # of per-SKU MASE values rather than a pooled error divided by an
                # unweighted average of unrelated SKU scales.
                aggregate_metrics["MASE"] = (
                    sum(per_sku_mase) / len(per_sku_mase) if per_sku_mase else None
                )
                global_summaries.append({
                    "split": split_name,
                    "model": model_name,
                    "synthetic_product_id": None,
                    "horizon_days": horizon,
                    "forecast_origins": len({run["origin_date"] for run in matching}),
                    "observations": len(actual),
                    "metrics": aggregate_metrics,
                })

    return {
        "metadata": {
            "source": "SYNTHETIC",
            "protocol": "rolling_origin_recursive_forecast",
            "training_period": {"start": TRAIN_START.isoformat(), "end": TRAIN_END.isoformat()},
            "validation_period": {"start": VALIDATION_START.isoformat(), "end": VALIDATION_END.isoformat()},
            "test_period": {"start": TEST_START.isoformat(), "end": TEST_END.isoformat()},
            "horizons_days": list(horizons),
            "models": list(MODEL_NAMES),
            "metrics": ["MAE", "WAPE", "RMSLE", "MASE"],
            "overlapping_windows_note": "Rolling-origin forecast windows overlap and are correlated; metrics are descriptive.",
            "limitation": "Synthetic-only evaluation; it does not establish real-world forecast quality.",
        },
        "summary": global_summaries + sku_summaries,
        "forecasts": all_forecasts,
    }


def resolve_module_path(value: str) -> Path:
    path = Path(value).expanduser()
    return path.resolve() if path.is_absolute() else (PACKAGE_ROOT / path).resolve()


def write_report(path: Path, report: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8", newline="\n") as report_file:
        json.dump(report, report_file, ensure_ascii=False, indent=2, allow_nan=False)
        report_file.write("\n")


def main() -> int:
    parser = argparse.ArgumentParser(description="Run offline synthetic MarketKZ sales forecast baselines.")
    parser.add_argument("--input", default="../../fixtures/synthetic-sales-2025-2026.json")
    parser.add_argument("--output", default="reports/baseline-results.json")
    args = parser.parse_args()
    input_path = resolve_module_path(args.input)
    output_path = resolve_module_path(args.output)
    try:
        dataset = load_dataset(input_path)
        report = build_report(dataset)
        write_report(output_path, report)
    except (DataValidationError, OSError, ValueError) as error:
        parser.error(str(error))
    print(json.dumps({"output": str(output_path), "forecast_runs": len(report["forecasts"]), "summary_rows": len(report["summary"]), "source": report["metadata"]["source"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
