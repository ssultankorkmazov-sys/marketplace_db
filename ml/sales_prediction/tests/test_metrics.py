from __future__ import annotations

import math
import unittest

from marketkz_sales_prediction.metrics import calculate_metrics, mae, mase, mase_scale, rmsle, wape


class ForecastMetricTests(unittest.TestCase):
    def test_calculates_mae_wape_rmsle_and_mase(self) -> None:
        actual = [0, 2, 4]
        predicted = [1, 2, 3]
        scale = 2.0
        result = calculate_metrics(actual, predicted, scale)
        self.assertAlmostEqual(result["MAE"], 2 / 3)
        # WAPE = sum(abs(actual - predicted)) / sum(actual) = 2 / 6.
        self.assertAlmostEqual(result["WAPE"], 1 / 3)
        self.assertAlmostEqual(result["RMSLE"], math.sqrt((math.log1p(1) ** 2 + (math.log1p(3) - math.log1p(4)) ** 2) / 3))
        self.assertAlmostEqual(result["MASE"], 1 / 3)

    def test_zero_actual_total_makes_wape_undefined_not_zero(self) -> None:
        self.assertIsNone(wape([0, 0], [0, 2]))

    def test_zero_training_scale_makes_mase_undefined_not_zero(self) -> None:
        self.assertIsNone(mase_scale([5] * 20, period=7))
        self.assertIsNone(mase([0, 0], [0, 0], scale=0))
        self.assertIsNone(mase([0, 0], [0, 0], scale=None))

    def test_all_zero_actual_and_prediction_is_valid_but_relative_metrics_are_undefined(self) -> None:
        result = calculate_metrics([0, 0], [0, 0], scale=None)
        self.assertEqual(result["MAE"], 0)
        self.assertEqual(result["RMSLE"], 0)
        self.assertIsNone(result["WAPE"])
        self.assertIsNone(result["MASE"])

    def test_rejects_negative_or_non_finite_values(self) -> None:
        with self.assertRaises(ValueError):
            mae([1, -1], [1, 1])
        with self.assertRaises(ValueError):
            rmsle([1, 2], [1, float("inf")])


if __name__ == "__main__":
    unittest.main()
