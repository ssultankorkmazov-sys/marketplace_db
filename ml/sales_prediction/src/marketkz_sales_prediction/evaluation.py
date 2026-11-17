"""Leakage-safe validation, refitting and matched-horizon test evaluation."""

from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from typing import Any, Sequence

from .baselines import recursive_forecast
from .data import SalesDataset, SalesRow
from .features import FeatureSpec, build_feature_vector
from .metrics import calculate_metrics, mae, mase_scale, rmsle, wape
from .model import DEFAULT_CANDIDATES, XGBoostConfig, fit_final_model, predict_count, tune_config
from .split import (
    TEST_END, TEST_START, TRAIN_END, TRAIN_START, VALIDATION_END, VALIDATION_START,
)

DEFAULT_HORIZONS = (7, 14, 30)


def _rows_by_product(rows: Sequence[SalesRow]) -> dict[str, dict[date, SalesRow]]:
    grouped: dict[str, dict[date, SalesRow]] = defaultdict(dict)
    for row in rows:
        grouped[row.synthetic_product_id][row.date] = row
    return grouped


def build_supervised_examples(
    dataset: SalesDataset,
    spec: FeatureSpec,
    start: date,
    end: date,
) -> tuple[list[list[float]], list[float], list[tuple[date, str]]]:
    """Walk rows forward, constructing each target from already observed history."""
    histories: dict[str, dict[date, float]] = {product_id: {} for product_id in dataset.product_ids}
    features: list[list[float]] = []
    targets: list[float] = []
    keys: list[tuple[date, str]] = []
    for row in dataset.rows:
        history = histories[row.synthetic_product_id]
        if start <= row.date <= end and len(history) >= 28:
            features.append(build_feature_vector(
                row.date,
                row.synthetic_product_id,
                row.category_id,
                history,
                spec,
                dataset.seasonal_events,
            ))
            targets.append(float(row.quantity_sold))
            keys.append((row.date, row.synthetic_product_id))
        history[row.date] = float(row.quantity_sold)
    if not features:
        raise ValueError(f"No supervised examples available for {start} through {end}.")
    return features, targets, keys


def recursive_xgboost_forecast(
    model: Any,
    target_dates: Sequence[date],
    product_id: str,
    category_id: int,
    history: dict[date, float],
    spec: FeatureSpec,
    seasonal_events: Sequence[dict],
) -> list[float]:
    """Forecast forward, appending each prediction before building next-day lags."""
    forecasts: list[float] = []
    for target_date in target_dates:
        features = build_feature_vector(target_date, product_id, category_id, history, spec, seasonal_events)
        prediction = predict_count(model, features)
        forecasts.append(prediction)
        history[target_date] = prediction
    return forecasts


