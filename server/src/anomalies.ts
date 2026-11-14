import type { Pool, PoolClient } from 'pg';

export const ANOMALY_TYPES = [
  'REPEATED_FAILED_LOGINS',
  'REPEATED_ADMIN_ACCESS_DENIED',
  'UNUSUAL_ORDER_ACTIVITY',
] as const;
export type AnomalyType = typeof ANOMALY_TYPES[number];
export type IncidentSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type IncidentStatus = 'NEW' | 'INVESTIGATING' | 'RESOLVED' | 'FALSE_POSITIVE';

export interface AnomalyRuleConfig {
  failedLoginThreshold: number;
  failedLoginWindowSeconds: number;
  adminDeniedThreshold: number;
  adminDeniedWindowSeconds: number;
  unusualOrderThreshold: number;
  unusualOrderWindowSeconds: number;
  pollIntervalMs: number;
}

export const DEFAULT_ANOMALY_CONFIG: AnomalyRuleConfig = {
  failedLoginThreshold: 5,
  failedLoginWindowSeconds: 120,
  adminDeniedThreshold: 5,
  adminDeniedWindowSeconds: 120,
  unusualOrderThreshold: 5,
  unusualOrderWindowSeconds: 300,
  pollIntervalMs: 5_000,
};
export const MAX_ANOMALY_QUEUE_ATTEMPTS = 5;

const RULE_ENV: Record<keyof AnomalyRuleConfig, string> = {
  failedLoginThreshold: 'ANOMALY_FAILED_LOGIN_THRESHOLD',
  failedLoginWindowSeconds: 'ANOMALY_FAILED_LOGIN_WINDOW_SECONDS',
  adminDeniedThreshold: 'ANOMALY_ADMIN_DENIED_THRESHOLD',
  adminDeniedWindowSeconds: 'ANOMALY_ADMIN_DENIED_WINDOW_SECONDS',
  unusualOrderThreshold: 'ANOMALY_ORDER_THRESHOLD',
  unusualOrderWindowSeconds: 'ANOMALY_ORDER_WINDOW_SECONDS',
  pollIntervalMs: 'ANOMALY_POLL_INTERVAL_MS',
};

export function loadAnomalyRuleConfig(env: NodeJS.ProcessEnv = process.env): AnomalyRuleConfig {
  const config = { ...DEFAULT_ANOMALY_CONFIG };
  for (const key of Object.keys(RULE_ENV) as (keyof AnomalyRuleConfig)[]) {
    const raw = env[RULE_ENV[key]]?.trim();
    if (!raw) continue;
    if (!/^\d+$/.test(raw)) throw new Error(`${RULE_ENV[key]} must be an integer.`);
    const value = Number(raw);
    const max = key.endsWith('Threshold') ? 10_000 : key === 'pollIntervalMs' ? 300_000 : 86_400;
    const min = key.endsWith('Threshold') ? 2 : 1;
    if (!Number.isSafeInteger(value) || value < min || value > max) {
      throw new Error(`${RULE_ENV[key]} must be between ${min} and ${max}.`);
    }
    config[key] = value;
  }
  return config;
}

export interface RuleEvent {
  log_id: string;
  user_id: number | null;
  action: string;
  status: 'SUCCESS' | 'FAILURE';
  details: Record<string, unknown>;
  created_at: Date | string;
}

export interface Recommendation {
  action: string;
  reason: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
  verification_step: string;
}

export interface AnomalyIncident {
  incident_id: string;
  anomaly_type: AnomalyType;
  subject_user_id: number | null;
  severity: IncidentSeverity;
  risk_score: number;
  status: IncidentStatus;
  detected_at: string;
  updated_at: string;
  first_event_at: string;
  last_event_at: string;
  evidence: Record<string, unknown>;
  explanation: string;
  recommendations: Recommendation[];
  deduplication_key: string;
}

export interface AnomalyPublisher {
  publishIncident(incident: AnomalyIncident): void;
}

interface RuleDefinition {
  threshold: number;
  windowSeconds: number;
  baseRisk: number;
  description: string;
}

