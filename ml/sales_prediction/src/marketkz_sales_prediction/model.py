"""XGBoost model selection and fitting for the offline forecasting experiment."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Sequence


@dataclass(frozen=True)
class XGBoostConfig:
    max_depth: int
    learning_rate: float
    n_estimators: int = 300
    min_child_weight: float = 3.0
    subsample: float = 0.9
    colsample_bytree: float = 0.9
    reg_alpha: float = 0.1
    reg_lambda: float = 5.0
    random_state: int = 20250308

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


DEFAULT_CANDIDATES = (
    XGBoostConfig(max_depth=2, learning_rate=0.05),
    XGBoostConfig(max_depth=3, learning_rate=0.05),
    XGBoostConfig(max_depth=3, learning_rate=0.1),
)


def _regressor(config: XGBoostConfig, *, early_stopping_rounds: int | None = None):
    try:
        from xgboost import XGBRegressor
    except ImportError as error:
        raise RuntimeError("XGBoost is required. Install ml/sales_prediction/requirements.txt in the project venv.") from error
    options = {
        "objective": "count:poisson",
        "eval_metric": "mae",
        "tree_method": "hist",
        "max_depth": config.max_depth,
        "learning_rate": config.learning_rate,
        "n_estimators": config.n_estimators,
        "min_child_weight": config.min_child_weight,
        "subsample": config.subsample,
        "colsample_bytree": config.colsample_bytree,
        "reg_alpha": config.reg_alpha,
        "reg_lambda": config.reg_lambda,
        "max_delta_step": 0.7,
        "random_state": config.random_state,
        "n_jobs": 1,
        "verbosity": 0,
    }
    if early_stopping_rounds is not None:
        options["early_stopping_rounds"] = early_stopping_rounds
    return XGBRegressor(**options)


def _as_matrix(features: Sequence[Sequence[float]]):
    try:
        import numpy as np
    except ImportError as error:
        raise RuntimeError("NumPy is required. Install ml/sales_prediction/requirements.txt in the project venv.") from error
    matrix = np.asarray(features, dtype=np.float32)
    if matrix.ndim != 2 or matrix.shape[0] == 0:
        raise ValueError("Feature matrix must be a non-empty 2D array.")
    return matrix


def tune_config(
    train_features: Sequence[Sequence[float]],
    train_targets: Sequence[float],
    validation_features: Sequence[Sequence[float]],
    validation_targets: Sequence[float],
    candidates: Sequence[XGBoostConfig] = DEFAULT_CANDIDATES,
    early_stopping_rounds: int = 25,
) -> tuple[XGBoostConfig, dict[str, Any], list[dict[str, Any]]]:
    """Select depth/rate/trees using only chronological validation observations."""
    if not candidates or len(train_features) != len(train_targets) or len(validation_features) != len(validation_targets):
        raise ValueError("Training and validation features/targets must be non-empty and aligned.")
    if not train_features or not validation_features:
        raise ValueError("Training and validation sets must both contain observations.")
    if early_stopping_rounds < 1:
        raise ValueError("early_stopping_rounds must be positive.")
    import numpy as np

    x_train = _as_matrix(train_features)
    y_train = np.asarray(train_targets, dtype=np.float32)
    x_validation = _as_matrix(validation_features)
    y_validation = np.asarray(validation_targets, dtype=np.float32)
    if np.any(y_train < 0) or np.any(y_validation < 0):
        raise ValueError("Count targets must be non-negative.")

    trials: list[dict[str, Any]] = []
    best: tuple[float, XGBoostConfig, Any, int] | None = None
    for config in candidates:
        candidate_model = _regressor(config, early_stopping_rounds=early_stopping_rounds)
        candidate_model.fit(x_train, y_train, eval_set=[(x_validation, y_validation)], verbose=False)
        predictions = candidate_model.predict(x_validation)
        score = float(np.mean(np.abs(y_validation - predictions)))
        best_iteration = int(getattr(candidate_model, "best_iteration", config.n_estimators - 1))
        selected_config = XGBoostConfig(**{**config.as_dict(), "n_estimators": best_iteration + 1})
        trials.append({
            "config": config.as_dict(),
            "validation_mae": score,
            "best_iteration": best_iteration,
            "selected_n_estimators": best_iteration + 1,
        })
        if best is None or score < best[0]:
            best = (score, selected_config, candidate_model, best_iteration)
    assert best is not None
    return best[1], {"validation_mae": best[0], "best_iteration": best[3]}, trials


def fit_final_model(features: Sequence[Sequence[float]], targets: Sequence[float], config: XGBoostConfig):
    """Fit a fresh model on train+validation using the selected tree count."""
    import numpy as np

    matrix = _as_matrix(features)
    target_array = np.asarray(targets, dtype=np.float32)
    if len(matrix) != len(target_array) or np.any(target_array < 0):
        raise ValueError("Final training features and non-negative targets must be aligned.")
    model = _regressor(config)
    model.fit(matrix, target_array, verbose=False)
    return model


def predict_count(model, features: Sequence[float]) -> float:
    """Return a finite, non-negative count forecast."""
    import numpy as np

    prediction = float(model.predict(np.asarray([features], dtype=np.float32))[0])
    if not np.isfinite(prediction):
        raise ValueError("XGBoost returned a non-finite prediction.")
    return max(0.0, prediction)
