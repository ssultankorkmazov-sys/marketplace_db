from __future__ import annotations

import unittest
from copy import deepcopy
from datetime import date, timedelta

from marketkz_sales_prediction.replenishment import (
    ForecastDay,
    InboundShipment,
    SupplierOffer,
    calculate_replenishment_recommendation,
    compare_supplier_offers,
)


AS_OF = date(2026, 6, 30)


def offer(**overrides) -> SupplierOffer:
    values = {
        "supplier_id": "SYN-SUP-001",
        "supplier_name": "Synthetic Supplier",
        "lead_time_days": 2,
        "minimum_order_quantity": 5,
        "pack_size": 4,
        "purchase_price": 10.25,
        "currency": "KZT",
        "synthetic_product_id": "SYN-P001",
    }
    values.update(overrides)
    return SupplierOffer(**values)


def forecast(days: int, demand: float = 10) -> list[ForecastDay]:
    return [ForecastDay(AS_OF + timedelta(days=offset), demand) for offset in range(1, days + 1)]


def shipment(
    shipment_id: str = "SYN-SHIP-001",
    *,
    quantity: int = 10,
    arrival: date = AS_OF + timedelta(days=2),
    status: str = "IN_TRANSIT",
    product_id: str = "SYN-P001",
) -> InboundShipment:
    return InboundShipment(shipment_id, product_id, "SYN-SUP-002", quantity, arrival, status)


def recommend(**overrides):
    values = {
        "synthetic_product_id": "SYN-P001",
        "as_of_date": AS_OF,
        "current_stock": 0,
        "forecast": forecast(3),
        "safety_stock": 0,
        "review_period_days": 1,
        "offer": offer(),
        "inbound_shipments": (),
    }
    values.update(overrides)
    return calculate_replenishment_recommendation(**values)


class ReplenishmentTests(unittest.TestCase):
    def test_no_purchase_needed_when_stock_covers_forecast_and_safety(self):
        result = recommend(current_stock=40, safety_stock=5)
        self.assertEqual(result.recommendation_status, "NO_PURCHASE_NEEDED")
        self.assertEqual(result.recommended_quantity, 0)
        self.assertEqual(result.estimated_cost, 0.0)

    def test_deficit_is_rounded_up_to_full_pack(self):
        result = recommend(current_stock=2, safety_stock=2)
        self.assertEqual(result.forecast_demand, 30)
        self.assertEqual(result.recommended_quantity, 32)
        self.assertEqual(result.estimated_cost, 328.0)

    def test_minimum_order_quantity_is_applied(self):
        result = recommend(
            forecast=forecast(3, demand=1),
            offer=offer(minimum_order_quantity=8, pack_size=3),
        )
        self.assertEqual(result.recommended_quantity, 8)

    def test_inbound_shipment_reduces_need_once(self):
        result = recommend(current_stock=2, safety_stock=2, inbound_shipments=[shipment(quantity=10)])
        self.assertEqual(result.inbound_quantity, 10)
        self.assertEqual(result.recommended_quantity, 20)

    def test_cancelled_shipment_is_excluded(self):
        result = recommend(inbound_shipments=[shipment(quantity=100, status="CANCELLED")])
        self.assertEqual(result.inbound_quantity, 0)
        self.assertEqual(result.recommended_quantity, 32)

    def test_shipment_after_coverage_window_is_excluded(self):
        result = recommend(inbound_shipments=[shipment(quantity=100, arrival=AS_OF + timedelta(days=4))])
        self.assertEqual(result.inbound_quantity, 0)
        self.assertEqual(result.recommended_quantity, 32)

    def test_shipment_arriving_on_coverage_boundary_is_included(self):
        result = recommend(inbound_shipments=[shipment(quantity=4, arrival=AS_OF + timedelta(days=3))])
        self.assertEqual(result.inbound_quantity, 4)
        self.assertEqual(result.recommended_quantity, 28)

    def test_multiple_supplier_options_are_comparable_alternatives(self):
        fast = recommend(offer=offer(supplier_id="SYN-SUP-002", lead_time_days=2, purchase_price=12))
        cheap = recommend(offer=offer(supplier_id="SYN-SUP-003", lead_time_days=2, purchase_price=9))
        ordered = compare_supplier_offers([fast, cheap])
        self.assertEqual([item.supplier_id for item in ordered], ["SYN-SUP-003", "SYN-SUP-002"])
        self.assertEqual([item.recommended_quantity for item in ordered], [32, 32])

    def test_insufficient_forecast_is_explicit_and_does_not_guess_quantity(self):
        result = recommend(forecast=forecast(2))
        self.assertEqual(result.recommendation_status, "INSUFFICIENT_FORECAST")
        self.assertIsNone(result.forecast_demand)
        self.assertIsNone(result.recommended_quantity)
        self.assertIsNone(result.estimated_cost)

    def test_zero_forecast_demand_needs_no_purchase(self):
        result = recommend(forecast=forecast(3, demand=0))
        self.assertEqual(result.forecast_demand, 0)
        self.assertEqual(result.recommendation_status, "NO_PURCHASE_NEEDED")
        self.assertEqual(result.recommended_quantity, 0)

    def test_identical_inputs_are_reproducible_and_stock_is_unchanged(self):
        inventory = {"SYN-P001": 2}
        before = deepcopy(inventory)
        kwargs = {"current_stock": inventory["SYN-P001"], "inbound_shipments": [shipment()]}
        first = recommend(**kwargs).as_dict()
        second = recommend(**kwargs).as_dict()
        self.assertEqual(first, second)
        self.assertEqual(inventory, before)

    def test_duplicate_shipment_is_rejected_to_prevent_double_counting(self):
        duplicate = shipment()
        with self.assertRaisesRegex(ValueError, "Duplicate shipment_id"):
            recommend(inbound_shipments=[duplicate, duplicate])

    def test_non_synthetic_offer_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "source must be SYNTHETIC"):
            recommend(offer=offer(source="REAL"))


if __name__ == "__main__":
    unittest.main()
