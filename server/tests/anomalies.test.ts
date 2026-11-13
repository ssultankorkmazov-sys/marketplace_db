import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Pool, PoolClient } from 'pg';
import {
  calculateRiskScore, DEFAULT_ANOMALY_CONFIG, MAX_ANOMALY_QUEUE_ATTEMPTS, loadAnomalyRuleConfig, processPendingAnomalyEvents,
  recommendationsFor, selectWindowEvents, severityForRisk, type AnomalyIncident,
} from '../src/anomalies.js';
import { createApp } from '../src/app.js';

const admin = { user_id: 8, name: 'Admin', email: 'admin@example.kz', phone: '+77000000008', address: null, role: 'admin' as const };
const user = { ...admin, user_id: 9, role: 'user' as const };
const token = Buffer.from('a'.repeat(32)).toString('base64url');
const cookie = `marketkz_session=${token}`;
const eventAt = new Date('2026-11-01T10:02:00.000Z');
const incident: AnomalyIncident = {
  incident_id: '41', anomaly_type: 'REPEATED_FAILED_LOGINS', subject_user_id: 8,
  severity: 'MEDIUM', risk_score: 55, status: 'NEW', detected_at: eventAt.toISOString(), updated_at: eventAt.toISOString(),
  first_event_at: '2026-11-01T10:00:01.000Z', last_event_at: eventAt.toISOString(),
  evidence: { subject_user_id: 8, event_count: 5, threshold: 5, window_seconds: 120, audit_log_ids: ['1', '2', '3', '4', '5'] },
  explanation: 'Repeated failed sign-in attempts were recorded for the same known account. Evidence: 5 events in 120 seconds; configured threshold: 5.',
  recommendations: recommendationsFor('REPEATED_FAILED_LOGINS', 5), deduplication_key: 'REPEATED_FAILED_LOGINS:user:8',
};

describe('anomaly detection rules and recommendations', () => {
  it('uses configurable defaults and validates environment values', () => {
    expect(DEFAULT_ANOMALY_CONFIG.failedLoginThreshold).toBe(5);
    expect(loadAnomalyRuleConfig({ ANOMALY_ORDER_THRESHOLD: '7', ANOMALY_ORDER_WINDOW_SECONDS: '240' } as NodeJS.ProcessEnv))
      .toMatchObject({ unusualOrderThreshold: 7, unusualOrderWindowSeconds: 240 });
    expect(() => loadAnomalyRuleConfig({ ANOMALY_FAILED_LOGIN_THRESHOLD: '1' } as NodeJS.ProcessEnv)).toThrow(/between 2 and 10000/);
  });

  it('applies inclusive time-window boundaries and excludes events outside the window', () => {
    const events = [
      { log_id: 'old', created_at: '2026-11-01T09:59:59.999Z' },
      { log_id: 'boundary', created_at: '2026-11-01T10:00:00.000Z' },
      { log_id: 'trigger', created_at: eventAt },
      { log_id: 'future', created_at: '2026-11-01T10:02:00.001Z' },
    ];
    expect(selectWindowEvents(events, eventAt, 120).map((entry) => entry.log_id)).toEqual(['boundary', 'trigger']);
  });

  it('calculates stable scores and severity bands from rule and event count', () => {
    expect(calculateRiskScore('REPEATED_FAILED_LOGINS', 5, 5)).toBe(55);
    expect(calculateRiskScore('REPEATED_ADMIN_ACCESS_DENIED', 7, 5)).toBe(85);
    expect(calculateRiskScore('UNUSUAL_ORDER_ACTIVITY', 99, 5)).toBe(100);
    expect(severityForRisk(55)).toBe('MEDIUM');
    expect(severityForRisk(85)).toBe('HIGH');
    expect(severityForRisk(95)).toBe('CRITICAL');
  });

  it.each([
    'REPEATED_FAILED_LOGINS', 'REPEATED_ADMIN_ACCESS_DENIED', 'UNUSUAL_ORDER_ACTIVITY',
  ] as const)('returns evidence-based actionable recommendations for %s', (type) => {
    const [recommendation] = recommendationsFor(type, 5);
    expect(recommendation.action).toBeTruthy();
    expect(recommendation.reason).toContain('5');
    expect(recommendation.priority).toMatch(/^(LOW|MEDIUM|HIGH)$/);
    expect(recommendation.verification_step).toBeTruthy();
    expect(recommendation.reason).not.toMatch(/(?:is|are) (?:compromised|fraudulent|malicious)/i);
  });
});

