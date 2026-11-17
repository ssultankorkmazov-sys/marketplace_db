from __future__ import annotations

import unittest
from datetime import date, timedelta

from marketkz_sales_prediction.data import SalesRow
from marketkz_sales_prediction.evaluation import (
    assert_matching_evaluation_dates,
    recursive_xgboost_forecast,
    summarize_test_runs,
)
from marketkz_sales_prediction.features import FeatureSpec


class EvaluationTests(unittest.TestCase):
    def test_recursive_prediction_is_added_to_history_for_the_next_day(self) -> None:
        target_start = date(2025, 1, 29)
        history = {target_start - timedelta(days=lag): float(lag) for lag in range(1, 29)}
        spec = FeatureSpec.create([{"synthetic_product_id": "SYN-A", "category_id": 3}], [])

        class IncrementLagModel:
            def predict(self, matrix):
                return [float(matrix[0][-6]) + 1]

        target_dates = [target_start + timedelta(days=offset) for offset in range(3)]
        predictions = recursive_xgboost_forecast(
            IncrementLagModel(), target_dates, "SYN-A", 3, history, spec, []
        )
        self.assertEqual(predictions, [2.0, 3.0, 4.0])
        self.assertEqual(history[target_dates[-1]], 4.0)

    def test_xgboost_and_baselines_must_use_identical_test_dates(self) -> None:
        shared = {
            "split": "test", "synthetic_product_id": "SYN-A", "origin_date": "2026-06-30",
            "horizon_days": 7, "forecast_dates": [f"2026-07-{day:02d}" for day in range(1, 8)],
        }
        baseline = [
            {**shared, "model": model}
            for model in ("moving_average_7", "moving_average_28", "seasonal_naive_7")
        ]
        matching = [{key: value for key, value in shared.items() if key != "split"}]
        assert_matching_evaluation_dates(baseline, matching)
        with self.assertRaisesRegex(ValueError, "do not match"):
            assert_matching_evaluation_dates(baseline, matching[:-1])

    def test_comparison_reports_overall_sku_and_holiday_metrics(self) -> None:
        sku = "SYN-A"
        train_rows = [
            SalesRow(date(2025, 1, 1) + timedelta(days=offset), sku, 3, offset % 4, 100.0, 0.0, 100.0, "SYNTHETIC")
            for offset in range(35)
        ]
        events = [{
            "code": "NAURYZ", "date": date(2026, 7, 2),
            "influence_before_days": 0, "influence_after_days": 0,
        }]
        common = {
            "split": "test", "synthetic_product_id": sku, "origin_date": "2026-06-30",
            "horizon_days": 3, "forecast_dates": ["2026-07-01", "2026-07-02", "2026-07-03"],
            "actual": [2, 2, 2],
        }
        runs = [
            {**common, "model": "moving_average_7", "forecast": [1.0, 1.0, 1.0]},
            {**common, "model": "xgboost_global_count_poisson", "forecast": [2.0, 2.0, 2.0]},
        ]
        summaries = summarize_test_runs(runs, train_rows, events)
        self.assertTrue(any(row["synthetic_product_id"] is None for row in summaries))
        self.assertTrue(any(row["synthetic_product_id"] == sku for row in summaries))
        holiday_rows = [row for row in summaries if row["period_type"] == "holiday"]
        ordinary_rows = [row for row in summaries if row["period_type"] == "ordinary"]
        self.assertTrue(holiday_rows)
        self.assertTrue(ordinary_rows)
        xgb_overall = next(
            row for row in summaries
            if row["model"] == "xgboost_global_count_poisson"
            and row["period_type"] == "overall"
            and row["synthetic_product_id"] is None
        )
        self.assertEqual(xgb_overall["metrics"]["MAE"], 0.0)


if __name__ == "__main__":
    unittest.main()
