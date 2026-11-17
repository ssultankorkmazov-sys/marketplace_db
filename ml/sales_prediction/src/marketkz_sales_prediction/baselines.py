"""Past-only forecasting baselines with recursive multi-step support."""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence


Predictor = Callable[[Sequence[float]], float]


def moving_average(history: Sequence[float], window: int) -> float:
    if isinstance(window, bool) or not isinstance(window, int) or window < 1:
        raise ValueError("window must be a positive integer.")
    if len(history) < window:
        raise ValueError(f"Moving Average requires at least {window} past observations.")
    values = history[-window:]
    if any(not math.isfinite(value) or value < 0 for value in values):
        raise ValueError("History values must be finite and non-negative.")
    return sum(values) / window


def seasonal_naive(history: Sequence[float], period: int = 7) -> float:
    """Forecast the next point from the observation one full period earlier."""
    if isinstance(period, bool) or not isinstance(period, int) or period < 1:
        raise ValueError("period must be a positive integer.")
    if len(history) < period:
        raise ValueError(f"Seasonal Naive requires at least {period} past observations.")
    # The next forecast is one index beyond history; history[-period] is exactly
    # `period` steps before that target. Appending each prediction then cycles
    # through the last observed seasonal pattern during recursive forecasting.
    value = history[-period]
    if not math.isfinite(value) or value < 0:
        raise ValueError("History values must be finite and non-negative.")
    return float(value)


def recursive_forecast(history: Sequence[float], horizon: int, predictor: Predictor) -> list[float]:
    if isinstance(horizon, bool) or not isinstance(horizon, int) or horizon < 1:
        raise ValueError("horizon must be a positive integer.")
    working_history = list(history)
    if any(not math.isfinite(value) or value < 0 for value in working_history):
        raise ValueError("History values must be finite and non-negative.")
    predictions: list[float] = []
    for _ in range(horizon):
        prediction = float(predictor(working_history))
        if not math.isfinite(prediction) or prediction < 0:
            raise ValueError("Predictor must return a finite, non-negative value.")
        predictions.append(prediction)
        working_history.append(prediction)
    return predictions


def model_predictor(model_name: str) -> Predictor:
    if model_name == "moving_average_7":
        return lambda history: moving_average(history, 7)
    if model_name == "moving_average_28":
        return lambda history: moving_average(history, 28)
    if model_name == "seasonal_naive_7":
        return lambda history: seasonal_naive(history, 7)
    raise ValueError(f"Unknown baseline model: {model_name}.")


MODEL_NAMES = ("moving_average_7", "moving_average_28", "seasonal_naive_7")