function ruleDefinition(type: AnomalyType, config: AnomalyRuleConfig): RuleDefinition {
  switch (type) {
    case 'REPEATED_FAILED_LOGINS': return {
      threshold: config.failedLoginThreshold, windowSeconds: config.failedLoginWindowSeconds,
      baseRisk: 55, description: 'Repeated failed sign-in attempts were recorded for the same known account.',
    };
    case 'REPEATED_ADMIN_ACCESS_DENIED': return {
      threshold: config.adminDeniedThreshold, windowSeconds: config.adminDeniedWindowSeconds,
      baseRisk: 65, description: 'Repeated administrative access denials were recorded for the same authenticated account.',
    };
    case 'UNUSUAL_ORDER_ACTIVITY': return {
      threshold: config.unusualOrderThreshold, windowSeconds: config.unusualOrderWindowSeconds,
      baseRisk: 50, description: 'The account created an unusually high number of orders within the configured time window.',
    };
  }
}

const asMillis = (date: Date | string) => new Date(date).getTime();

/** Selects the inclusive evidence window ending at the triggering event. */
export function selectWindowEvents<T extends { created_at: Date | string }>(
  events: T[], triggerAt: Date | string, windowSeconds: number,
): T[] {
  const end = asMillis(triggerAt);
  const start = end - windowSeconds * 1_000;
  return events.filter((event) => {
    const at = asMillis(event.created_at);
    return Number.isFinite(at) && at >= start && at <= end;
  });
}

/** Score is deterministic: rule base risk plus 10 points per event over threshold, capped at 100. */
export function calculateRiskScore(type: AnomalyType, eventCount: number, threshold: number): number {
  if (!Number.isSafeInteger(eventCount) || eventCount < 0 || !Number.isSafeInteger(threshold) || threshold < 1) {
    throw new Error('Invalid risk scoring inputs.');
  }
  return Math.min(100, ruleDefinition(type, DEFAULT_ANOMALY_CONFIG).baseRisk + Math.max(0, eventCount - threshold) * 10);
}

export function severityForRisk(score: number): IncidentSeverity {
  if (!Number.isSafeInteger(score) || score < 0 || score > 100) throw new Error('Risk score must be from 0 to 100.');
  if (score >= 90) return 'CRITICAL';
  if (score >= 70) return 'HIGH';
  if (score >= 40) return 'MEDIUM';
  return 'LOW';
}

export function recommendationsFor(type: AnomalyType, eventCount: number): Recommendation[] {
  if (!Number.isSafeInteger(eventCount) || eventCount < 0) throw new Error('Invalid recommendation evidence.');
  switch (type) {
    case 'REPEATED_FAILED_LOGINS': return [{
      action: 'Review the account’s recent sign-in activity and contact the account owner through an established channel if the attempts are unfamiliar.',
      reason: `${eventCount} failed sign-in events were recorded for one known account in the configured window. This indicates repeated authentication failure, but does not establish who initiated it.`,
      priority: 'HIGH',
      verification_step: 'Check whether failed attempts stop and confirm with the account owner that any subsequent successful sign-in was expected.',
    }];
    case 'REPEATED_ADMIN_ACCESS_DENIED': return [{
      action: 'Review the account’s recent administrative access attempts and verify its intended role and session activity.',
      reason: `${eventCount} administrative access denials were recorded for one authenticated account. The evidence does not establish intent or account compromise.`,
      priority: 'HIGH',
      verification_step: 'Confirm the account role is correct and check that no further denied administrative requests occur after review.',
    }];
    case 'UNUSUAL_ORDER_ACTIVITY': return [{
      action: 'Review the linked orders and verify their fulfilment and inventory impact before taking any business action.',
      reason: `${eventCount} order-created events for one account exceeded the configured activity threshold. The rule does not determine whether the orders are legitimate.`,
      priority: 'MEDIUM',
      verification_step: 'Compare the linked order records with expected customer activity and confirm inventory and order status are consistent.',
    }];
  }
}

