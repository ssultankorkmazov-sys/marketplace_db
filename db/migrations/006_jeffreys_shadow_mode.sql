-- Additive storage for observational Jeffreys evaluations.
-- No audit, queue, incident, or marketplace rows are changed by this migration.

CREATE TABLE IF NOT EXISTS public.jeffreys_shadow_checkpoint (
  singleton_id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (singleton_id = 1),
  profile_version VARCHAR(64) NOT NULL,
  configuration_signature TEXT NOT NULL,
  next_evaluation_at TIMESTAMPTZ NOT NULL,
  last_subject_user_id INT,
  verification_pass BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.jeffreys_shadow_evaluations (
  evaluation_id BIGSERIAL PRIMARY KEY,
  profile_version VARCHAR(64) NOT NULL,
  subject_user_id INT NOT NULL,
  evaluated_at TIMESTAMPTZ NOT NULL,
  baseline_start_at TIMESTAMPTZ NOT NULL,
  baseline_end_at TIMESTAMPTZ NOT NULL,
  current_start_at TIMESTAMPTZ NOT NULL,
  current_end_at TIMESTAMPTZ NOT NULL,
  baseline_observations BIGINT,
  current_observations BIGINT,
  baseline_distribution JSONB,
  current_distribution JSONB,
  divergence DOUBLE PRECISION,
  category_contributions JSONB,
  evaluation_status VARCHAR(32) NOT NULL CHECK (evaluation_status IN (
    'SUFFICIENT_DATA', 'INSUFFICIENT_DATA', 'WORK_LIMIT_EXCEEDED', 'EVALUATION_ERROR'
  )),
  sample_counts_capped BOOLEAN NOT NULL DEFAULT FALSE,
  profile_config JSONB NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT jeffreys_shadow_eval_window_uq UNIQUE (profile_version, subject_user_id, evaluated_at),
  CONSTRAINT jeffreys_shadow_eval_baseline_count_check CHECK (baseline_observations IS NULL OR baseline_observations >= 0),
  CONSTRAINT jeffreys_shadow_eval_current_count_check CHECK (current_observations IS NULL OR current_observations >= 0)
);

CREATE INDEX IF NOT EXISTS jeffreys_shadow_eval_user_time_idx
  ON public.jeffreys_shadow_evaluations (profile_version, subject_user_id, evaluated_at DESC);
CREATE INDEX IF NOT EXISTS jeffreys_shadow_eval_profile_time_idx
  ON public.jeffreys_shadow_evaluations (profile_version, evaluated_at DESC);
