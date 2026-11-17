-- Immutable synthetic replenishment snapshots and final administrator decisions.
-- These tables do not reference or modify marketplace products, inventory, or orders.

CREATE TABLE IF NOT EXISTS public.replenishment_runs (
  run_id BIGSERIAL PRIMARY KEY,
  source VARCHAR(16) NOT NULL CHECK (source = 'SYNTHETIC'),
  model_name VARCHAR(128) NOT NULL,
  model_version VARCHAR(64),
  forecast_start DATE NOT NULL,
  forecast_end DATE NOT NULL,
  review_period_days INT NOT NULL CHECK (review_period_days >= 0),
  metadata_snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_user_id INT REFERENCES public.users(user_id) ON DELETE SET NULL,
  CONSTRAINT replenishment_runs_forecast_period_check CHECK (forecast_start <= forecast_end)
);

CREATE TABLE IF NOT EXISTS public.replenishment_recommendations (
  recommendation_id BIGSERIAL PRIMARY KEY,
  run_id BIGINT NOT NULL REFERENCES public.replenishment_runs(run_id) ON DELETE RESTRICT,
  recommendation_index INT NOT NULL CHECK (recommendation_index >= 0),
  synthetic_product_id VARCHAR(64) NOT NULL,
  synthetic_supplier_id VARCHAR(64) NOT NULL,
  supplier_name VARCHAR(150) NOT NULL,
  recommendation_snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT replenishment_recommendations_run_index_uq UNIQUE (run_id, recommendation_index)
);

CREATE TABLE IF NOT EXISTS public.replenishment_decisions (
  decision_id BIGSERIAL PRIMARY KEY,
  recommendation_id BIGINT NOT NULL REFERENCES public.replenishment_recommendations(recommendation_id) ON DELETE RESTRICT,
  decision VARCHAR(10) NOT NULL CHECK (decision IN ('ACCEPTED', 'REJECTED')),
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_by_user_id INT REFERENCES public.users(user_id) ON DELETE SET NULL,
  CONSTRAINT replenishment_decisions_recommendation_uq UNIQUE (recommendation_id)
);

CREATE INDEX IF NOT EXISTS replenishment_runs_created_idx
  ON public.replenishment_runs (created_at DESC, run_id DESC);
CREATE INDEX IF NOT EXISTS replenishment_recommendations_product_idx
  ON public.replenishment_recommendations (run_id, synthetic_product_id, recommendation_index);
