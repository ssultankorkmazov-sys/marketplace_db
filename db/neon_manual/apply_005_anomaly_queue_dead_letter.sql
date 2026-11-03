-- Add retry diagnostics and a terminal dead-letter state for poison queue records.
-- This migration only adds nullable metadata and preserves existing queue rows.
ALTER TABLE public.anomaly_event_queue
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS dead_lettered_at TIMESTAMPTZ;
