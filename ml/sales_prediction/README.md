# MarketKZ offline sales prediction

This isolated Python package evaluates forecasting models against the synthetic fixture. It reads local JSON only and does not connect to PostgreSQL, MarketKZ APIs, or Jeffreys Shadow Mode.

## Data and chronological protocol

The input is `fixtures/synthetic-sales-2025-2026.json`. The loader validates synthetic provenance, dates, unique SKU/date rows, full daily coverage, non-negative integer quantities, and numeric prices/discounts. Generator-only fields are never used as model inputs.

The fixed intervals are:

- Train: 2025-01-01 through 2025-12-31.
- Validation: 2026-01-01 through 2026-06-30.
- Test: 2026-07-01 through 2026-12-31.

Validation and test forecasts use rolling origins. Features for a target date use only observations strictly before that date. Within a recursive horizon, predictions are appended to history and later actual values are not used. Overlapping windows are correlated; metrics are descriptive rather than independent-trial estimates.

## Install in the project virtual environment

From the repository root in PowerShell, activate the local environment first:

```powershell
& .\ml\sales_prediction\.venv\Scripts\Activate.ps1
.\ml\sales_prediction\.venv\Scripts\python.exe -m pip install -r ml\sales_prediction\requirements.txt
$env:PYTHONPATH = (Resolve-Path .\ml\sales_prediction\src).Path
```

The requirements are NumPy, scikit-learn (required by `XGBRegressor`), and XGBoost. No packages are installed globally.

## Phase 2A: baseline CLI

```powershell
python -m marketkz_sales_prediction.cli `
  --input ..\..\fixtures\synthetic-sales-2025-2026.json `
  --output reports\baseline-results.json
```

The baseline models are Moving Average over 7 and 28 days, and Seasonal Naive with a 7-day period. The JSON includes validation/test summaries and detailed rolling forecasts. It refuses to overwrite an existing output report.

## Phase 2B: XGBoost CLI

```powershell
python -m marketkz_sales_prediction.xgboost_cli `
  --input ..\..\fixtures\synthetic-sales-2025-2026.json `
  --output reports\xgboost-results.json
```

The global model is `XGBRegressor(objective="count:poisson")`. It uses one-hot SKU/category identity, weekday/month/day-of-year and cyclic calendar features, fixture calendar event indicators and distances, seasonal windows, lags 1/7/14/28, and 7/28-day trailing means. It excludes `event_multiplier`, `seasonal_multiplier`, `applied_event_codes`, `base_daily_demand`, `holiday_sensitive`, `demand_profile`, and future prices/discounts.

Candidate depth and learning rate, plus early-stopped tree count, are selected only with chronological one-day-ahead validation. A fresh model is then fitted on train plus validation. The final test comparison uses the exact same rolling origins, SKUs and 7/14/30-day horizons as all three baselines. The report contains overall and per-SKU MAE, WAPE, RMSLE and MASE, plus holiday-window and ordinary-day scores. Holiday windows follow fixture event dates; `SUMMER_SEASON` is considered a season, not a holiday, for that comparison. The CLI refuses to overwrite an existing report.

## Tests

```powershell
python -m unittest discover -s ml/sales_prediction/tests -v
```

## Limitations

All results are `SYNTHETIC`; they do not establish real-world demand accuracy. There are only two annual cycles, sparse product series, and repeated rolling-origin windows. The baseline does not use planned promotions or prices. The experiment is offline and is not integrated with the marketplace backend or inventory operations.
