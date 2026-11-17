"""Leakage-safe calendar, product and trailing-sales feature construction."""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Mapping, Sequence


@dataclass(frozen=True)
class FeatureSpec:
    product_ids: tuple[str, ...]
    category_ids: tuple[int, ...]
    event_codes: tuple[str, ...]

    @classmethod
    def create(cls, products: Sequence[dict], events: Sequence[dict]) -> "FeatureSpec":
        return cls(
            product_ids=tuple(sorted(product["synthetic_product_id"] for product in products)),
            category_ids=tuple(sorted({int(product["category_id"]) for product in products})),
            event_codes=tuple(sorted({event["code"] for event in events})),
        )

    @property
    def names(self) -> tuple[str, ...]:
        names = [f"sku__{product_id}" for product_id in self.product_ids]
        names.extend(f"category__{category_id}" for category_id in self.category_ids)
        names.extend((
            "day_of_week", "month", "day_of_year", "month_sin", "month_cos",
            "day_of_year_sin", "day_of_year_cos",
        ))
        names.extend(f"event_active__{code}" for code in self.event_codes)
        names.extend(("days_until_next_event", "days_since_previous_event"))
        names.extend((
            "season__winter", "season__spring", "season__summer", "season__autumn",
            "season__back_to_school",
        ))
        names.extend(("lag_1", "lag_7", "lag_14", "lag_28", "rolling_mean_7", "rolling_mean_28"))
        return tuple(names)


def build_feature_vector(
    target_date: date,
    product_id: str,
    category_id: int,
    history: Mapping[date, float],
    spec: FeatureSpec,
    seasonal_events: Sequence[dict],
) -> list[float]:
    """Build features for target_date using only observations strictly before it."""
    if product_id not in spec.product_ids:
        raise ValueError(f"Unknown synthetic product: {product_id}.")
    if category_id not in spec.category_ids:
        raise ValueError(f"Unknown category: {category_id}.")

    required_history = [target_date - timedelta(days=lag) for lag in range(1, 29)]
    missing = [day.isoformat() for day in required_history if day not in history]
    if missing:
        raise ValueError(f"At least 28 consecutive past observations are required; missing {missing[0]}.")
    past_values = [float(history[day]) for day in required_history]
    if any(not math.isfinite(value) or value < 0 for value in past_values):
        raise ValueError("Historical sales values must be finite and non-negative.")
    # required_history is newest-to-oldest, so indexes 0, 6, 13 and 27 are lags 1, 7, 14, 28.
    day_of_year = target_date.timetuple().tm_yday
    days_in_year = 366 if _is_leap_year(target_date.year) else 365
    values = [
        float(product_id == value) for value in spec.product_ids
    ] + [
        float(category_id == value) for value in spec.category_ids
    ] + [
        float(target_date.weekday()),
        float(target_date.month),
        float(day_of_year),
        math.sin(2 * math.pi * target_date.month / 12),
        math.cos(2 * math.pi * target_date.month / 12),
        math.sin(2 * math.pi * day_of_year / days_in_year),
        math.cos(2 * math.pi * day_of_year / days_in_year),
    ]

    active_by_code: dict[str, bool] = {code: False for code in spec.event_codes}
    event_dates: list[date] = []
    for event in seasonal_events:
        event_date = event["date"]
        before = int(event["influence_before_days"])
        after = int(event["influence_after_days"])
        offset = (target_date - event_date).days
        if -before <= offset <= after:
            active_by_code[event["code"]] = True
        event_dates.append(event_date)
    values.extend(float(active_by_code[code]) for code in spec.event_codes)
    prior_events = [event_day for event_day in event_dates if event_day <= target_date]
    upcoming_events = [event_day for event_day in event_dates if event_day > target_date]
    values.extend((
        float(min((event_day - target_date).days for event_day in upcoming_events)) if upcoming_events else 366.0,
        float(min((target_date - event_day).days for event_day in prior_events)) if prior_events else 366.0,
    ))

    month = target_date.month
    values.extend((
        float(month in (12, 1, 2)),
        float(month in (3, 4, 5)),
        float(month in (6, 7, 8)),
        float(month in (9, 10, 11)),
        float(month in (8, 9)),
    ))
    values.extend((past_values[0], past_values[6], past_values[13], past_values[27]))
    values.extend((sum(past_values[:7]) / 7, sum(past_values[:28]) / 28))
    if len(values) != len(spec.names):
        raise AssertionError("Feature vector and feature-name schema are out of sync.")
    return values


def _is_leap_year(year: int) -> bool:
    return year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)