function anomalyForEvent(event: RuleEvent): AnomalyType | null {
  if (event.user_id === null || !Number.isSafeInteger(event.user_id) || event.user_id < 1) return null;
  if (event.action === 'LOGIN_FAILED' && event.status === 'FAILURE') return 'REPEATED_FAILED_LOGINS';
  if (event.action === 'ORDER_CREATED' && event.status === 'SUCCESS') return 'UNUSUAL_ORDER_ACTIVITY';
  const deniedAdminActions = new Set([
    'ADMIN_LOGS_ACCESS_DENIED', 'ADMIN_ORDERS_ACCESS_DENIED', 'ADMIN_ANOMALIES_ACCESS_DENIED', 'PRODUCTS_ACCESS_DENIED',
  ]);
  const deniedAdminMutations = new Set(['ORDER_STATUS_CHANGED', 'PRODUCT_CREATED', 'PRODUCT_UPDATED', 'PRODUCT_DELETED']);
  if (event.status === 'FAILURE' && (deniedAdminActions.has(event.action) ||
      (deniedAdminMutations.has(event.action) && event.details.reason === 'insufficient_role'))) {
    return 'REPEATED_ADMIN_ACCESS_DENIED';
  }
  return null;
}

function deduplicationKey(type: AnomalyType, userId: number): string {
  return `${type}:user:${userId}`;
}

function safeQueueError(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code : 'UNKNOWN';
  const message = error instanceof Error ? error.message : 'Unknown processing error';
  return `${code}: ${message}`
    .replace(/(?:postgres(?:ql)?:\/\/)[^\s]+/gi, '[redacted connection string]')
    .replace(/\b(password|token|secret|authorization)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 1_000);
}

