-- Additive anomaly incident storage and transactional audit-event outbox.
-- Existing audit and marketplace rows are preserved; historical audit events
-- are intentionally not replayed by this migration.

CREATE TABLE IF NOT EXISTS public.anomaly_incidents (
  incident_id BIGSERIAL PRIMARY KEY,
  anomaly_type VARCHAR(64) NOT NULL CHECK (anomaly_type IN (
    'REPEATED_FAILED_LOGINS',
    'REPEATED_ADMIN_ACCESS_DENIED',
    'UNUSUAL_ORDER_ACTIVITY'
  )),
  subject_user_id INT REFERENCES public.users(user_id) ON DELETE SET NULL,
  severity VARCHAR(16) NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  risk_score INT NOT NULL CHECK (risk_score >= 0 AND risk_score <= 100),
  status VARCHAR(20) NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'INVESTIGATING', 'RESOLVED', 'FALSE_POSITIVE')),
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  first_event_at TIMESTAMPTZ NOT NULL,
  last_event_at TIMESTAMPTZ NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  explanation TEXT NOT NULL,
  recommendations JSONB NOT NULL DEFAULT '[]'::jsonb,
  deduplication_key VARCHAR(160) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.anomaly_incident_events (
  incident_id BIGINT NOT NULL REFERENCES public.anomaly_incidents(incident_id) ON DELETE CASCADE,
  log_id BIGINT NOT NULL REFERENCES public.audit_logs(log_id) ON DELETE CASCADE,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (incident_id, log_id)
);

CREATE TABLE IF NOT EXISTS public.anomaly_event_queue (
  log_id BIGINT PRIMARY KEY REFERENCES public.audit_logs(log_id) ON DELETE CASCADE,
  queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempts INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS anomaly_incidents_active_dedupe_uq
  ON public.anomaly_incidents (deduplication_key)
  WHERE status IN ('NEW', 'INVESTIGATING');
CREATE INDEX IF NOT EXISTS anomaly_incidents_detected_idx
  ON public.anomaly_incidents (detected_at DESC, incident_id DESC);
CREATE INDEX IF NOT EXISTS anomaly_incidents_status_detected_idx
  ON public.anomaly_incidents (status, detected_at DESC);
CREATE INDEX IF NOT EXISTS anomaly_incident_events_log_idx
  ON public.anomaly_incident_events (log_id);
CREATE INDEX IF NOT EXISTS anomaly_event_queue_pending_idx
  ON public.anomaly_event_queue (available_at, log_id)
  WHERE processed_at IS NULL;

CREATE OR REPLACE FUNCTION public.enqueue_anomaly_audit_event()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.anomaly_event_queue (log_id) VALUES (NEW.log_id)
  ON CONFLICT (log_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER audit_logs_enqueue_anomaly_event
AFTER INSERT ON public.audit_logs
FOR EACH ROW EXECUTE FUNCTION public.enqueue_anomaly_audit_event();
