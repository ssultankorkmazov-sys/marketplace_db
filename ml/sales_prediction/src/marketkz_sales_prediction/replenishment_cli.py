"""Build a reproducible synthetic XGBoost forecast and supplier comparison."""

from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import date, timedelta
from pathlib import Path
from typing import Sequence

from .data import load_dataset
from .evaluation import build_supervised_examples, recursive_xgboost_forecast
from .features import FeatureSpec
from .model import XGBoostConfig, fit_final_model
from .replenishment import (
    ForecastDay,
    calculate_replenishment_recommendation,
    compare_supplier_offers,
)
from .split import TRAIN_START, VALIDATION_END
from .supplier_data import SupplierFixtureError, load_supplier_fixture


PROJECT_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_SALES_FIXTURE = PROJECT_ROOT / "fixtures" / "synthetic-sales-2025-2026.json"
DEFAULT_SUPPLIER_FIXTURE = PROJECT_ROOT / "ml" / "sales_prediction" / "fixtures" / "synthetic-suppliers-2026.json"
DEFAULT_PHASE2B_REPORT = PROJECT_ROOT / "ml" / "sales_prediction" / "reports" / "phase2b-xgboost-results.json"
DEFAULT_OUTPUT = PROJECT_ROOT / "ml" / "sales_prediction" / "reports" / "phase3ab-synthetic-replenishment.json"


def _resolve_path(value: str | Path) -> Path:
    path = Path(value)
    return path if path.is_absolute() else PROJECT_ROOT / path


def _selected_xgboost_config(report_path: Path) -> XGBoostConfig:
    try:
        report = json.loads(report_path.read_text(encoding="utf-8"))
        if report.get("metadata", {}).get("source") != "SYNTHETIC":
            raise ValueError("Phase 2B config report is not marked SYNTHETIC.")
        config = report["metadata"]["parameter_selection"]["selected_config"]
        return XGBoostConfig(**config)
    except (OSError, json.JSONDecodeError, KeyError, TypeError) as error:
        raise ValueError(f"Unable to load the selected Phase 2B model configuration from {report_path}.") from error


