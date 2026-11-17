"""Read and strictly validate the synthetic daily sales JSON fixture."""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path
from typing import Any


class DataValidationError(ValueError):
    """Raised when the sales fixture violates the offline data contract."""


@dataclass(frozen=True)
class SalesRow:
    date: date
    synthetic_product_id: str
    category_id: int
    quantity_sold: int
    price: float
    discount_percent: float
    selling_price: float
    source: str


@dataclass(frozen=True)
class SalesDataset:
    metadata: dict[str, Any]
    products: tuple[dict[str, Any], ...]
    rows: tuple[SalesRow, ...]
    seasonal_events: tuple[dict[str, Any], ...] = ()

    @property
    def product_ids(self) -> tuple[str, ...]:
        return tuple(product["synthetic_product_id"] for product in self.products)


def _parse_date(value: Any, field: str) -> date:
    if not isinstance(value, str):
        raise DataValidationError(f"{field} must be an ISO date string.")
    try:
        parsed = date.fromisoformat(value)
    except ValueError as error:
        raise DataValidationError(f"{field} must be a valid ISO date: {value!r}.") from error
    if parsed.isoformat() != value:
        raise DataValidationError(f"{field} must use YYYY-MM-DD format.")
    return parsed


def _finite_number(value: Any, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise DataValidationError(f"{field} must be a finite number.")
    try:
        normalized = float(value)
    except (OverflowError, ValueError) as error:
        raise DataValidationError(f"{field} must be a finite number.") from error
    if not math.isfinite(normalized):
        raise DataValidationError(f"{field} must be a finite number.")
    return normalized


def _positive_integer(value: Any, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise DataValidationError(f"{field} must be a positive integer.")
    return value


def validate_dataset(payload: Any) -> SalesDataset:
    if not isinstance(payload, dict):
        raise DataValidationError("Fixture root must be a JSON object.")
    metadata = payload.get("metadata")
    products = payload.get("products")
    sales = payload.get("sales")
    if not isinstance(metadata, dict) or metadata.get("source") != "SYNTHETIC":
        raise DataValidationError("Fixture metadata source must be SYNTHETIC.")
    if not isinstance(products, list) or not products:
        raise DataValidationError("Fixture products must be a non-empty array.")
    if not isinstance(sales, list) or not sales:
        raise DataValidationError("Fixture sales must be a non-empty array.")

    start = _parse_date(metadata.get("start_date"), "metadata.start_date")
    end = _parse_date(metadata.get("end_date"), "metadata.end_date")
    if end < start:
        raise DataValidationError("metadata.end_date must not precede metadata.start_date.")

    raw_events = payload.get("seasonal_events", [])
    if not isinstance(raw_events, list):
        raise DataValidationError("seasonal_events must be an array when provided.")
    seasonal_events: list[dict[str, Any]] = []
    seen_event_dates: set[tuple[str, date]] = set()
    for index, event in enumerate(raw_events):
        label = f"seasonal_events[{index}]"
        if not isinstance(event, dict):
            raise DataValidationError(f"{label} must be an object.")
        code = event.get("code")
        if not isinstance(code, str) or not code.strip():
            raise DataValidationError(f"{label}.code must be a non-empty string.")
        event_date = _parse_date(event.get("date"), f"{label}.date")
        before = event.get("influence_before_days")
        after = event.get("influence_after_days")
        if any(isinstance(value, bool) or not isinstance(value, int) or value < 0 for value in (before, after)):
            raise DataValidationError(f"{label} influence windows must be non-negative integers.")
        event_key = (code, event_date)
        if event_key in seen_event_dates:
            raise DataValidationError(f"Duplicate seasonal event: {code} on {event_date}.")
        seen_event_dates.add(event_key)
        seasonal_events.append({
            "code": code,
            "date": event_date,
            "influence_before_days": before,
            "influence_after_days": after,
        })

    product_ids: set[str] = set()
    product_categories: dict[str, int] = {}
    normalized_products: list[dict[str, Any]] = []
    for index, product in enumerate(products):
        if not isinstance(product, dict):
            raise DataValidationError(f"products[{index}] must be an object.")
        product_id = product.get("synthetic_product_id")
        if not isinstance(product_id, str) or not product_id:
            raise DataValidationError(f"products[{index}].synthetic_product_id must be a non-empty string.")
        if product_id in product_ids:
            raise DataValidationError(f"Duplicate product ID: {product_id}.")
        product_ids.add(product_id)
        product_categories[product_id] = _positive_integer(product.get("category_id"), f"products[{index}].category_id")
        normalized_products.append(product)

    rows: list[SalesRow] = []
    seen: set[tuple[date, str]] = set()
    dates_by_product: dict[str, set[date]] = {product_id: set() for product_id in product_ids}
    for index, raw in enumerate(sales):
        label = f"sales[{index}]"
        if not isinstance(raw, dict):
            raise DataValidationError(f"{label} must be an object.")
        if raw.get("source") != "SYNTHETIC":
            raise DataValidationError(f"{label}.source must be SYNTHETIC.")
        row_date = _parse_date(raw.get("date"), f"{label}.date")
        if row_date < start or row_date > end:
            raise DataValidationError(f"{label}.date is outside the metadata period.")
        product_id = raw.get("synthetic_product_id")
        if not isinstance(product_id, str) or product_id not in product_ids:
            raise DataValidationError(f"{label}.synthetic_product_id is not declared in products.")
        key = (row_date, product_id)
        if key in seen:
            raise DataValidationError(f"Duplicate date + product pair: {row_date} + {product_id}.")
        seen.add(key)

        category_id = _positive_integer(raw.get("category_id"), f"{label}.category_id")
        if category_id != product_categories[product_id]:
            raise DataValidationError(f"{label}.category_id does not match product metadata.")
        quantity = raw.get("quantity_sold")
        if isinstance(quantity, bool) or not isinstance(quantity, int) or quantity < 0:
            raise DataValidationError(f"{label}.quantity_sold must be a non-negative integer.")
        price = _finite_number(raw.get("price"), f"{label}.price")
        discount = _finite_number(raw.get("discount_percent"), f"{label}.discount_percent")
        selling_price = _finite_number(raw.get("selling_price"), f"{label}.selling_price")
        if price <= 0 or selling_price <= 0:
            raise DataValidationError(f"{label} prices must be positive.")
        if discount < 0 or discount >= 100:
            raise DataValidationError(f"{label}.discount_percent must be in [0, 100).")
        expected_selling_price = round(price * (1 - discount / 100), 2)
        if not math.isclose(selling_price, expected_selling_price, rel_tol=0, abs_tol=0.011):
            raise DataValidationError(f"{label}.selling_price is inconsistent with price and discount_percent.")
        for field in ("active_event_codes", "active_event_names", "applied_event_codes"):
            values = raw.get(field)
            if not isinstance(values, list) or any(not isinstance(value, str) for value in values):
                raise DataValidationError(f"{label}.{field} must be an array of strings.")
        rows.append(SalesRow(row_date, product_id, category_id, quantity, price, discount, selling_price, "SYNTHETIC"))
        dates_by_product[product_id].add(row_date)

    record_count = metadata.get("records")
    if isinstance(record_count, bool) or not isinstance(record_count, int) or record_count != len(rows):
        raise DataValidationError("metadata.records does not match the sales row count.")
    expected_dates: set[date] = set()
    current = start
    while current <= end:
        expected_dates.add(current)
        current += timedelta(days=1)
    for product_id, dates in dates_by_product.items():
        if dates != expected_dates:
            missing = len(expected_dates - dates)
            extra = len(dates - expected_dates)
            raise DataValidationError(f"Product {product_id} has incomplete daily coverage (missing={missing}, extra={extra}).")

    rows.sort(key=lambda row: (row.date, row.synthetic_product_id))
    return SalesDataset(
        metadata=dict(metadata),
        products=tuple(normalized_products),
        rows=tuple(rows),
        seasonal_events=tuple(seasonal_events),
    )


def load_dataset(path: str | Path) -> SalesDataset:
    fixture_path = Path(path)
    try:
        with fixture_path.open("r", encoding="utf-8") as fixture_file:
            payload = json.load(fixture_file)
    except (OSError, json.JSONDecodeError) as error:
        raise DataValidationError(f"Unable to read JSON fixture at {fixture_path}: {error}") from error
    return validate_dataset(payload)
