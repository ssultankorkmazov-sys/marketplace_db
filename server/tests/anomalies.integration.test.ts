import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Pool } from 'pg';
import { createApp } from '../src/app.js';
import { DEFAULT_ANOMALY_CONFIG, processPendingAnomalyEvents } from '../src/anomalies.js';
import { validateTestDatabaseUrl } from '../src/testDatabaseConfig.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const verifiedTestDatabase = testDatabaseUrl === undefined ? null : validateTestDatabaseUrl(testDatabaseUrl);
const integration = verifiedTestDatabase ? describe : describe.skip;
let pool: Pool;
let account: ReturnType<typeof request.agent> | undefined;
let userId: number | undefined;
let exactAdminDeniedUserId: number | undefined;

integration('anomaly PostgreSQL integration (TEST_DATABASE_URL only)', () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: verifiedTestDatabase!.connectionString });
    const context = await pool.query<{ database_name: string }>('SELECT current_database() AS database_name');
    if (context.rows[0]?.database_name !== 'market_db_test') throw new Error('Refusing anomaly integration writes outside market_db_test.');
    const schema = await pool.query<{ incidents: string | null; queue: string | null }>(
      `SELECT to_regclass('public.anomaly_incidents')::text AS incidents,
              to_regclass('public.anomaly_event_queue')::text AS queue`,
    );
    if (!schema.rows[0]?.incidents || !schema.rows[0]?.queue) throw new Error('Apply migration 004 to the local _test database before running anomaly integration tests.');
  });

  afterAll(async () => {
    if (!pool) return;
    for (const testUserId of [userId, exactAdminDeniedUserId].filter((id): id is number => id !== undefined)) {
      await pool.query('DELETE FROM public.anomaly_incidents WHERE subject_user_id=$1', [testUserId]);
      await pool.query('DELETE FROM public.audit_logs WHERE user_id=$1', [testUserId]);
      await pool.query('DELETE FROM public.users WHERE user_id=$1', [testUserId]);
    }
    await pool.end();
  });

  it('detects all three rules from PostgreSQL events and exposes them only through admin APIs', async () => {
    const app = createApp(pool);
    account = request.agent(app);
    const unique = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const registration = await account.post('/api/v1/auth/register').send({
      name: 'Anomaly Integration', email: `anomaly_${unique}@example.test`, phone: `+770${String(Date.now()).slice(-7)}01`,
      address: null, password: 'anomaly-integration-password',
    });
    expect(registration.status).toBe(201);
    userId = registration.body.user.user_id as number;

    const insertEvents = async (action: string, status: 'SUCCESS' | 'FAILURE', count: number, createdAt: Date) => {
      const ids: string[] = [];
      for (let index = 0; index < count; index += 1) {
        const inserted = await pool.query<{ log_id: string }>(
          `INSERT INTO public.audit_logs (user_id, action, status, details, created_at)
           VALUES ($1, $2, $3, $4::jsonb, $5) RETURNING log_id::text AS log_id`,
          [userId, action, status, JSON.stringify(action === 'ADMIN_LOGS_ACCESS_DENIED' ? { reason: 'insufficient_role' } : {}), createdAt],
        );
        ids.push(inserted.rows[0].log_id);
      }
      return ids;
    };
    const loginEventTime = new Date(Date.now() - 30_000);
    const loginEventIds = await insertEvents('LOGIN_FAILED', 'FAILURE', 5, loginEventTime);
    const adminDeniedEventIds = await insertEvents('ADMIN_LOGS_ACCESS_DENIED', 'FAILURE', 5, loginEventTime);
    const orderEventIds = await insertEvents('ORDER_CREATED', 'SUCCESS', 5, loginEventTime);
    const allInitialEventIds = [...loginEventIds, ...adminDeniedEventIds, ...orderEventIds];
    const queuedBeforeProcessing = await pool.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM public.anomaly_event_queue WHERE log_id=ANY($1::bigint[])', [allInitialEventIds],
    );
    expect(queuedBeforeProcessing.rows[0].count).toBe(15);

    // Use event timestamps rather than wall-clock spacing. This keeps the two-minute
    // rule window deterministic even if PostgreSQL or CI is slow between statements.
    const processUntilDone = async (logIds: string[]) => {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const pending = await pool.query<{ count: number }>(
          'SELECT COUNT(*)::int AS count FROM public.anomaly_event_queue WHERE log_id=ANY($1::bigint[]) AND processed_at IS NULL', [logIds],
        );
        if (pending.rows[0].count === 0) return;
        await processPendingAnomalyEvents(pool, DEFAULT_ANOMALY_CONFIG);
      }
      const pending = await pool.query<{ count: number }>(
        'SELECT COUNT(*)::int AS count FROM public.anomaly_event_queue WHERE log_id=ANY($1::bigint[]) AND processed_at IS NULL', [logIds],
      );
      expect(pending.rows[0].count).toBe(0);
    };
    await processUntilDone(allInitialEventIds);

    const sixthLoginTime = new Date(loginEventTime.getTime() + 1_000);
    const sixthLoginEventIds = await insertEvents('LOGIN_FAILED', 'FAILURE', 1, sixthLoginTime);
    const loginEventsInWindow = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM public.audit_logs
       WHERE log_id=ANY($1::bigint[]) AND created_at >= $2::timestamptz - INTERVAL '120 seconds'
         AND created_at <= $2::timestamptz`,
      [[...loginEventIds, ...sixthLoginEventIds], sixthLoginTime],
    );
    expect(loginEventsInWindow.rows[0].count).toBe(6);
    await processUntilDone(sixthLoginEventIds);
    const loginIncidents = await pool.query<{ count: number; event_count: number; severity: string; risk_score: number; recommendations: { reason: string }[]; explanation: string; incident_id: string }>(
      `SELECT COUNT(*)::int AS count, MAX((evidence->>'event_count')::int)::int AS event_count,
              MAX(severity) AS severity, MAX(risk_score)::int AS risk_score,
              (array_agg(recommendations ORDER BY detected_at DESC))[1] AS recommendations,
              (array_agg(explanation ORDER BY detected_at DESC))[1] AS explanation,
              (array_agg(incident_id::text ORDER BY detected_at DESC))[1] AS incident_id
       FROM public.anomaly_incidents
       WHERE subject_user_id=$1 AND anomaly_type='REPEATED_FAILED_LOGINS'
         AND status IN ('NEW', 'INVESTIGATING')`, [userId],
    );
    expect(loginIncidents.rows[0]).toMatchObject({ count: 1, event_count: 6, severity: 'MEDIUM', risk_score: 65 });
    expect(loginIncidents.rows[0].explanation).toContain('6 events in 120 seconds');
    expect(loginIncidents.rows[0].recommendations[0].reason).toContain('6 failed sign-in events');
    const loginLinks = await pool.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM public.anomaly_incident_events WHERE incident_id=$1 AND log_id=ANY($2::bigint[])',
      [loginIncidents.rows[0].incident_id, [...loginEventIds, ...sixthLoginEventIds]],
    );
    expect(loginLinks.rows[0].count).toBe(6);
    const processedLoginEvents = await pool.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM public.anomaly_event_queue WHERE log_id=ANY($1::bigint[]) AND processed_at IS NOT NULL',
      [[...loginEventIds, ...sixthLoginEventIds]],
    );
    expect(processedLoginEvents.rows[0].count).toBe(6);

    const denied = await account.get('/api/v1/admin/anomalies');
    expect(denied.status).toBe(403);
    await pool.query("UPDATE public.users SET role='admin' WHERE user_id=$1", [userId]);
    const listed = await account.get('/api/v1/admin/anomalies');
    expect(listed.status).toBe(200);
    const ownIncidents = listed.body.incidents.filter((item: { subject_user_id: number }) => item.subject_user_id === userId);
    expect(ownIncidents).toHaveLength(3);
    expect(ownIncidents.map((item: { anomaly_type: string }) => item.anomaly_type).sort()).toEqual([
      'REPEATED_ADMIN_ACCESS_DENIED', 'REPEATED_FAILED_LOGINS', 'UNUSUAL_ORDER_ACTIVITY',
    ]);
    const expectedByType: Record<string, { count: number; risk: number; severity: string }> = {
      REPEATED_FAILED_LOGINS: { count: 6, risk: 65, severity: 'MEDIUM' },
      REPEATED_ADMIN_ACCESS_DENIED: { count: 5, risk: 65, severity: 'MEDIUM' },
      UNUSUAL_ORDER_ACTIVITY: { count: 5, risk: 50, severity: 'MEDIUM' },
    };
    for (const incident of ownIncidents as { anomaly_type: string; risk_score: number; severity: string; evidence: { event_count: number }; recommendations: { reason: string }[]; audit_log_ids: string[] }[]) {
      expect(incident).toMatchObject({ risk_score: expectedByType[incident.anomaly_type].risk, severity: expectedByType[incident.anomaly_type].severity });
      expect(incident.evidence.event_count).toBe(expectedByType[incident.anomaly_type].count);
      expect(incident.audit_log_ids).toHaveLength(expectedByType[incident.anomaly_type].count);
      expect(incident.recommendations[0].reason).toBeTruthy();
    }
    expect(ownIncidents.find((incident: { anomaly_type: string }) => incident.anomaly_type === 'REPEATED_ADMIN_ACCESS_DENIED')?.audit_log_ids.sort())
      .toEqual(adminDeniedEventIds.sort());
    expect(ownIncidents.find((incident: { anomaly_type: string }) => incident.anomaly_type === 'UNUSUAL_ORDER_ACTIVITY')?.audit_log_ids.sort())
      .toEqual(orderEventIds.sort());
    const id = ownIncidents[0].incident_id as string;
    expect((await account.get(`/api/v1/admin/anomalies/${id}`)).body.incident.audit_log_ids).toHaveLength(5);
    const changed = await account.patch(`/api/v1/admin/anomalies/${id}/status`).send({ status: 'INVESTIGATING' });
    expect(changed.status).toBe(200);
    expect(changed.body.incident.status).toBe('INVESTIGATING');
    const active = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM public.anomaly_incidents
       WHERE subject_user_id=$1 AND status IN ('NEW', 'INVESTIGATING')`, [userId],
    );
    expect(active.rows[0].count).toBe(3);
  });

  it('detects five real ADMIN_ANOMALIES_ACCESS_DENIED route events for one user', async () => {
    const deniedAccount = request.agent(createApp(pool));
    const unique = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const registration = await deniedAccount.post('/api/v1/auth/register').send({
      name: 'Admin Denied Integration', email: `anomaly_denied_${unique}@example.test`,
      phone: `+771${String(Date.now()).slice(-7)}02`, address: null, password: 'anomaly-integration-password',
    });
    expect(registration.status).toBe(201);
    exactAdminDeniedUserId = registration.body.user.user_id as number;

    for (let index = 0; index < 5; index += 1) {
      const denied = await deniedAccount.get('/api/v1/admin/anomalies');
      expect(denied.status).toBe(403);
    }

    const { rows: auditEvents } = await pool.query<{ log_id: string; action: string; status: string; user_id: number; created_at: Date; reason: string }>(
      `SELECT log_id::text AS log_id, action, status, user_id, created_at, details->>'reason' AS reason
       FROM public.audit_logs WHERE user_id=$1 AND action='ADMIN_ANOMALIES_ACCESS_DENIED'
       ORDER BY log_id`, [exactAdminDeniedUserId],
    );
    expect(auditEvents).toHaveLength(5);
    expect(auditEvents.every((event) => event.status === 'FAILURE' && event.reason === 'insufficient_role')).toBe(true);
    const logIds = auditEvents.map((event) => event.log_id);

    // Give the route-generated events deterministic PostgreSQL microseconds.
    // Passing these timestamps as strings keeps the precision that JS Date loses.
    const timestampBase = new Date(Date.now() - 30_000).toISOString().slice(0, 19);
    const preciseTimes = ['100001', '200002', '300003', '400004', '500005']
      .map((fraction) => `${timestampBase}.${fraction}Z`);
    for (let index = 0; index < logIds.length; index += 1) {
      await pool.query('UPDATE public.audit_logs SET created_at=$2::timestamptz WHERE log_id=$1', [logIds[index], preciseTimes[index]]);
    }
    const persistedTimes = await pool.query<{ created_at: string }>(
      'SELECT created_at::text AS created_at FROM public.audit_logs WHERE log_id=ANY($1::bigint[]) ORDER BY log_id', [logIds],
    );
    expect(persistedTimes.rows).toHaveLength(5);
    expect(new Set(persistedTimes.rows.map((row) => row.created_at)).size).toBe(5);
    expect(persistedTimes.rows.every((row) => /\.\d{6}/.test(row.created_at))).toBe(true);
    const eventTimes = persistedTimes.rows.map((row) => Date.parse(row.created_at));
    expect(Math.max(...eventTimes) - Math.min(...eventTimes)).toBeLessThanOrEqual(120_000);

    const queued = await pool.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM public.anomaly_event_queue WHERE log_id=ANY($1::bigint[])', [logIds],
    );
    expect(queued.rows[0].count).toBe(5);

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const pending = await pool.query<{ count: number }>(
        'SELECT COUNT(*)::int AS count FROM public.anomaly_event_queue WHERE log_id=ANY($1::bigint[]) AND processed_at IS NULL', [logIds],
      );
      if (pending.rows[0].count === 0) break;
      await processPendingAnomalyEvents(pool, DEFAULT_ANOMALY_CONFIG);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    const incidentRows = await pool.query<{ count: number; event_count: number; severity: string; risk_score: number; incident_id: string }>(
      `SELECT COUNT(*)::int AS count, MAX((evidence->>'event_count')::int)::int AS event_count,
              MAX(severity) AS severity, MAX(risk_score)::int AS risk_score,
              MAX(incident_id::text) AS incident_id
       FROM public.anomaly_incidents
       WHERE subject_user_id=$1 AND anomaly_type='REPEATED_ADMIN_ACCESS_DENIED'
         AND status IN ('NEW', 'INVESTIGATING')`, [exactAdminDeniedUserId],
    );
    expect(incidentRows.rows[0]).toMatchObject({ count: 1, event_count: 5, severity: 'MEDIUM', risk_score: 65 });
    const linked = await pool.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM public.anomaly_incident_events WHERE incident_id=$1 AND log_id=ANY($2::bigint[])',
      [incidentRows.rows[0].incident_id, logIds],
    );
    expect(linked.rows[0].count).toBe(5);
    const processed = await pool.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM public.anomaly_event_queue WHERE log_id=ANY($1::bigint[]) AND processed_at IS NOT NULL', [logIds],
    );
    expect(processed.rows[0].count).toBe(5);
  });
});
