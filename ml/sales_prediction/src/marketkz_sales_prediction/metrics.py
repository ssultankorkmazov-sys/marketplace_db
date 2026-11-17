"""Forecast metrics with explicit undefined-value handling."""

from __future__ import annotations

import math
from collections.abc import Sequence


def _validate_pairs(actual: Sequence[float], predicted: Sequence[float]) -> None:
    if len(actual) != len(predicted) or not actual:
        raise ValueError("actual and predicted must have the same non-zero length.")
    for values in (actual, predicted):
        if any(
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(value)
            or value < 0
            for value in values
        ):
            raise ValueError("Metric inputs must be finite and non-negative.")


def mae(actual: Sequence[float], predicted: Sequence[float]) -> float:
    _validate_pairs(actual, predicted)
    return sum(abs(a - p) for a, p in zip(actual, predicted)) / len(actual)


def wape(actual: Sequence[float], predicted: Sequence[float]) -> float | None:
    _validate_pairs(actual, predicted)
    denominator = sum(actual)
    if denominator == 0:
        return None
    return sum(abs(a - p) for a, p in zip(actual, predicted)) / denominator


def rmsle(actual: Sequence[float], predicted: Sequence[float]) -> float:
    _validate_pairs(actual, predicted)
    squared = [(math.log1p(p) - math.log1p(a)) ** 2 for a, p in zip(actual, predicted)]
    return math.sqrt(sum(squared) / len(squared))


def mase_scale(training_values: Sequence[float], period: int = 7) -> float | None:
    if isinstance(period, bool) or not isinstance(period, int) or period < 1:
        raise ValueError("period must be a positive integer.")
    if len(training_values) <= period:
        return None
    if any(
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
        or value < 0
        for value in training_values
    ):
        raise ValueError("Training values must be finite and non-negative.")
    scale = sum(abs(training_values[index] - training_values[index - period]) for index in range(period, len(training_values))) / (len(training_values) - period)
    return scale if scale > 0 else None


def mase(actual: Sequence[float], predicted: Sequence[float], scale: float | None) -> float | None:
    _validate_pairs(actual, predicted)
    if scale is None or not math.isfinite(scale) or scale <= 0:
        return None
    return mae(actual, predicted) / scale


def calculate_metrics(
    actual: Sequence[float], predicted: Sequence[float], scale: float | None
) -> dict[str, float | None]:
    return {
        "MAE": mae(actual, predicted),
        "WAPE": wape(actual, predicted),
        "RMSLE": rmsle(actual, predicted),
        "MASE": mase(actual, predicted, scale),
    }