async function transaction<T>(pool: Pool, callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const value = await callback(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

async function evaluateQueueEvent(
  client: PoolClient,
  event: RuleEvent,
  config: AnomalyRuleConfig,
): Promise<AnomalyIncident | null> {
  const type = anomalyForEvent(event);
  if (!type || event.user_id === null) return null;
  const rule = ruleDefinition(type, config);
  const key = deduplicationKey(type, event.user_id);

  // Serialize concurrent events for the same rule and account. The transaction
  // advisory lock is released automatically on commit/rollback.
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);

  const active = await client.query<AnomalyIncident>(
    `SELECT incident_id::text AS incident_id, anomaly_type, subject_user_id, severity, risk_score, status,
            detected_at, updated_at, first_event_at, last_event_at, evidence, explanation, recommendations, deduplication_key
     FROM public.anomaly_incidents
     WHERE deduplication_key=$1 AND status IN ('NEW', 'INVESTIGATING')
     FOR UPDATE`, [key],
  );
  let actionSql: string;
  let values: unknown[];
  if (type === 'REPEATED_FAILED_LOGINS') {
    actionSql = "action = 'LOGIN_FAILED' AND status = 'FAILURE'";
    values = [event.user_id, event.log_id, active.rows[0]?.incident_id ?? null, rule.windowSeconds];
  } else if (type === 'UNUSUAL_ORDER_ACTIVITY') {
    actionSql = "action = 'ORDER_CREATED' AND status = 'SUCCESS'";
    values = [event.user_id, event.log_id, active.rows[0]?.incident_id ?? null, rule.windowSeconds];
  } else {
    actionSql = `action = ANY($5::text[]) AND status = 'FAILURE'
      AND (action = ANY($6::text[]) OR details->>'reason' = 'insufficient_role')`;
    values = [event.user_id, event.log_id, active.rows[0]?.incident_id ?? null, rule.windowSeconds,
      ['ADMIN_LOGS_ACCESS_DENIED', 'ADMIN_ORDERS_ACCESS_DENIED', 'ADMIN_ANOMALIES_ACCESS_DENIED', 'PRODUCTS_ACCESS_DENIED', 'ORDER_STATUS_CHANGED', 'PRODUCT_CREATED', 'PRODUCT_UPDATED', 'PRODUCT_DELETED'],
      ['ADMIN_LOGS_ACCESS_DENIED', 'ADMIN_ORDERS_ACCESS_DENIED', 'ADMIN_ANOMALIES_ACCESS_DENIED', 'PRODUCTS_ACCESS_DENIED']];
  }
  const { rows: eventRows } = await client.query<{ log_id: string; created_at: string }>(
    `WITH evaluation AS (
       SELECT GREATEST(anchor.created_at, COALESCE(active.last_event_at, anchor.created_at)) AS evaluation_time
       FROM public.audit_logs anchor
       LEFT JOIN public.anomaly_incidents active ON active.incident_id=$3
       WHERE anchor.log_id=$2
     )
     SELECT audit.log_id::text AS log_id, audit.created_at::text AS created_at
     FROM public.audit_logs audit CROSS JOIN evaluation
     WHERE audit.user_id=$1 AND ${actionSql}
       AND audit.created_at >= evaluation.evaluation_time - ($4::int * INTERVAL '1 second')
       AND audit.created_at <= evaluation.evaluation_time
     ORDER BY audit.created_at, audit.log_id`, values,
  );
  // PostgreSQL applies both bounds using its full TIMESTAMPTZ precision. Do not
  // round-trip timestamps through JavaScript Date before counting these rows.
  const windowEvents = eventRows;

  let newEvents = windowEvents;
  if (!active.rows[0] && windowEvents.length) {
    const logIds = windowEvents.map((row) => row.log_id);
    const linked = await client.query<{ log_id: string }>(
      `SELECT DISTINCT event.log_id::text AS log_id
       FROM public.anomaly_incident_events event
       JOIN public.anomaly_incidents incident ON incident.incident_id=event.incident_id
       WHERE incident.deduplication_key=$1 AND event.log_id=ANY($2::bigint[])`, [key, logIds],
    );
    const previouslyUsed = new Set(linked.rows.map((row) => row.log_id));
    newEvents = windowEvents.filter((row) => !previouslyUsed.has(row.log_id));
  }

  const eligibleEvents = active.rows[0] ? windowEvents : newEvents;
  if (type === 'REPEATED_ADMIN_ACCESS_DENIED') {
    const reason = windowEvents.length === 0
      ? 'NO_MATCHING_EVENTS_IN_WINDOW'
      : eligibleEvents.length < rule.threshold
        ? eligibleEvents.length < windowEvents.length ? 'BELOW_THRESHOLD_AFTER_DEDUPLICATION' : 'BELOW_THRESHOLD'
        : 'THRESHOLD_MET';
    console.info('Admin-denied anomaly evaluation', {
      event_count: windowEvents.length,
      eligible_count: eligibleEvents.length,
      threshold: rule.threshold,
      window_seconds: rule.windowSeconds,
      reason,
    });
  }

  if (newEvents.length < rule.threshold && !active.rows[0]) return null;
  if (!windowEvents.length) return null;
  const evidenceEvents = active.rows[0] ? windowEvents : newEvents;
  if (evidenceEvents.length < rule.threshold) return null;

  const eventIds = evidenceEvents.map((row) => row.log_id);
  const firstEventAt = evidenceEvents[0].created_at;
  const lastEventAt = evidenceEvents[evidenceEvents.length - 1].created_at;
  const riskScore = calculateRiskScore(type, evidenceEvents.length, rule.threshold);
  const explanation = `${rule.description} Evidence: ${evidenceEvents.length} events in ${rule.windowSeconds} seconds; configured threshold: ${rule.threshold}.`;
  const evidence = {
    subject_user_id: event.user_id,
    event_count: evidenceEvents.length,
    threshold: rule.threshold,
    window_seconds: rule.windowSeconds,
    window_start: firstEventAt,
    window_end: lastEventAt,
    audit_log_ids: eventIds,
  };
  const recommendations = recommendationsFor(type, evidenceEvents.length);
  const { rows: incidents } = await client.query<AnomalyIncident>(
    `INSERT INTO public.anomaly_incidents
       (anomaly_type, subject_user_id, severity, risk_score, status, first_event_at, last_event_at,
        evidence, explanation, recommendations, deduplication_key)
     VALUES ($1, $2, $3, $4, 'NEW', $5, $6, $7::jsonb, $8, $9::jsonb, $10)
     ON CONFLICT (deduplication_key) WHERE status IN ('NEW', 'INVESTIGATING')
     DO UPDATE SET severity=EXCLUDED.severity, risk_score=EXCLUDED.risk_score,
       updated_at=NOW(), last_event_at=EXCLUDED.last_event_at,
       evidence=EXCLUDED.evidence, explanation=EXCLUDED.explanation,
       recommendations=EXCLUDED.recommendations
     RETURNING incident_id::text AS incident_id, anomaly_type, subject_user_id, severity, risk_score, status,
       detected_at, updated_at, first_event_at, last_event_at, evidence, explanation, recommendations, deduplication_key`,
    [type, event.user_id, severityForRisk(riskScore), riskScore, firstEventAt, lastEventAt,
      JSON.stringify(evidence), explanation, JSON.stringify(recommendations), key],
  );
  const incident = incidents[0];
  await client.query(
    `INSERT INTO public.anomaly_incident_events (incident_id, log_id)
     SELECT $1, unnest($2::bigint[])
     ON CONFLICT (incident_id, log_id) DO NOTHING`, [incident.incident_id, eventIds],
  );
  return incident;
}

/** Processes committed audit rows through a transactional outbox; failed rows remain retryable. */
export async function processPendingAnomalyEvents(
  pool: Pool,
  config: AnomalyRuleConfig = DEFAULT_ANOMALY_CONFIG,
  publisher?: AnomalyPublisher,
  limit = 100,
): Promise<number> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) throw new Error('Invalid anomaly batch size.');
  let processed = 0;
  for (let i = 0; i < limit; i += 1) {
    let incident: AnomalyIncident | null = null;
    let claimedLogId: string | null = null;
    try {
      incident = await transaction(pool, async (client) => {
        const pending = await client.query<{ log_id: string }>(
          `SELECT queue.log_id::text AS log_id
           FROM public.anomaly_event_queue queue
           WHERE queue.processed_at IS NULL AND queue.dead_lettered_at IS NULL AND queue.available_at <= NOW()
           ORDER BY queue.log_id FOR UPDATE SKIP LOCKED LIMIT 1`,
        );
        if (!pending.rows[0]) return null;
        claimedLogId = pending.rows[0].log_id;
        const eventResult = await client.query<RuleEvent>(
          `SELECT log_id::text AS log_id, user_id, action, status, details, created_at
           FROM public.audit_logs WHERE log_id=$1`, [claimedLogId],
        );
        if (!eventResult.rows[0]) {
          await client.query('UPDATE public.anomaly_event_queue SET processed_at=NOW() WHERE log_id=$1', [claimedLogId]);
          return null;
        }
        const detected = await evaluateQueueEvent(client, eventResult.rows[0], config);
        await client.query('UPDATE public.anomaly_event_queue SET processed_at=NOW() WHERE log_id=$1', [claimedLogId]);
        return detected;
      });
      if (!claimedLogId) break;
      processed += 1;
      if (incident) publisher?.publishIncident(incident);
    } catch (error) {
      if (claimedLogId) {
        await pool.query(
          `UPDATE public.anomaly_event_queue
           SET attempts=attempts+1,
               last_error=$2,
               dead_lettered_at=CASE WHEN attempts+1 >= $3 THEN NOW() ELSE NULL END,
               available_at=CASE WHEN attempts+1 >= $3 THEN available_at
                 ELSE NOW() + (LEAST(300, power(2, LEAST(attempts, 8))::int) * INTERVAL '1 second') END
           WHERE log_id=$1 AND processed_at IS NULL AND dead_lettered_at IS NULL`,
          [claimedLogId, safeQueueError(error), MAX_ANOMALY_QUEUE_ATTEMPTS],
        ).catch(() => undefined);
      }
      // Avoid logging database error strings, SQL, event contents or credentials.
      console.error('Anomaly event processing failed; the event remains queued for retry.');
      break;
    }
  }
  return processed;
}

export function startAnomalyWorker(
  pool: Pool,
  config: AnomalyRuleConfig,
  publisher?: AnomalyPublisher,
): { close(): Promise<void> } {
  let running = false;
  let stopped = false;
  let current: Promise<void> = Promise.resolve();
  const tick = () => {
    if (running || stopped) return;
    running = true;
    current = processPendingAnomalyEvents(pool, config, publisher).then(() => undefined).catch(() => {
      console.error('Anomaly worker cycle failed.');
    }).finally(() => { running = false; });
  };
  const timer = setInterval(tick, config.pollIntervalMs);
  timer.unref();
  tick();
  return { async close() { stopped = true; clearInterval(timer); await current; } };
}
