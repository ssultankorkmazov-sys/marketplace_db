"""Train/tune the experimental XGBoost model and write a matched test report."""

from __future__ import annotations

import argparse
import json
from .cli import build_report, resolve_module_path, write_report
from .data import DataValidationError, load_dataset
from .evaluation import run_experiment


def main() -> int:
    parser = argparse.ArgumentParser(description="Run offline synthetic MarketKZ XGBoost sales prediction.")
    parser.add_argument("--input", default="../../fixtures/synthetic-sales-2025-2026.json")
    parser.add_argument("--output", default="reports/xgboost-results.json")
    args = parser.parse_args()
    input_path = resolve_module_path(args.input)
    output_path = resolve_module_path(args.output)
    try:
        dataset = load_dataset(input_path)
        report = run_experiment(dataset, build_report)
        write_report(output_path, report)
    except (DataValidationError, OSError, RuntimeError, ValueError) as error:
        parser.error(str(error))
    print(json.dumps({
        "output": str(output_path),
        "source": report["metadata"]["source"],
        "selected_config": report["metadata"]["parameter_selection"]["selected_config"],
        "summary_rows": len(report["summary"]),
        "forecast_runs": len(report["forecasts"]),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