def generate_test_forecasts(
    dataset: SalesDataset,
    model: Any,
    spec: FeatureSpec,
    baseline_runs: Sequence[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Use the exact baseline SKU/origin/horizon keys for a fair comparison."""
    all_rows = _rows_by_product(dataset.rows)
    category_by_product = {
        product["synthetic_product_id"]: int(product["category_id"])
        for product in dataset.products
    }
    expected_keys = {
        (run["synthetic_product_id"], run["origin_date"], run["horizon_days"])
        for run in baseline_runs
        if run["split"] == "test"
    }
    output: list[dict[str, Any]] = []
    for product_id, origin_text, horizon in sorted(expected_keys, key=lambda key: (key[0], key[1], key[2])):
        origin = date.fromisoformat(origin_text)
        sku_rows = all_rows[product_id]
        history = {day: float(row.quantity_sold) for day, row in sku_rows.items() if day <= origin}
        target_dates = [origin + timedelta(days=offset) for offset in range(1, horizon + 1)]
        if target_dates[-1] > TEST_END or target_dates[0] < TEST_START:
            raise ValueError("Baseline test origin falls outside the configured test period.")
        if any(day not in sku_rows for day in target_dates):
            raise ValueError(f"Missing test actuals for {product_id} at origin {origin}.")
        forecast = recursive_xgboost_forecast(
            model, target_dates, product_id, category_by_product[product_id],
            history, spec, dataset.seasonal_events,
        )
        output.append({
            "split": "test",
            "model": "xgboost_global_count_poisson",
            "synthetic_product_id": product_id,
            "horizon_days": horizon,
            "origin_date": origin.isoformat(),
            "forecast_dates": [day.isoformat() for day in target_dates],
            "forecast": forecast,
            "actual": [sku_rows[day].quantity_sold for day in target_dates],
        })
    assert_matching_evaluation_dates(baseline_runs, output)
    return output


def assert_matching_evaluation_dates(
    baseline_runs: Sequence[dict[str, Any]], xgboost_runs: Sequence[dict[str, Any]]
) -> None:
    baseline_keys = {
        (run["synthetic_product_id"], run["origin_date"], run["horizon_days"], tuple(run["forecast_dates"]))
        for run in baseline_runs
        if run["split"] == "test"
    }
    xgboost_keys = {
        (run["synthetic_product_id"], run["origin_date"], run["horizon_days"], tuple(run["forecast_dates"]))
        for run in xgboost_runs
    }
    if baseline_keys != xgboost_keys:
        missing = len(baseline_keys - xgboost_keys)
        extra = len(xgboost_keys - baseline_keys)
        raise ValueError(f"Model evaluation dates do not match baselines (missing={missing}, extra={extra}).")


def _is_holiday_period(day: date, events: Sequence[dict]) -> bool:
    for event in events:
        if event["code"] == "SUMMER_SEASON":
            continue
        offset = (day - event["date"]).days
        if -event["influence_before_days"] <= offset <= event["influence_after_days"]:
            return True
    return False


def summarize_test_runs(
    runs: Sequence[dict[str, Any]],
    train_rows: Sequence[SalesRow],
    seasonal_events: Sequence[dict],
) -> list[dict[str, Any]]:
    """Summarize matched test forecasts overall, by SKU, and holiday/ordinary day."""
    scales: dict[str, float | None] = {}
    training_by_sku = _rows_by_product(train_rows)
    for product_id, rows in training_by_sku.items():
        ordered = [float(row.quantity_sold) for _, row in sorted(rows.items())]
        scales[product_id] = mase_scale(ordered, period=7)

    groups: dict[tuple[str, int, str, str | None], list[tuple[int, float, str]]] = defaultdict(list)
    origins: dict[tuple[str, int, str, str | None], set[str]] = defaultdict(set)
    for run in runs:
        model_name = run["model"]
        horizon = int(run["horizon_days"])
        product_id = run["synthetic_product_id"]
        for day_text, actual, predicted in zip(run["forecast_dates"], run["actual"], run["forecast"]):
            day = date.fromisoformat(day_text)
            period = "holiday" if _is_holiday_period(day, seasonal_events) else "ordinary"
            for period_type in ("overall", period):
                groups[(model_name, horizon, period_type, product_id)].append(
                    (int(actual), float(predicted), run["origin_date"])
                )
                origins[(model_name, horizon, period_type, product_id)].add(run["origin_date"])

    summaries: list[dict[str, Any]] = []
    combinations = sorted({(model, horizon, period) for model, horizon, period, _ in groups})
    for model_name, horizon, period_type in combinations:
        sku_ids = sorted({sku for model, h, period, sku in groups if (model, h, period) == (model_name, horizon, period_type) and sku is not None})
        sku_metric_rows: list[dict[str, Any]] = []
        for sku in sku_ids:
            values = groups[(model_name, horizon, period_type, sku)]
            actual = [item[0] for item in values]
            predicted = [item[1] for item in values]
            metric_values = calculate_metrics(actual, predicted, scales.get(sku))
            summary = {
                "split": "test", "model": model_name, "synthetic_product_id": sku,
                "horizon_days": horizon, "period_type": period_type,
                "forecast_origins": len(origins[(model_name, horizon, period_type, sku)]),
                "observations": len(actual), "metrics": metric_values,
            }
            summaries.append(summary)
            sku_metric_rows.append(summary)

        pooled = [
            item
            for sku in sku_ids
            for item in groups[(model_name, horizon, period_type, sku)]
        ]
        actual = [item[0] for item in pooled]
        predicted = [item[1] for item in pooled]
        defined_mase = [row["metrics"]["MASE"] for row in sku_metric_rows if row["metrics"]["MASE"] is not None]
        summaries.append({
            "split": "test", "model": model_name, "synthetic_product_id": None,
            "horizon_days": horizon, "period_type": period_type,
            "forecast_origins": len({item[2] for item in pooled}),
            "observations": len(actual),
            "metrics": {
                "MAE": mae(actual, predicted) if actual else None,
                "WAPE": wape(actual, predicted) if actual else None,
                "RMSLE": rmsle(actual, predicted) if actual else None,
                "MASE": sum(defined_mase) / len(defined_mase) if defined_mase else None,
            },
        })
    return summaries


def run_experiment(
    dataset: SalesDataset,
    baseline_report_builder,
    candidates: Sequence[XGBoostConfig] = DEFAULT_CANDIDATES,
    horizons: Sequence[int] = DEFAULT_HORIZONS,
) -> dict[str, Any]:
    """Tune on validation, refit on train+validation, and evaluate test once."""
    from .split import split_dataset

    split = split_dataset(dataset)
    spec = FeatureSpec.create(dataset.products, dataset.seasonal_events)
    train_x, train_y, train_keys = build_supervised_examples(dataset, spec, TRAIN_START, TRAIN_END)
    validation_x, validation_y, validation_keys = build_supervised_examples(
        dataset, spec, VALIDATION_START, VALIDATION_END
    )
    selected, selection_metrics, trials = tune_config(
        train_x, train_y, validation_x, validation_y, candidates=candidates
    )

    final_x, final_y, final_keys = build_supervised_examples(dataset, spec, TRAIN_START, VALIDATION_END)
    final_model = fit_final_model(final_x, final_y, selected)
    baseline_report = baseline_report_builder(dataset, horizons=tuple(horizons))
    baseline_test_runs = [run for run in baseline_report["forecasts"] if run["split"] == "test"]
    xgboost_runs = generate_test_forecasts(dataset, final_model, spec, baseline_test_runs)
    all_test_runs = baseline_test_runs + xgboost_runs
    summaries = summarize_test_runs(all_test_runs, split.train, dataset.seasonal_events)

    return {
        "metadata": {
            "source": "SYNTHETIC",
            "protocol": "validation_tuned_train_plus_validation_refit_matched_rolling_origin_test",
            "training_period": {"start": TRAIN_START.isoformat(), "end": TRAIN_END.isoformat()},
            "validation_period": {"start": VALIDATION_START.isoformat(), "end": VALIDATION_END.isoformat()},
            "test_period": {"start": TEST_START.isoformat(), "end": TEST_END.isoformat()},
            "models": [
                "moving_average_7", "moving_average_28", "seasonal_naive_7",
                "xgboost_global_count_poisson",
            ],
            "horizons_days": list(horizons),
            "features": list(spec.names),
            "excluded_generator_fields": [
                "event_multiplier", "seasonal_multiplier", "applied_event_codes",
                "base_daily_demand", "holiday_sensitive", "demand_profile",
                "future_price", "future_discount",
            ],
            "parameter_selection": {
                "selection_split": "validation",
                "selection_method": "walk_forward_one_day_ahead_MAE_with_early_stopping",
                "selected_config": selected.as_dict(),
                "selection_metrics": selection_metrics,
                "candidate_trials": trials,
                "final_fit_period": {"start": TRAIN_START.isoformat(), "end": VALIDATION_END.isoformat()},
            },
            "test_evaluations_match_baseline_dates": True,
            "holiday_period_definition": "Dates inside fixture holiday influence windows; SUMMER_SEASON is reported as ordinary for holiday comparison.",
            "overlapping_windows_note": "Daily rolling-origin forecasts overlap and are correlated; metrics are descriptive.",
            "limitation": "Synthetic-only evaluation; it does not establish real-world forecast quality.",
            "supervised_examples": {
                "train": len(train_keys), "validation": len(validation_keys), "final_train_plus_validation": len(final_keys),
            },
        },
        "summary": summaries,
        "forecasts": all_test_runs,
    }
