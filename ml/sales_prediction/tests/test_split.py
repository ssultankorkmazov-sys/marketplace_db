from __future__ import annotations

import unittest
from pathlib import Path

from marketkz_sales_prediction.data import load_dataset
from marketkz_sales_prediction.split import (
    TEST_END, TEST_START, TRAIN_END, TRAIN_START, VALIDATION_END,
    VALIDATION_START, split_dataset,
)

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]


class ChronologicalSplitTests(unittest.TestCase):
    def test_uses_fixed_non_overlapping_train_validation_and_test_intervals(self) -> None:
        dataset = load_dataset(REPOSITORY_ROOT / "fixtures" / "synthetic-sales-2025-2026.json")
        split = split_dataset(dataset)
        self.assertEqual(min(row.date for row in split.train), TRAIN_START)
        self.assertEqual(max(row.date for row in split.train), TRAIN_END)
        self.assertEqual(min(row.date for row in split.validation), VALIDATION_START)
        self.assertEqual(max(row.date for row in split.validation), VALIDATION_END)
        self.assertEqual(min(row.date for row in split.test), TEST_START)
        self.assertEqual(max(row.date for row in split.test), TEST_END)
        self.assertLess(max(row.date for row in split.train), min(row.date for row in split.validation))
        self.assertLess(max(row.date for row in split.validation), min(row.date for row in split.test))

    def test_split_is_deterministic_and_does_not_shuffle(self) -> None:
        dataset = load_dataset(REPOSITORY_ROOT / "fixtures" / "synthetic-sales-2025-2026.json")
        first = split_dataset(dataset)
        second = split_dataset(dataset)
        self.assertEqual(first, second)
        self.assertEqual([row.date for row in first.train], sorted(row.date for row in first.train))


if __name__ == "__main__":
    unittest.main()
