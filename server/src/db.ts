import { Pool } from 'pg';
import type { ServerConfig } from './config.js';

export function createPool(config: Pick<ServerConfig, 'databaseUrl'>): Pool {
  return new Pool({ connectionString: config.databaseUrl });
}

export async function checkDatabase(pool: Pool): Promise<void> {
  await pool.query('SELECT 1');
}

export interface DatabaseReadiness {
  current_database: string;
  current_schema: string | null;
  current_user: string;
  products_relation: string | null;
  products_count: number | null;
  anomaly_schema_ready: boolean;
  missing_anomaly_objects: string[];
}

export async function checkDatabaseReadiness(pool: Pool): Promise<DatabaseReadiness> {
  const { rows } = await pool.query<DatabaseReadiness>(
    `WITH required_objects(name, present) AS (
       VALUES
         ('anomaly_incidents', to_regclass('public.anomaly_incidents') IS NOT NULL),
         ('anomaly_incident_events', to_regclass('public.anomaly_incident_events') IS NOT NULL),
         ('anomaly_event_queue', to_regclass('public.anomaly_event_queue') IS NOT NULL),
         ('anomaly_event_queue.last_error', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='anomaly_event_queue' AND column_name='last_error')),
         ('anomaly_event_queue.dead_lettered_at', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='anomaly_event_queue' AND column_name='dead_lettered_at')),
         ('anomaly_incidents_active_dedupe_uq', to_regclass('public.anomaly_incidents_active_dedupe_uq') IS NOT NULL),
         ('anomaly_incidents_detected_idx', to_regclass('public.anomaly_incidents_detected_idx') IS NOT NULL),
         ('anomaly_incidents_status_detected_idx', to_regclass('public.anomaly_incidents_status_detected_idx') IS NOT NULL),
         ('anomaly_incident_events_log_idx', to_regclass('public.anomaly_incident_events_log_idx') IS NOT NULL),
         ('anomaly_event_queue_pending_idx', to_regclass('public.anomaly_event_queue_pending_idx') IS NOT NULL)
         ,('anomaly_incidents_pkey', EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.anomaly_incidents') AND conname='anomaly_incidents_pkey'))
         ,('anomaly_incidents_anomaly_type_check', EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.anomaly_incidents') AND conname='anomaly_incidents_anomaly_type_check'))
         ,('anomaly_incidents_severity_check', EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.anomaly_incidents') AND conname='anomaly_incidents_severity_check'))
         ,('anomaly_incidents_risk_score_check', EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.anomaly_incidents') AND conname='anomaly_incidents_risk_score_check'))
         ,('anomaly_incidents_status_check', EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.anomaly_incidents') AND conname='anomaly_incidents_status_check'))
         ,('anomaly_incidents_subject_user_id_fkey', EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.anomaly_incidents') AND conname='anomaly_incidents_subject_user_id_fkey'))
         ,('anomaly_incident_events_pkey', EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.anomaly_incident_events') AND conname='anomaly_incident_events_pkey'))
         ,('anomaly_incident_events_incident_id_fkey', EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.anomaly_incident_events') AND conname='anomaly_incident_events_incident_id_fkey'))
         ,('anomaly_incident_events_log_id_fkey', EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.anomaly_incident_events') AND conname='anomaly_incident_events_log_id_fkey'))
         ,('anomaly_event_queue_pkey', EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.anomaly_event_queue') AND conname='anomaly_event_queue_pkey'))
         ,('anomaly_event_queue_log_id_fkey', EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.anomaly_event_queue') AND conname='anomaly_event_queue_log_id_fkey'))
         ,('anomaly_event_queue_attempts_check', EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.anomaly_event_queue') AND conname='anomaly_event_queue_attempts_check'))
     ), binding AS (
       SELECT EXISTS (
         SELECT 1 FROM pg_trigger tg
         JOIN pg_class rel ON rel.oid = tg.tgrelid
         JOIN pg_namespace ns ON ns.oid = rel.relnamespace
         JOIN pg_proc proc ON proc.oid = tg.tgfoid
         JOIN pg_namespace fn_ns ON fn_ns.oid = proc.pronamespace
         JOIN pg_language lang ON lang.oid = proc.prolang
         WHERE ns.nspname = 'public' AND rel.relname = 'audit_logs'
           AND tg.tgname = 'audit_logs_enqueue_anomaly_event' AND NOT tg.tgisinternal
           AND tg.tgtype = 5 AND tg.tgenabled IN ('O', 'A')
           AND fn_ns.nspname = 'public' AND proc.proname = 'enqueue_anomaly_audit_event'
           AND proc.prorettype = 'pg_catalog.trigger'::regtype AND lang.lanname = 'plpgsql'
           AND regexp_replace(lower(proc.prosrc), '\\s+', '', 'g') =
             'begininsertintopublic.anomaly_event_queue(log_id)values(new.log_id)onconflict(log_id)donothing;returnnew;end;'
       ) AS trigger_function_ready
     )
     SELECT current_database() AS current_database,
            current_schema() AS current_schema,
            current_user AS current_user,
            to_regclass('public.products')::text AS products_relation,
            COALESCE((SELECT jsonb_agg(name ORDER BY name) FROM required_objects WHERE NOT present), '[]'::jsonb)
              || CASE WHEN (SELECT trigger_function_ready FROM binding) THEN '[]'::jsonb
                      ELSE '["audit_logs_enqueue_anomaly_event/enqueue_anomaly_audit_event"]'::jsonb END AS missing_anomaly_objects,
            NOT EXISTS (SELECT 1 FROM required_objects WHERE NOT present)
              AND (SELECT trigger_function_ready FROM binding) AS anomaly_schema_ready`,
  );
  const readiness = rows[0];
  if (!readiness) throw new Error('Database readiness query returned no row.');

  if (readiness.products_relation !== null) {
    const { rows: counts } = await pool.query<{ products_count: number }>(
      'SELECT COUNT(*)::int AS products_count FROM public.products',
    );
    readiness.products_count = counts[0]?.products_count ?? 0;
  } else {
    readiness.products_count = null;
  }

  readiness.missing_anomaly_objects ??= [];
  readiness.anomaly_schema_ready ??= false;

  return readiness;
}