def build_demo_report(
    sales_path: str | Path = DEFAULT_SALES_FIXTURE,
    supplier_path: str | Path = DEFAULT_SUPPLIER_FIXTURE,
    phase2b_report_path: str | Path = DEFAULT_PHASE2B_REPORT,
    *,
    review_period_days: int = 7,
    safety_days: int = 7,
) -> dict:
    if isinstance(review_period_days, bool) or not isinstance(review_period_days, int) or review_period_days < 0:
        raise ValueError("review_period_days must be a non-negative integer.")
    if isinstance(safety_days, bool) or not isinstance(safety_days, int) or safety_days < 0:
        raise ValueError("safety_days must be a non-negative integer.")

    dataset = load_dataset(_resolve_path(sales_path))
    catalog = load_supplier_fixture(_resolve_path(supplier_path), dataset.product_ids)
    if catalog.as_of_date < TRAIN_START or catalog.as_of_date > date.fromisoformat(dataset.metadata["end_date"]):
        raise ValueError("Synthetic inventory as_of_date must be inside the sales fixture period.")

    spec = FeatureSpec.create(dataset.products, dataset.seasonal_events)
    features, targets, _ = build_supervised_examples(dataset, spec, TRAIN_START, VALIDATION_END)
    config = _selected_xgboost_config(_resolve_path(phase2b_report_path))
    model = fit_final_model(features, targets, config)

    products_by_id = {product["synthetic_product_id"]: product for product in dataset.products}
    rows_by_product: dict[str, dict[date, object]] = {product_id: {} for product_id in dataset.product_ids}
    for row in dataset.rows:
        rows_by_product[row.synthetic_product_id][row.date] = row
    max_horizon = max(offer.lead_time_days for offer in catalog.offers) + review_period_days
    recommendations: list[dict] = []
    forecasts_by_product: dict[str, list[ForecastDay]] = {}

    for product_id in dataset.product_ids:
        product_rows = rows_by_product[product_id]
        history = {
            day: float(row.quantity_sold)
            for day, row in product_rows.items()
            if day <= catalog.as_of_date
        }
        target_dates = [catalog.as_of_date + timedelta(days=offset) for offset in range(1, max_horizon + 1)]
        category_id = int(products_by_id[product_id]["category_id"])
        predicted = recursive_xgboost_forecast(
            model, target_dates, product_id, category_id, history, spec, dataset.seasonal_events
        )
        forecasts_by_product[product_id] = [
            ForecastDay(day, demand) for day, demand in zip(target_dates, predicted)
        ]

    for product_id in dataset.product_ids:
        history_values = [
            float(rows_by_product[product_id][catalog.as_of_date - timedelta(days=lag)].quantity_sold)
            for lag in range(27, -1, -1)
        ]
        recent_daily_mean = sum(history_values) / len(history_values)
        safety_stock = math.ceil(recent_daily_mean * safety_days)
        alternatives = []
        alternative_rows = {}
        supplier_names = {item["supplier_id"]: item["name"] for item in catalog.suppliers}
        for offer in catalog.offers:
            if offer.synthetic_product_id != product_id:
                continue
            result = calculate_replenishment_recommendation(
                synthetic_product_id=product_id,
                as_of_date=catalog.as_of_date,
                current_stock=catalog.current_stock[product_id],
                forecast=forecasts_by_product[product_id],
                safety_stock=safety_stock,
                review_period_days=review_period_days,
                offer=offer,
                inbound_shipments=catalog.inbound_shipments,
            )
            result_row = result.as_dict()
            result_row["product_name"] = str(products_by_id[product_id]["name"])
            result_row["supplier_name"] = supplier_names[offer.supplier_id]
            result_row["category_id"] = int(products_by_id[product_id]["category_id"])
            alternatives.append(result)
            alternative_rows[result.supplier_id] = result_row
        for alternative in compare_supplier_offers(alternatives):
            recommendations.append(alternative_rows[alternative.supplier_id])

    return {
        "metadata": {
            "source": "SYNTHETIC",
            "experiment": "Phase 3A/3B offline smart replenishment demonstration",
            "as_of_date": catalog.as_of_date.isoformat(),
            "model": "xgboost_global_count_poisson",
            "model_config": config.as_dict(),
            "training_period": {"start": TRAIN_START.isoformat(), "end": VALIDATION_END.isoformat()},
            "forecast_period": {
                "start": (catalog.as_of_date + timedelta(days=1)).isoformat(),
                "end": (catalog.as_of_date + timedelta(days=max_horizon)).isoformat(),
            },
            "review_period_days": review_period_days,
            "safety_stock_policy": {
                "name": "trailing_28_day_mean_times_safety_days",
                "safety_days": safety_days,
                "note": "Provisional demonstration parameter, not calibrated for real service levels.",
            },
            "supplier_count": len(catalog.suppliers),
            "synthetic_product_count": len(dataset.product_ids),
            "supplier_offer_count": len(catalog.offers),
            "recommendation_count": len(recommendations),
            "limitations": [
                "All products, inventory, offers, shipments, and forecasts are synthetic.",
                "Supplier alternatives are independent choices; do not sum recommended quantities across suppliers.",
                "Recommendations do not place supplier orders or modify stock.",
                "The Phase 2B selected configuration is reused; its research report is not modified.",
            ],
        },
        "recommendations": recommendations,
    }


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sales-input", default=str(DEFAULT_SALES_FIXTURE))
    parser.add_argument("--supplier-input", default=str(DEFAULT_SUPPLIER_FIXTURE))
    parser.add_argument("--phase2b-report", default=str(DEFAULT_PHASE2B_REPORT))
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--review-period-days", type=int, default=7)
    parser.add_argument("--safety-days", type=int, default=7)
    args = parser.parse_args(argv)
    output_path = _resolve_path(args.output)
    if output_path.exists():
        parser.error(f"Refusing to overwrite existing output: {output_path}")
    try:
        report = build_demo_report(
            args.sales_input,
            args.supplier_input,
            args.phase2b_report,
            review_period_days=args.review_period_days,
            safety_days=args.safety_days,
        )
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    except (OSError, ValueError, SupplierFixtureError, RuntimeError) as error:
        print(f"Replenishment demo failed: {error}", file=sys.stderr)
        return 1
    print(f"Synthetic replenishment report written to {output_path}")
    print(f"Products: {report['metadata']['synthetic_product_count']}; supplier alternatives: {report['metadata']['recommendation_count']}")
    for row in report["recommendations"]:
        print(
            f"{row['synthetic_product_id']} | {row['supplier_name']} | "
            f"qty={row['recommended_quantity']} | cost={row['estimated_cost']} {row['currency']} | "
            f"{row['recommendation_status']}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
