from __future__ import annotations

import unittest
from datetime import date, timedelta

from marketkz_sales_prediction.baselines import moving_average, recursive_forecast, seasonal_naive
from marketkz_sales_prediction.cli import _evaluate_period
from marketkz_sales_prediction.data import SalesRow


class BaselineTests(unittest.TestCase):
    def test_moving_average_uses_only_trailing_window(self) -> None:
        history = [1, 2, 3, 4, 5, 6, 7, 100]
        self.assertEqual(moving_average(history, 7), 127 / 7)

    def test_moving_average_28_day_window(self) -> None:
        history = list(range(1, 29))
        self.assertEqual(moving_average(history, 28), 14.5)

    def test_moving_average_requires_full_history_window(self) -> None:
        with self.assertRaises(ValueError):
            moving_average([1, 2, 3], 7)

    def test_seasonal_naive_uses_value_seven_days_back(self) -> None:
        # Forecasting the point after 8 uses the observation at index 1 (value 2),
        # which is exactly seven time steps before that target.
        self.assertEqual(seasonal_naive([1, 2, 3, 4, 5, 6, 7, 8], 7), 2.0)

    def test_recursive_forecast_appends_predictions_not_future_actuals(self) -> None:
        history = [1.0, 2.0, 3.0]
        seen_history_lengths: list[int] = []

        def predictor(past):
            seen_history_lengths.append(len(past))
            return past[-1] + 1

        forecast = recursive_forecast(history, 3, predictor)
        self.assertEqual(forecast, [4.0, 5.0, 6.0])
        self.assertEqual(seen_history_lengths, [3, 4, 5])
        self.assertEqual(history, [1.0, 2.0, 3.0])

    def test_recursive_forecast_is_reproducible(self) -> None:
        history = [2.0, 4.0, 6.0, 8.0, 10.0, 12.0, 14.0]
        first = recursive_forecast(history, 14, lambda past: seasonal_naive(past, 7))
        second = recursive_forecast(history, 14, lambda past: seasonal_naive(past, 7))
        self.assertEqual(first, second)

    def test_evaluation_forecast_does_not_use_actuals_after_origin(self) -> None:
        first_day = date(2025, 1, 1)
        sku_rows = {}
        for offset in range(60):
            day = first_day + timedelta(days=offset)
            sku_rows[day] = SalesRow(
                date=day,
                synthetic_product_id="SYN-X1",
                category_id=1,
                quantity_sold=offset % 7 + 1,
                price=100.0,
                discount_percent=0.0,
                selling_price=100.0,
                source="SYNTHETIC",
            )

        period_start = date(2025, 2, 1)
        period_end = date(2025, 2, 7)
        training_values = [
            float(sku_rows[day].quantity_sold)
            for day in sorted(sku_rows)
            if day < period_start
        ]
        baseline_runs, _ = _evaluate_period(
            sku_rows, "SYN-X1", "test", period_start, period_end, training_values, (7,)
        )

        changed_future = dict(sku_rows)
        for offset in range(7):
            day = period_start + timedelta(days=offset)
            row = changed_future[day]
            changed_future[day] = SalesRow(
                date=row.date,
                synthetic_product_id=row.synthetic_product_id,
                category_id=row.category_id,
                quantity_sold=row.quantity_sold + 1000,
                price=row.price,
                discount_percent=row.discount_percent,
                selling_price=row.selling_price,
                source=row.source,
            )
        changed_runs, _ = _evaluate_period(
            changed_future, "SYN-X1", "test", period_start, period_end, training_values, (7,)
        )

        self.assertEqual(baseline_runs[0]["origin_date"], "2025-01-31")
        self.assertEqual(baseline_runs[0]["forecast"], changed_runs[0]["forecast"])
        self.assertNotEqual(baseline_runs[0]["actual"], changed_runs[0]["actual"])

    def test_recursive_seasonal_naive_rolls_forward_past_predictions(self) -> None:
        forecast = recursive_forecast(list(range(1, 8)), 14, lambda past: seasonal_naive(past, 7))
        self.assertEqual(forecast, [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0] * 2)

    def test_rejects_invalid_horizon(self) -> None:
        with self.assertRaises(ValueError):
            recursive_forecast([1.0] * 7, 0, lambda past: past[-1])


if __name__ == "__main__":
    unittest.main()
