from __future__ import annotations

import unittest
from datetime import date, timedelta

from marketkz_sales_prediction.features import FeatureSpec, build_feature_vector


class FeatureEngineeringTests(unittest.TestCase):
    def setUp(self) -> None:
        self.spec = FeatureSpec.create(
            [{"synthetic_product_id": "SYN-A", "category_id": 3}],
            [{"code": "NAURYZ", "date": date(2025, 3, 22), "influence_before_days": 10, "influence_after_days": 3}],
        )
        self.target = date(2025, 3, 21)
        self.history = {
            self.target - timedelta(days=lag): float(lag)
            for lag in range(1, 29)
        }
        self.events = [{
            "code": "NAURYZ", "date": date(2025, 3, 22),
            "influence_before_days": 10, "influence_after_days": 3,
        }]

    def test_features_cover_product_calendar_holiday_and_trailing_history(self) -> None:
        names = self.spec.names
        values = build_feature_vector(self.target, "SYN-A", 3, self.history, self.spec, self.events)
        by_name = dict(zip(names, values))
        self.assertEqual(len(values), len(names))
        self.assertEqual(by_name["sku__SYN-A"], 1.0)
        self.assertEqual(by_name["category__3"], 1.0)
        self.assertEqual(by_name["event_active__NAURYZ"], 1.0)
        self.assertEqual(by_name["days_until_next_event"], 1.0)
        self.assertEqual(by_name["lag_1"], 1.0)
        self.assertEqual(by_name["lag_7"], 7.0)
        self.assertEqual(by_name["lag_14"], 14.0)
        self.assertEqual(by_name["lag_28"], 28.0)
        self.assertEqual(by_name["rolling_mean_7"], 4.0)
        self.assertEqual(by_name["rolling_mean_28"], 14.5)

    def test_future_history_values_cannot_change_features(self) -> None:
        first = dict(self.history)
        second = dict(self.history)
        future_day = self.target + timedelta(days=1)
        first[future_day] = 0.0
        second[future_day] = 1_000_000.0
        self.assertEqual(
            build_feature_vector(self.target, "SYN-A", 3, first, self.spec, self.events),
            build_feature_vector(self.target, "SYN-A", 3, second, self.spec, self.events),
        )

    def test_requires_all_28_prior_days_and_rejects_unknown_sku(self) -> None:
        with self.assertRaisesRegex(ValueError, "28 consecutive"):
            build_feature_vector(self.target, "SYN-A", 3, {}, self.spec, self.events)
        with self.assertRaisesRegex(ValueError, "Unknown synthetic product"):
            build_feature_vector(self.target, "SYN-UNKNOWN", 3, self.history, self.spec, self.events)


if __name__ == "__main__":
    unittest.main()