function fakeWorkerPool(options: { matchingEvents: number; active?: AnomalyIncident; failure?: boolean; action?: 'LOGIN_FAILED' | 'ADMIN_LOGS_ACCESS_DENIED' | 'ORDER_CREATED' }) {
  const calls: { sql: string; values?: unknown[] }[] = [];
  let claimed = false;
  let currentIncident = options.active;
  let failure = options.failure ?? false;
  let attempts = 0;
  let deadLettered = false;
  let processed = false;
  let nextLog = 5;
  const clientQuery = vi.fn(async (sql: string, values?: unknown[]) => {
    calls.push({ sql, values });
    if (sql.includes('UPDATE public.anomaly_event_queue SET processed_at=NOW()')) processed = true;
    if (sql === 'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))') return { rows: [] };
    if (sql.includes('FROM public.anomaly_event_queue queue')) {
      if (claimed || deadLettered || processed) return { rows: [] };
      claimed = true;
      return { rows: [{ log_id: String(nextLog) }] };
    }
    if (sql.includes('FROM public.audit_logs WHERE log_id=$1')) {
      if (failure) throw Object.assign(new Error('test database failure'), { code: 'XX000' });
      const action = options.action ?? 'LOGIN_FAILED';
      return { rows: [{ log_id: String(nextLog), user_id: 8, action, status: action === 'ORDER_CREATED' ? 'SUCCESS' : 'FAILURE', details: { reason: action === 'ADMIN_LOGS_ACCESS_DENIED' ? 'insufficient_role' : 'invalid_credentials' }, created_at: eventAt }] };
    }
    if (sql.includes('FROM public.audit_logs') && sql.includes('created_at >= $2')) {
      const n = options.matchingEvents;
      return { rows: Array.from({ length: n }, (_, index) => ({ log_id: String(index + 1), created_at: new Date(eventAt.getTime() - (n - index - 1) * 10_000) })) };
    }
    if (sql.includes('FROM public.anomaly_incidents') && sql.includes('FOR UPDATE')) return { rows: currentIncident ? [currentIncident] : [] };
    if (sql.includes('FROM public.anomaly_incident_events event')) return { rows: [] };
    if (sql.includes('INSERT INTO public.anomaly_incidents')) {
      currentIncident = { ...incident, anomaly_type: values?.[0] as AnomalyIncident['anomaly_type'], severity: values?.[2] as AnomalyIncident['severity'], risk_score: Number(values?.[3]), evidence: JSON.parse(String(values?.[6])), explanation: String(values?.[7]), recommendations: JSON.parse(String(values?.[8])) };
      return { rows: [currentIncident] };
    }
    return { rows: [] };
  });
  const poolQuery = vi.fn(async (sql: string, values?: unknown[]) => {
    calls.push({ sql, values });
    if (sql.includes('UPDATE public.anomaly_event_queue') && sql.includes('last_error=$2')) {
      attempts += 1;
      deadLettered = attempts >= Number(values?.[2]);
    }
    return { rows: [] };
  });
  const client = { query: clientQuery, release: vi.fn() };
  const pool = { query: poolQuery, connect: vi.fn().mockResolvedValue(client) };
  return { pool: pool as unknown as Pool, calls, clientQuery, poolQuery,
    setNextLog(value: number) { nextLog = value; claimed = false; },
    setFailure(value: boolean) { failure = value; },
    get attempts() { return attempts; }, get deadLettered() { return deadLettered; } };
}

