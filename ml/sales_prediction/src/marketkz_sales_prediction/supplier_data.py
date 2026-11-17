"""Load and validate synthetic-only suppliers, offers, inventory, and inbound."""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any, Sequence

from .replenishment import InboundShipment, SOURCE, SupplierOffer


class SupplierFixtureError(ValueError):
    """Raised when a synthetic supplier fixture violates its data contract."""


@dataclass(frozen=True)
class SupplierCatalog:
    suppliers: tuple[dict[str, str], ...]
    offers: tuple[SupplierOffer, ...]
    inbound_shipments: tuple[InboundShipment, ...]
    as_of_date: date
    current_stock: dict[str, int]


def _parse_date(value: Any, label: str) -> date:
    if not isinstance(value, str):
        raise SupplierFixtureError(f"{label} must be an ISO date string.")
    try:
        parsed = date.fromisoformat(value)
    except ValueError as error:
        raise SupplierFixtureError(f"{label} must be a valid ISO date.") from error
    if parsed.isoformat() != value:
        raise SupplierFixtureError(f"{label} must use YYYY-MM-DD format.")
    return parsed


def _integer(value: Any, label: str, minimum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise SupplierFixtureError(f"{label} must be an integer >= {minimum}.")
    return value


def _source(row: Any, label: str) -> None:
    if not isinstance(row, dict) or row.get("source") != SOURCE:
        raise SupplierFixtureError(f"{label}.source must be SYNTHETIC.")


def validate_supplier_fixture(payload: Any, product_ids: Sequence[str]) -> SupplierCatalog:
    if not isinstance(payload, dict):
        raise SupplierFixtureError("Fixture root must be a JSON object.")
    metadata = payload.get("metadata")
    if not isinstance(metadata, dict) or metadata.get("source") != SOURCE:
        raise SupplierFixtureError("Fixture metadata source must be SYNTHETIC.")
    _integer(metadata.get("seed"), "metadata.seed", 0)
    as_of_date = _parse_date(metadata.get("as_of_date"), "metadata.as_of_date")

    raw_suppliers = payload.get("suppliers")
    raw_offers = payload.get("supplier_products")
    raw_shipments = payload.get("inbound_shipments")
    inventory = payload.get("demo_inventory")
    if not isinstance(raw_suppliers, list) or not raw_suppliers:
        raise SupplierFixtureError("suppliers must be a non-empty array.")
    if not isinstance(raw_offers, list) or not raw_offers:
        raise SupplierFixtureError("supplier_products must be a non-empty array.")
    if not isinstance(raw_shipments, list):
        raise SupplierFixtureError("inbound_shipments must be an array.")
    if not isinstance(inventory, dict) or inventory.get("source") != SOURCE:
        raise SupplierFixtureError("demo_inventory source must be SYNTHETIC.")
    if _parse_date(inventory.get("as_of_date"), "demo_inventory.as_of_date") != as_of_date:
        raise SupplierFixtureError("demo_inventory.as_of_date must match metadata.as_of_date.")
    inventory_rows = inventory.get("items")
    if not isinstance(inventory_rows, list):
        raise SupplierFixtureError("demo_inventory.items must be an array.")

    supplier_map: dict[str, str] = {}
    normalized_suppliers: list[dict[str, str]] = []
    for index, supplier in enumerate(raw_suppliers):
        label = f"suppliers[{index}]"
        _source(supplier, label)
        supplier_id, name = supplier.get("supplier_id"), supplier.get("name")
        if not isinstance(supplier_id, str) or not supplier_id.startswith("SYN-SUP-"):
            raise SupplierFixtureError(f"{label}.supplier_id must be a synthetic supplier ID.")
        if not isinstance(name, str) or not name.strip():
            raise SupplierFixtureError(f"{label}.name must be non-empty.")
        if supplier_id in supplier_map:
            raise SupplierFixtureError(f"Duplicate supplier_id: {supplier_id}.")
        supplier_map[supplier_id] = name
        normalized_suppliers.append({"supplier_id": supplier_id, "name": name, "source": SOURCE})

    allowed_products = set(product_ids)
    if not allowed_products or any(not item.startswith("SYN-") for item in allowed_products):
        raise SupplierFixtureError("Only declared synthetic sales product IDs are accepted.")

    offers: list[SupplierOffer] = []
    product_offers: dict[str, set[str]] = {product_id: set() for product_id in allowed_products}
    offer_keys: set[tuple[str, str]] = set()
    for index, row in enumerate(raw_offers):
        label = f"supplier_products[{index}]"
        _source(row, label)
        supplier_id = row.get("supplier_id")
        product_id = row.get("synthetic_product_id")
        if not isinstance(supplier_id, str) or supplier_id not in supplier_map:
            raise SupplierFixtureError(f"{label}.supplier_id is not declared in suppliers.")
        if not isinstance(product_id, str) or product_id not in allowed_products:
            raise SupplierFixtureError(f"{label}.synthetic_product_id is not in the sales fixture.")
        key = (supplier_id, product_id)
        if key in offer_keys:
            raise SupplierFixtureError(f"Duplicate supplier offer: {supplier_id} + {product_id}.")
        offer_keys.add(key)
        product_offers[product_id].add(supplier_id)
        currency = row.get("currency")
        if not isinstance(currency, str) or len(currency) != 3 or not currency.isalpha():
            raise SupplierFixtureError(f"{label}.currency must be a three-letter code.")
        price = row.get("purchase_price")
        if isinstance(price, bool) or not isinstance(price, (int, float)) or not math.isfinite(float(price)) or price <= 0:
            raise SupplierFixtureError(f"{label}.purchase_price must be a finite positive number.")
        offers.append(SupplierOffer(
            supplier_id=supplier_id,
            supplier_name=supplier_map[supplier_id],
            lead_time_days=_integer(row.get("lead_time_days"), f"{label}.lead_time_days", 1),
            minimum_order_quantity=_integer(row.get("minimum_order_quantity"), f"{label}.minimum_order_quantity", 1),
            pack_size=_integer(row.get("pack_size"), f"{label}.pack_size", 1),
            purchase_price=float(price),
            currency=currency.upper(),
            source=SOURCE,
            synthetic_product_id=product_id,
        ))
    missing_offers = sorted(product_id for product_id, values in product_offers.items() if not values)
    if missing_offers:
        raise SupplierFixtureError(f"Products are missing supplier offers: {', '.join(missing_offers)}.")

    shipments: list[InboundShipment] = []
    shipment_ids: set[str] = set()
    for index, row in enumerate(raw_shipments):
        label = f"inbound_shipments[{index}]"
        _source(row, label)
        shipment_id = row.get("shipment_id")
        supplier_id = row.get("supplier_id")
        product_id = row.get("synthetic_product_id")
        if not isinstance(shipment_id, str) or not shipment_id.startswith("SYN-SHIP-"):
            raise SupplierFixtureError(f"{label}.shipment_id must be a synthetic shipment ID.")
        if shipment_id in shipment_ids:
            raise SupplierFixtureError(f"Duplicate shipment_id: {shipment_id}.")
        shipment_ids.add(shipment_id)
        if (
            not isinstance(supplier_id, str)
            or supplier_id not in supplier_map
            or not isinstance(product_id, str)
            or product_id not in allowed_products
        ):
            raise SupplierFixtureError(f"{label} must reference a declared supplier and synthetic product.")
        status = row.get("status")
        if not isinstance(status, str) or status not in {"CONFIRMED", "IN_TRANSIT", "CANCELLED", "RECEIVED"}:
            raise SupplierFixtureError(f"{label}.status is unsupported.")
        shipments.append(InboundShipment(
            shipment_id=shipment_id,
            synthetic_product_id=product_id,
            supplier_id=supplier_id,
            quantity=_integer(row.get("quantity"), f"{label}.quantity", 1),
            expected_arrival_date=_parse_date(row.get("expected_arrival_date"), f"{label}.expected_arrival_date"),
            status=status,
            source=SOURCE,
        ))

    stocks: dict[str, int] = {}
    for index, row in enumerate(inventory_rows):
        label = f"demo_inventory.items[{index}]"
        _source(row, label)
        product_id = row.get("synthetic_product_id")
        if not isinstance(product_id, str) or product_id not in allowed_products or product_id in stocks:
            raise SupplierFixtureError(f"{label}.synthetic_product_id is unknown or duplicated.")
        stocks[product_id] = _integer(row.get("current_stock"), f"{label}.current_stock", 0)
    if set(stocks) != allowed_products:
        raise SupplierFixtureError("Demo inventory must contain exactly one row for every synthetic sales product.")

    return SupplierCatalog(tuple(normalized_suppliers), tuple(offers), tuple(shipments), as_of_date, stocks)


def load_supplier_fixture(path: str | Path, product_ids: Sequence[str]) -> SupplierCatalog:
    fixture_path = Path(path)
    try:
        with fixture_path.open("r", encoding="utf-8") as fixture_file:
            payload = json.load(fixture_file)
    except (OSError, json.JSONDecodeError) as error:
        raise SupplierFixtureError(f"Unable to read supplier fixture at {fixture_path}: {error}") from error
    return validate_supplier_fixture(payload, product_ids)
