"""Pure, synthetic-only supplier replenishment calculations."""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Iterable, Sequence


SOURCE = "SYNTHETIC"
ELIGIBLE_INBOUND_STATUSES = frozenset({"CONFIRMED", "IN_TRANSIT"})


def _non_negative_integer(value: object, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError(f"{name} must be a non-negative integer.")
    return value


def _positive_integer(value: object, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise ValueError(f"{name} must be a positive integer.")
    return value


def _money(value: object, name: str) -> Decimal:
    if isinstance(value, bool):
        raise ValueError(f"{name} must be a finite positive amount.")
    try:
        amount = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError) as error:
        raise ValueError(f"{name} must be a finite positive amount.") from error
    if not amount.is_finite() or amount <= 0:
        raise ValueError(f"{name} must be a finite positive amount.")
    return amount


@dataclass(frozen=True)
class ForecastDay:
    day: date
    predicted_demand: float


@dataclass(frozen=True)
class SupplierOffer:
    supplier_id: str
    supplier_name: str
    lead_time_days: int
    minimum_order_quantity: int
    pack_size: int
    purchase_price: float
    currency: str
    source: str = SOURCE
    synthetic_product_id: str | None = None


@dataclass(frozen=True)
class InboundShipment:
    shipment_id: str
    synthetic_product_id: str
    supplier_id: str
    quantity: int
    expected_arrival_date: date
    status: str
    source: str = SOURCE


@dataclass(frozen=True)
class ReplenishmentRecommendation:
    synthetic_product_id: str
    supplier_id: str
    current_stock: int
    forecast_demand: float | None
    safety_stock: int
    inbound_quantity: int
    lead_time_days: int
    minimum_order_quantity: int
    pack_size: int
    purchase_price: float
    currency: str
    recommended_quantity: int | None
    estimated_cost: float | None
    recommendation_status: str
    source: str
    coverage_start_date: str
    coverage_end_date: str
    explanation: str

    def as_dict(self) -> dict[str, object]:
        return asdict(self)


def calculate_replenishment_recommendation(
    *,
    synthetic_product_id: str,
    as_of_date: date,
    current_stock: int,
    forecast: Sequence[ForecastDay],
    safety_stock: int,
    review_period_days: int,
    offer: SupplierOffer,
    inbound_shipments: Iterable[InboundShipment],
) -> ReplenishmentRecommendation:
    """Calculate one supplier alternative without mutating inputs or inventory.

    Forecast coverage runs from the day after ``as_of_date`` through
    ``lead_time_days + review_period_days`` (inclusive). Only confirmed or
    in-transit shipments for this product arriving inside that interval reduce
    the need. Every shipment ID may appear only once in an evaluation.
    """
    if not isinstance(synthetic_product_id, str) or not synthetic_product_id.startswith("SYN-"):
        raise ValueError("Only synthetic product IDs are accepted in this offline phase.")
    if not isinstance(as_of_date, date):
        raise ValueError("as_of_date must be a datetime.date.")
    current_stock = _non_negative_integer(current_stock, "current_stock")
    safety_stock = _non_negative_integer(safety_stock, "safety_stock")
    review_period_days = _non_negative_integer(review_period_days, "review_period_days")
    lead_time_days = _positive_integer(offer.lead_time_days, "lead_time_days")
    minimum_order_quantity = _positive_integer(offer.minimum_order_quantity, "minimum_order_quantity")
    pack_size = _positive_integer(offer.pack_size, "pack_size")
    purchase_price = _money(offer.purchase_price, "purchase_price")
    if offer.source != SOURCE:
        raise ValueError("Supplier offer source must be SYNTHETIC.")
    if offer.synthetic_product_id not in (None, synthetic_product_id):
        raise ValueError("Supplier offer belongs to a different synthetic product.")
    if (
        not isinstance(offer.supplier_id, str)
        or not offer.supplier_id.startswith("SYN-SUP-")
        or not isinstance(offer.supplier_name, str)
        or not offer.supplier_name.strip()
    ):
        raise ValueError("Supplier identity is required.")
    if not isinstance(offer.currency, str) or len(offer.currency) != 3 or not offer.currency.isalpha():
        raise ValueError("currency must be a three-letter code.")

    coverage_start = as_of_date + timedelta(days=1)
    coverage_days = lead_time_days + review_period_days
    coverage_end = as_of_date + timedelta(days=coverage_days)
    required_days = [coverage_start + timedelta(days=offset) for offset in range(coverage_days)]

    forecast_by_day: dict[date, float] = {}
    for point in forecast:
        if not isinstance(point, ForecastDay) or not isinstance(point.day, date):
            raise ValueError("forecast entries must be ForecastDay values with valid dates.")
        if isinstance(point.predicted_demand, bool):
            raise ValueError("predicted demand must be finite and non-negative.")
        try:
            demand = float(point.predicted_demand)
        except (TypeError, ValueError, OverflowError) as error:
            raise ValueError("predicted demand must be finite and non-negative.") from error
        if not math.isfinite(demand) or demand < 0:
            raise ValueError("predicted demand must be finite and non-negative.")
        if point.day in forecast_by_day:
            raise ValueError(f"Duplicate forecast date: {point.day.isoformat()}.")
        forecast_by_day[point.day] = demand

    missing_days = [day for day in required_days if day not in forecast_by_day]

    seen_shipment_ids: set[str] = set()
    inbound_quantity = 0
    for shipment in inbound_shipments:
        if not isinstance(shipment, InboundShipment):
            raise ValueError("inbound_shipments must contain InboundShipment values.")
        if shipment.source != SOURCE:
            raise ValueError("Inbound shipment source must be SYNTHETIC.")
        if not isinstance(shipment.shipment_id, str) or not shipment.shipment_id.startswith("SYN-SHIP-"):
            raise ValueError("shipment_id must be a synthetic shipment ID.")
        if shipment.shipment_id in seen_shipment_ids:
            raise ValueError(f"Duplicate shipment_id: {shipment.shipment_id}.")
        seen_shipment_ids.add(shipment.shipment_id)
        if (
            not isinstance(shipment.synthetic_product_id, str)
            or not shipment.synthetic_product_id.startswith("SYN-")
            or not isinstance(shipment.supplier_id, str)
            or not shipment.supplier_id.startswith("SYN-SUP-")
        ):
            raise ValueError("Inbound shipment must reference synthetic product and supplier IDs.")
        quantity = _positive_integer(shipment.quantity, "inbound quantity")
        if not isinstance(shipment.expected_arrival_date, date):
            raise ValueError("expected_arrival_date must be a datetime.date.")
        if shipment.status not in {"CONFIRMED", "IN_TRANSIT", "CANCELLED", "RECEIVED"}:
            raise ValueError(f"Unsupported shipment status: {shipment.status}.")
        if (
            shipment.synthetic_product_id == synthetic_product_id
            and shipment.status in ELIGIBLE_INBOUND_STATUSES
            and as_of_date < shipment.expected_arrival_date <= coverage_end
        ):
            inbound_quantity += quantity

    if missing_days:
        return ReplenishmentRecommendation(
            synthetic_product_id=synthetic_product_id,
            supplier_id=offer.supplier_id,
            current_stock=current_stock,
            forecast_demand=None,
            safety_stock=safety_stock,
            inbound_quantity=inbound_quantity,
            lead_time_days=lead_time_days,
            minimum_order_quantity=minimum_order_quantity,
            pack_size=pack_size,
            purchase_price=float(purchase_price),
            currency=offer.currency.upper(),
            recommended_quantity=None,
            estimated_cost=None,
            recommendation_status="INSUFFICIENT_FORECAST",
            source=SOURCE,
            coverage_start_date=coverage_start.isoformat(),
            coverage_end_date=coverage_end.isoformat(),
            explanation=(
                f"Недостаточно синтетического прогноза: отсутствует {len(missing_days)} "
                f"из {coverage_days} дней периода покрытия. Количество заказа не рассчитано."
            ),
        )

    demand_cover = sum(forecast_by_day[day] for day in required_days)
    available = current_stock + inbound_quantity
    raw_need = max(0.0, demand_cover + safety_stock - available)
    if raw_need == 0:
        order_quantity = 0
        estimated_cost = Decimal("0.00")
        status = "NO_PURCHASE_NEEDED"
        explanation = (
            f"Закупка не требуется: прогноз покрытия {demand_cover:g} + страховой запас "
            f"{safety_stock} не превышают текущий остаток {current_stock} и товары в пути "
            f"{inbound_quantity}."
        )
    else:
        rounded_need = math.ceil(raw_need)
        order_quantity = max(
            minimum_order_quantity,
            math.ceil(rounded_need / pack_size) * pack_size,
        )
        estimated_cost = (purchase_price * order_quantity).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        status = "PURCHASE_RECOMMENDED"
        explanation = (
            f"Покрытие спроса {demand_cover:g} + страховой запас {safety_stock} − остаток "
            f"{current_stock} − товары в пути {inbound_quantity} = потребность {raw_need:g}; "
            f"заказ округлён по упаковке {pack_size} и MOQ {minimum_order_quantity}."
        )

    return ReplenishmentRecommendation(
        synthetic_product_id=synthetic_product_id,
        supplier_id=offer.supplier_id,
        current_stock=current_stock,
        forecast_demand=demand_cover,
        safety_stock=safety_stock,
        inbound_quantity=inbound_quantity,
        lead_time_days=lead_time_days,
        minimum_order_quantity=minimum_order_quantity,
        pack_size=pack_size,
        purchase_price=float(purchase_price),
        currency=offer.currency.upper(),
        recommended_quantity=order_quantity,
        estimated_cost=float(estimated_cost),
        recommendation_status=status,
        source=SOURCE,
        coverage_start_date=coverage_start.isoformat(),
        coverage_end_date=coverage_end.isoformat(),
        explanation=explanation,
    )


def compare_supplier_offers(recommendations: Sequence[ReplenishmentRecommendation]) -> list[ReplenishmentRecommendation]:
    """Order independent supplier alternatives by feasibility, cost, and lead time.

    Each row is an alternative for the same product; quantities must not be
    summed across suppliers.
    """
    status_rank = {"PURCHASE_RECOMMENDED": 0, "NO_PURCHASE_NEEDED": 1, "INSUFFICIENT_FORECAST": 2}
    return sorted(
        recommendations,
        key=lambda item: (
            status_rank.get(item.recommendation_status, 99),
            item.estimated_cost if item.estimated_cost is not None else math.inf,
            item.lead_time_days,
            item.supplier_id,
        ),
    )
