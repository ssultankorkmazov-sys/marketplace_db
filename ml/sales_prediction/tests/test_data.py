from __future__ import annotations

import copy
import json
import unittest
from pathlib import Path

from marketkz_sales_prediction.data import DataValidationError, load_dataset, validate_dataset

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
FIXTURE = REPOSITORY_ROOT / "fixtures" / "synthetic-sales-2025-2026.json"


def tiny_payload() -> dict:
    sales = []
    for day in range(1, 4):
        sales.append({
            "date": f"2025-01-0{day}", "synthetic_product_id": "SYN-X1", "category_id": 1,
            "quantity_sold": day - 1, "price": 100.0, "discount_percent": 0,
            "selling_price": 100.0, "active_event_codes": [], "active_event_names": [],
            "applied_event_codes": [], "source": "SYNTHETIC",
        })
    return {
        "metadata": {"source": "SYNTHETIC", "start_date": "2025-01-01", "end_date": "2025-01-03", "records": 3},
        "products": [{"synthetic_product_id": "SYN-X1", "category_id": 1}],
        "sales": sales,
    }


class DataValidationTests(unittest.TestCase):
    def test_loads_existing_fixture(self) -> None:
        dataset = load_dataset(FIXTURE)
        self.assertEqual(len(dataset.rows), 8760)
        self.assertEqual(len(dataset.product_ids), 12)
        self.assertEqual(dataset.rows[0].date.isoformat(), "2025-01-01")
        self.assertEqual(dataset.rows[-1].date.isoformat(), "2026-12-31")

    def test_rejects_non_synthetic_source(self) -> None:
        payload = tiny_payload()
        payload["sales"][0]["source"] = "REAL"
        with self.assertRaises(DataValidationError):
            validate_dataset(payload)

    def test_rejects_bad_date_duplicate_pair_negative_quantity_and_bad_numeric_values(self) -> None:
        cases = []
        payload = tiny_payload(); payload["sales"][0]["date"] = "2025-02-30"; cases.append(payload)
        payload = tiny_payload(); payload["sales"].append(copy.deepcopy(payload["sales"][0])); payload["metadata"]["records"] = 4; cases.append(payload)
        payload = tiny_payload(); payload["sales"][0]["quantity_sold"] = -1; cases.append(payload)
        payload = tiny_payload(); payload["sales"][0]["price"] = float("nan"); cases.append(payload)
        payload = tiny_payload(); payload["sales"][0]["discount_percent"] = 100; cases.append(payload)
        for payload in cases:
            with self.subTest(payload=payload):
                with self.assertRaises(DataValidationError):
                    validate_dataset(payload)

    def test_rejects_missing_day_for_a_product(self) -> None:
        payload = tiny_payload()
        payload["sales"].pop(1)
        payload["metadata"]["records"] = 2
        with self.assertRaisesRegex(DataValidationError, "incomplete daily coverage"):
            validate_dataset(payload)

    def test_load_dataset_reports_invalid_json(self) -> None:
        with self.assertRaises(DataValidationError):
            load_dataset(FIXTURE.with_name("file-that-does-not-exist.json"))


if __name__ == "__main__":
    unittest.main()
