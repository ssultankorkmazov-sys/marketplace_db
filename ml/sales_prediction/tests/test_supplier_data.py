from __future__ import annotations

import unittest
from pathlib import Path

from marketkz_sales_prediction.data import load_dataset
from marketkz_sales_prediction.supplier_data import load_supplier_fixture


ROOT = Path(__file__).resolve().parents[3]


class SupplierFixtureTests(unittest.TestCase):
    def test_fixture_links_all_synthetic_sales_products_and_is_fully_labeled(self):
        sales = load_dataset(ROOT / "fixtures" / "synthetic-sales-2025-2026.json")
        catalog = load_supplier_fixture(
            ROOT / "ml" / "sales_prediction" / "fixtures" / "synthetic-suppliers-2026.json",
            sales.product_ids,
        )
        self.assertEqual(len(catalog.current_stock), 12)
        self.assertEqual(len(catalog.suppliers), 4)
        self.assertEqual(len(catalog.offers), 24)
        self.assertEqual({offer.source for offer in catalog.offers}, {"SYNTHETIC"})
        self.assertEqual({shipment.source for shipment in catalog.inbound_shipments}, {"SYNTHETIC"})
        self.assertTrue(all(offer.synthetic_product_id in sales.product_ids for offer in catalog.offers))
        self.assertTrue(all(count >= 2 for count in {
            product_id: sum(offer.synthetic_product_id == product_id for offer in catalog.offers)
            for product_id in sales.product_ids
        }.values()))


if __name__ == "__main__":
    unittest.main()
