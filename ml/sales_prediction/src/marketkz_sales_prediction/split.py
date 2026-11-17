"""Fixed chronological train, validation and test intervals."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from .data import SalesDataset, SalesRow

TRAIN_START = date(2025, 1, 1)
TRAIN_END = date(2025, 12, 31)
VALIDATION_START = date(2026, 1, 1)
VALIDATION_END = date(2026, 6, 30)
TEST_START = date(2026, 7, 1)
TEST_END = date(2026, 12, 31)


@dataclass(frozen=True)
class ChronologicalSplit:
    train: tuple[SalesRow, ...]
    validation: tuple[SalesRow, ...]
    test: tuple[SalesRow, ...]


def split_dataset(dataset: SalesDataset) -> ChronologicalSplit:
    train = tuple(row for row in dataset.rows if TRAIN_START <= row.date <= TRAIN_END)
    validation = tuple(row for row in dataset.rows if VALIDATION_START <= row.date <= VALIDATION_END)
    test = tuple(row for row in dataset.rows if TEST_START <= row.date <= TEST_END)
    if not train or not validation or not test:
        raise ValueError("Dataset must contain rows in all fixed train, validation and test intervals.")
    if max(row.date for row in train) >= min(row.date for row in validation):
        raise ValueError("Train and validation intervals overlap or are out of order.")
    if max(row.date for row in validation) >= min(row.date for row in test):
        raise ValueError("Validation and test intervals overlap or are out of order.")
    return ChronologicalSplit(train, validation, test)
