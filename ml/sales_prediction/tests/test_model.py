from __future__ import annotations

import unittest

import numpy as np

from marketkz_sales_prediction.model import XGBoostConfig, fit_final_model, predict_count, tune_config


class XGBoostModelTests(unittest.TestCase):
    def setUp(self) -> None:
        self.features = [[float(index), float(index % 3)] for index in range(40)]
        self.targets = [float(index % 5) for index in range(40)]
        self.config = XGBoostConfig(max_depth=2, learning_rate=0.1, n_estimators=12, random_state=17)

    def test_model_trains_and_returns_non_negative_count_predictions(self) -> None:
        model = fit_final_model(self.features, self.targets, self.config)
        prediction = predict_count(model, self.features[0])
        self.assertTrue(np.isfinite(prediction))
        self.assertGreaterEqual(prediction, 0.0)

    def test_training_is_reproducible_with_fixed_seed(self) -> None:
        first = fit_final_model(self.features, self.targets, self.config)
        second = fit_final_model(self.features, self.targets, self.config)
        np.testing.assert_allclose(
            first.predict(np.asarray(self.features, dtype=np.float32)),
            second.predict(np.asarray(self.features, dtype=np.float32)),
            rtol=0,
            atol=1e-7,
        )

    def test_tuning_selects_only_from_validation_scores_and_records_early_stop(self) -> None:
        config, metrics, trials = tune_config(
            self.features[:25], self.targets[:25],
            self.features[25:], self.targets[25:],
            candidates=(self.config,), early_stopping_rounds=3,
        )
        self.assertGreaterEqual(config.n_estimators, 1)
        self.assertGreaterEqual(metrics["validation_mae"], 0.0)
        self.assertEqual(len(trials), 1)


if __name__ == "__main__":
    unittest.main()