describe('anomaly outbox processing', () => {
  afterEach(() => vi.restoreAllMocks());

  it('does not create an incident below the configured threshold', async () => {
    const fake = fakeWorkerPool({ matchingEvents: 4 });
    expect(await processPendingAnomalyEvents(fake.pool)).toBe(1);
    expect(fake.calls.some(({ sql }) => sql.includes('INSERT INTO public.anomaly_incidents'))).toBe(false);
    expect(fake.calls.some(({ sql }) => sql.includes('SET processed_at=NOW()'))).toBe(true);
  });

  it('creates one incident with linked evidence when the threshold is reached, and publishes after commit', async () => {
    const fake = fakeWorkerPool({ matchingEvents: 5 });
    const publisher = { publishIncident: vi.fn() };
    expect(await processPendingAnomalyEvents(fake.pool, DEFAULT_ANOMALY_CONFIG, publisher)).toBe(1);
    expect(fake.calls.some(({ sql }) => sql.includes('INSERT INTO public.anomaly_incidents'))).toBe(true);
    const link = fake.calls.find(({ sql }) => sql.includes('INSERT INTO public.anomaly_incident_events'))!;
    expect(link.values).toEqual(['41', ['1', '2', '3', '4', '5']]);
    expect(fake.calls.findIndex(({ sql }) => sql === 'COMMIT')).toBeLessThan(fake.calls.length);
    expect(publisher.publishIncident).toHaveBeenCalledWith(expect.objectContaining({ risk_score: 55 }));
  });

  it.each([
    ['REPEATED_FAILED_LOGINS', 'LOGIN_FAILED'],
    ['REPEATED_ADMIN_ACCESS_DENIED', 'ADMIN_LOGS_ACCESS_DENIED'],
    ['UNUSUAL_ORDER_ACTIVITY', 'ORDER_CREATED'],
  ] as const)('detects %s at its configured default threshold', async (type, action) => {
    const fake = fakeWorkerPool({ matchingEvents: 5, action });
    await processPendingAnomalyEvents(fake.pool);
    const inserted = fake.calls.find(({ sql }) => sql.includes('INSERT INTO public.anomaly_incidents'))!;
    expect(inserted.values?.[0]).toBe(type);
    expect(inserted.values?.[1]).toBe(8);
  });

  it('upserts an active incident instead of creating a duplicate when matching events repeat', async () => {
    const fake = fakeWorkerPool({ matchingEvents: 6, active: incident });
    await processPendingAnomalyEvents(fake.pool);
    const upsert = fake.calls.find(({ sql }) => sql.includes('INSERT INTO public.anomaly_incidents'))?.sql ?? '';
    expect(upsert).toContain('ON CONFLICT (deduplication_key) WHERE status IN');
    expect(fake.calls.find(({ sql }) => sql.includes('INSERT INTO public.anomaly_incident_events'))?.values?.[1]).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  it('keeps a failed event queued and schedules a retry without exposing database details', async () => {
    const fake = fakeWorkerPool({ matchingEvents: 5, failure: true });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await processPendingAnomalyEvents(fake.pool)).toBe(0);
    expect(fake.poolQuery).toHaveBeenCalledWith(expect.stringContaining('last_error=$2'), ['5', 'XX000: test database failure', MAX_ANOMALY_QUEUE_ATTEMPTS]);
    expect(error).toHaveBeenCalledWith('Anomaly event processing failed; the event remains queued for retry.');
  });

  it('redacts credential-like values before preserving the processing error', async () => {
    const fake = fakeWorkerPool({ matchingEvents: 5, failure: true });
    fake.clientQuery.mockImplementation(async (sql: string, values?: unknown[]) => {
      fake.calls.push({ sql, values });
      if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT' || sql === 'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))') return { rows: [] };
      if (sql.includes('FROM public.anomaly_event_queue queue')) return { rows: [{ log_id: '5' }] };
      if (sql.includes('FROM public.audit_logs WHERE log_id=$1')) throw new Error('password=private-value');
      return { rows: [] };
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await processPendingAnomalyEvents(fake.pool);
    expect(fake.poolQuery.mock.calls[0][1]?.[1]).toBe('UNKNOWN: password=[redacted]');
    expect(String(fake.poolQuery.mock.calls[0][1]?.[1])).not.toContain('private-value');
  });

  it('moves a permanently failing event to dead letter after the bounded retry limit', async () => {
    const fake = fakeWorkerPool({ matchingEvents: 5, failure: true });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (let attempt = 0; attempt < MAX_ANOMALY_QUEUE_ATTEMPTS; attempt += 1) {
      fake.setNextLog(5);
      await processPendingAnomalyEvents(fake.pool);
    }
    expect(fake.attempts).toBe(MAX_ANOMALY_QUEUE_ATTEMPTS);
    expect(fake.deadLettered).toBe(true);
    fake.setNextLog(5);
    expect(await processPendingAnomalyEvents(fake.pool)).toBe(0);
    expect(fake.clientQuery.mock.calls.filter(([sql]) => String(sql).includes('FROM public.anomaly_event_queue queue'))).toHaveLength(MAX_ANOMALY_QUEUE_ATTEMPTS + 1);
  });

  it('recovers from a temporary processing failure and processes the event on retry', async () => {
    const fake = fakeWorkerPool({ matchingEvents: 5, failure: true });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await processPendingAnomalyEvents(fake.pool)).toBe(0);
    expect(fake.attempts).toBe(1);
    fake.setFailure(false);
    fake.setNextLog(5);
    expect(await processPendingAnomalyEvents(fake.pool)).toBe(1);
    expect(fake.deadLettered).toBe(false);
    expect(fake.calls.some(({ sql }) => sql === 'COMMIT')).toBe(true);
  });
});

