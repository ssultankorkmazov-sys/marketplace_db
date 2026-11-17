# Phase 3A/3B: offline Smart Replenishment demonstration

This module is an offline, synthetic-only demonstration. It does not call the MarketKZ API, connect to PostgreSQL, create supplier orders, or modify `products.stock_quantity`.

## Data

`fixtures/synthetic-suppliers-2026.json` contains four synthetic suppliers, 24 supplier-product offers for the 12 IDs in the existing synthetic sales fixture, a synthetic inventory snapshot, and synthetic inbound shipments. Supplier terms such as delivery time, MOQ, pack size, purchase price, and currency are product-specific and therefore live on each supplier-product offer. At least two suppliers can be compared for every synthetic product.

The fixture is fixed and reproducible (`seed: 20261117`). `source: SYNTHETIC` is required for supplier, offer, shipment, inventory and report records. The demonstration stock snapshot is dated 2026-06-30 and is not related to MarketKZ's real product rows.

## Calculation

For a product and one supplier alternative, the engine sums daily forecast values for the next `lead_time_days + review_period_days`. It subtracts current synthetic stock and eligible confirmed/in-transit quantities arriving after the as-of date and on or before the coverage end. `CANCELLED` and `RECEIVED` shipments do not reduce the requirement. Duplicate shipment IDs are rejected.

```text
need = max(0, demand_cover + safety_stock - current_stock - eligible_inbound)
order_quantity = 0                                      when need = 0
order_quantity = max(MOQ, ceil(ceil(need)/pack_size) * pack_size) otherwise
estimated_cost = order_quantity * purchase_price
```

An incomplete forecast returns `INSUFFICIENT_FORECAST` with unknown quantity and cost. It never substitutes a guessed value. Supplier rows are alternatives for the same requirement; do not sum their recommended quantities.

The demo uses the already selected Phase 2B XGBoost configuration and existing leakage-safe feature builder/recursive forecaster. It trains using the existing synthetic train + validation period, then forecasts beyond the synthetic inventory as-of date. The provisional safety stock is `ceil(mean(last 28 synthetic daily sales) * safety_days)`; the default `safety_days=7` is an illustrative setting, not calibrated for real service levels. The existing Phase 2B report and sales fixture are read-only inputs and are not rewritten.

## Run

Activate the existing project virtual environment and set the module path (PowerShell from the repository root):

```powershell
$env:PYTHONPATH = (Resolve-Path .\ml\sales_prediction\src).Path
& .\ml\sales_prediction\.venv\Scripts\python.exe -m marketkz_sales_prediction.replenishment_cli `
  --output .\ml\sales_prediction\reports\replenishment-demo-run.json
```

The CLI refuses to overwrite an existing output file. Choose a new output path for another run. Optional flags include `--review-period-days` and `--safety-days`.

## Tests

```powershell
$env:PYTHONPATH = (Resolve-Path .\ml\sales_prediction\src).Path
& .\ml\sales_prediction\.venv\Scripts\python.exe -m unittest discover -s .\ml\sales_prediction\tests -v
```

The test suite needs no database. The demo CLI additionally requires the locally installed XGBoost requirements in the project virtual environment.

## Limits

All supplier, stock, inbound and forecast values are synthetic. This is not an operational purchasing system or an accuracy claim. It has no real supplier integration, no purchase approval workflow, no receipt operation, and no inventory mutation. The chosen safety-stock policy and model require validation before any use with real products.