describe('admin anomaly management API', () => {
  it('requires an authenticated administrator for list, detail, and status changes', async () => {
    const query = vi.fn(async (sql: string, values?: unknown[]) => sql.includes('FROM user_sessions') ? { rows: [user] } :
      sql.includes('INSERT INTO audit_logs') ? { rows: [{ log_id: '90', user_id: values?.[0] ?? null, action: values?.[1], entity_type: null, entity_id: null, status: values?.[4], details: JSON.parse(String(values?.[5])), ip_address: null, created_at: eventAt }] } : { rows: [] });
    const app = createApp({ query } as unknown as Pool);
    expect((await request(app).get('/api/v1/admin/anomalies')).status).toBe(401);
    expect((await request(app).get('/api/v1/admin/anomalies').set('Cookie', cookie)).status).toBe(403);
    expect((await request(app).get('/api/v1/admin/anomalies/queue-stats')).status).toBe(401);
    expect((await request(app).get('/api/v1/admin/anomalies/queue-stats').set('Cookie', cookie)).status).toBe(403);
    expect((await request(app).get('/api/v1/admin/anomalies/1').set('Cookie', cookie)).status).toBe(403);
    expect((await request(app).patch('/api/v1/admin/anomalies/1/status').set('Cookie', cookie).send({ status: 'RESOLVED' })).status).toBe(403);
    expect(query.mock.calls.filter(([sql]) => !String(sql).includes('INSERT INTO audit_logs')).every(([sql]) => String(sql).includes('FROM user_sessions'))).toBe(true);
  });

  it('serves filtered incidents to admins and validates query and status inputs', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM user_sessions')) return { rows: [admin] };
      if (sql.includes('FROM public.anomaly_incidents incident')) return { rows: [{ ...incident, audit_log_ids: ['1', '2', '3', '4', '5'] }] };
      if (sql.includes('FROM public.anomaly_incidents')) return { rows: [{ total: 1, low: 0, medium: 1, high: 0, critical: 0 }] };
      return { rows: [] };
    });
    const app = createApp({ query } as unknown as Pool);
    const listed = await request(app).get('/api/v1/admin/anomalies?severity=MEDIUM&page=1&pageSize=10').set('Cookie', cookie);
    expect(listed.status).toBe(200);
    expect(listed.body.incidents[0].audit_log_ids).toHaveLength(5);
    expect((await request(app).get('/api/v1/admin/anomalies?type=unknown').set('Cookie', cookie)).status).toBe(400);
    expect((await request(app).patch('/api/v1/admin/anomalies/1/status').set('Cookie', cookie).send({ status: 'NEW' })).status).toBe(400);
  });

  it('returns a safe chronological list of linked audit events in incident details', async () => {
    const timeline = [{ log_id: '12', created_at: eventAt.toISOString(), action: 'LOGIN_FAILED', status: 'FAILURE', entity_type: 'user', entity_id: 8 }];
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes('FROM user_sessions')) return { rows: [admin] };
      if (sql.includes('FROM public.anomaly_incidents incident') && sql.includes('timeline.events')) {
        return { rows: [{ ...incident, audit_log_ids: ['12'], timeline }] };
      }
      return { rows: [] };
    });
    const response = await request(createApp({ query } as unknown as Pool)).get('/api/v1/admin/anomalies/41').set('Cookie', cookie);

    expect(response.status).toBe(200);
    expect(response.body.incident.timeline).toEqual(timeline);
    const detailCall = query.mock.calls.find(([sql]) => String(sql).includes('timeline.events'))!;
    expect(detailCall[1]).toEqual(['41']);
    expect(String(detailCall[0])).toContain("'created_at', log.created_at");
    expect(String(detailCall[0])).toContain("'action', log.action");
    expect(String(detailCall[0])).toContain("'status', log.status");
    expect(String(detailCall[0])).toContain("'entity_type', log.entity_type");
    expect(String(detailCall[0])).toContain("'entity_id', log.entity_id");
    expect(String(detailCall[0])).toContain('ORDER BY log.created_at, log.log_id');
    expect(String(detailCall[0])).not.toContain("'ip_address'");
    expect(String(detailCall[0])).not.toContain("'details'");
  });

  it('returns queue counts and last processed time only to administrators', async () => {
    const queueStats = { pending: 3, processed: 21, dead_letter: 2, processing_errors: 4, last_processed_at: eventAt.toISOString() };
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM user_sessions')) return { rows: [admin] };
      if (sql.includes('FROM public.anomaly_event_queue')) return { rows: [queueStats] };
      return { rows: [] };
    });
    const response = await request(createApp({ query } as unknown as Pool)).get('/api/v1/admin/anomalies/queue-stats').set('Cookie', cookie);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(queueStats);
    const statsCall = query.mock.calls.find(([sql]) => String(sql).includes('FROM public.anomaly_event_queue'))!;
    expect(String(statsCall[0])).toContain('processed_at IS NULL AND dead_lettered_at IS NULL');
    expect(String(statsCall[0])).toContain('processed_at IS NOT NULL');
    expect(String(statsCall[0])).toContain('dead_lettered_at IS NOT NULL');
    expect(String(statsCall[0])).toContain('SUM(attempts)');
    expect(String(statsCall[0])).toContain('MAX(processed_at)');
    expect(String(statsCall[0])).not.toContain('last_error');
  });

  it('updates a non-terminal incident in a transaction and writes an audit event', async () => {
    const calls: { sql: string; values?: unknown[] }[] = [];
    const clientQuery = vi.fn(async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      if (sql.includes('SELECT status FROM public.anomaly_incidents')) return { rows: [{ status: 'NEW' }] };
      if (sql.includes('UPDATE public.anomaly_incidents')) return { rows: [{ ...incident, status: values?.[0], updated_at: eventAt.toISOString() }] };
      if (sql.includes('INSERT INTO audit_logs')) return { rows: [{ log_id: '99', user_id: 8, action: 'ANOMALY_STATUS_CHANGED', status: 'SUCCESS' }] };
      return { rows: [] };
    });
    const pool = {
      query: vi.fn(async (sql: string) => sql.includes('FROM user_sessions') ? { rows: [admin] } : { rows: [] }),
      connect: vi.fn().mockResolvedValue({ query: clientQuery, release: vi.fn() } as unknown as PoolClient),
    };
    const response = await request(createApp(pool as unknown as Pool)).patch('/api/v1/admin/anomalies/41/status').set('Cookie', cookie).send({ status: 'INVESTIGATING' });
    expect(response.status).toBe(200);
    expect(response.body.incident.status).toBe('INVESTIGATING');
    expect(calls[0].sql).toBe('BEGIN');
    expect(calls.at(-1)?.sql).toBe('COMMIT');
    expect(calls.some(({ sql }) => sql.includes('INSERT INTO audit_logs'))).toBe(true);
  });
});
