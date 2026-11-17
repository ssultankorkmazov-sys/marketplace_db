import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import {
  getJeffreysShadowConfigurationSignature,
  processJeffreysShadowTick,
  type JeffreysShadowConfig,
} from '../src/jeffreysShadow.js';
import { validateTestDatabaseUrl } from '../src/testDatabaseConfig.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const verifiedTestDatabase = testDatabaseUrl === undefined ? null : validateTestDatabaseUrl(testDatabaseUrl);
const integration = verifiedTestDatabase ? describe : describe.skip;
let pool: Pool;
let testUserId: number | null = null;
let auditIds: string[] = [];
let previousCheckpoint: Record<string, unknown> | null = null;
const profileVersion = 'shadow-integration-v1';
const config: JeffreysShadowConfig = {
  profileVersion,
  baselineWindowSeconds: 600,
  currentWindowSeconds: 300,
  evaluationCadenceSeconds: 300,
  allowedLatenessSeconds: 1,
  alpha: 0.5,
  minimumBaselineObservations: 2,
  minimumCurrentObservations: 2,
  maxSubjectsPerTick: 10,
  maxEventsPerWindow: 100,
  pollIntervalMs: 60_000,
};

integration('Jeffreys shadow PostgreSQL integration (local TEST_DATABASE_URL only)', () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: verifiedTestDatabase!.connectionString });
    const context = await pool.query<{ database_name: string }>('SELECT current_database() AS database_name');
    if (context.rows[0]?.database_name !== 'market_db_test') throw new Error('Refusing shadow integration writes outside market_db_test.');
    const schema = await pool.query<{ checkpoint: string | null; evaluations: string | null }>(
      `SELECT to_regclass('public.jeffreys_shadow_checkpoint')::text AS checkpoint,
              to_regclass('public.jeffreys_shadow_evaluations')::text AS evaluations`,
    );
    if (!schema.rows[0]?.checkpoint || !schema.rows[0]?.evaluations) {
      throw new Error('Apply migration 006 to local market_db_test before running Jeffreys shadow integration tests.');
    }
    const prior = await pool.query<Record<string, unknown>>(
      'SELECT singleton_id, profile_version, configuration_signature, next_evaluation_at, last_subject_user_id, verification_pass, updated_at FROM public.jeffreys_shadow_checkpoint WHERE singleton_id=1',
    );
    previousCheckpoint = prior.rows[0] ?? null;
  });

  afterAll(async () => {
    if (!pool) return;
    if (testUserId !== null) {
      await pool.query('DELETE FROM public.jeffreys_shadow_evaluations WHERE subject_user_id=$1 AND profile_version=$2', [testUserId, profileVersion]);
      await pool.query('DELETE FROM public.audit_logs WHERE user_id=$1', [testUserId]);
      await pool.query('DELETE FROM public.users WHERE user_id=$1', [testUserId]);
    }
    if (previousCheckpoint) {
      await pool.query(
        `INSERT INTO public.jeffreys_shadow_checkpoint (singleton_id, profile_version, configuration_signature, next_evaluation_at, last_subject_user_id, verification_pass, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (singleton_id) DO UPDATE SET profile_version=EXCLUDED.profile_version,
           configuration_signature=EXCLUDED.configuration_signature, next_evaluation_at=EXCLUDED.next_evaluation_at,
           last_subject_user_id=EXCLUDED.last_subject_user_id, verification_pass=EXCLUDED.verification_pass, updated_at=EXCLUDED.updated_at`,
        [previousCheckpoint.singleton_id, previousCheckpoint.profile_version, previousCheckpoint.configuration_signature,
          previousCheckpoint.next_evaluation_at, previousCheckpoint.last_subject_user_id, previousCheckpoint.verification_pass, previousCheckpoint.updated_at],
      );
    } else {
      await pool.query('DELETE FROM public.jeffreys_shadow_checkpoint WHERE singleton_id=1 AND profile_version=$1', [profileVersion]);
    }
    await pool.end();
  });

  it('includes an event arriving between chronological passes without changing the rule queue or incidents', async () => {
    const dueResult = await pool.query<{ latest_due_at: Date }>(
      `SELECT date_bin(make_interval(secs => $1), statement_timestamp() - make_interval(secs => $2), $3::timestamptz) AS latest_due_at`,
      [config.evaluationCadenceSeconds, config.allowedLatenessSeconds, '2000-01-01T00:00:00.000Z'],
    );
    const evaluationAt = dueResult.rows[0].latest_due_at;
    const currentStart = new Date(evaluationAt.getTime() - config.currentWindowSeconds * 1_000);
    const baselineStart = new Date(currentStart.getTime() - config.baselineWindowSeconds * 1_000);
    const identity = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const user = await pool.query<{ user_id: number }>(
      `INSERT INTO public.users (name, email, phone, address, password_hash, role)
       VALUES ($1,$2,$3,NULL,NULL,'user') RETURNING user_id`,
      ['Shadow integration', `shadow_${identity}@example.test`, `+770${String(Date.now()).slice(-7)}11`],
    );
    testUserId = user.rows[0].user_id;

    const events = [
      { action: 'LOGIN_SUCCESS', at: new Date(baselineStart.getTime() + 20_000), status: 'SUCCESS' },
      { action: 'ORDER_CREATED', at: new Date(currentStart.getTime() + 180_000), status: 'SUCCESS' },
      // Inserted last with an earlier event-time than the previous current row.
      { action: 'LOGIN_FAILED', at: new Date(currentStart.getTime() + 60_000), status: 'FAILURE' },
      { action: 'LOGIN_SUCCESS', at: new Date(baselineStart.getTime() + 40_000), status: 'SUCCESS' },
    ] as const;
    for (const event of events) {
      const inserted = await pool.query<{ log_id: string }>(
        `INSERT INTO public.audit_logs (user_id, action, status, details, created_at)
         VALUES ($1,$2,$3,'{}'::jsonb,$4) RETURNING log_id::text AS log_id`,
        [testUserId, event.action, event.status, event.at],
      );
      auditIds.push(inserted.rows[0].log_id);
    }
    const incidentsBefore = await pool.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM public.anomaly_incidents WHERE subject_user_id=$1', [testUserId],
    );

    const signature = getJeffreysShadowConfigurationSignature(config);
    await pool.query(
      `INSERT INTO public.jeffreys_shadow_checkpoint (singleton_id, profile_version, configuration_signature, next_evaluation_at, last_subject_user_id, verification_pass)
       VALUES (1,$1,$2,$3,NULL,FALSE)
       ON CONFLICT (singleton_id) DO UPDATE SET profile_version=EXCLUDED.profile_version,
         configuration_signature=EXCLUDED.configuration_signature, next_evaluation_at=EXCLUDED.next_evaluation_at,
         last_subject_user_id=NULL, verification_pass=FALSE, updated_at=NOW()`,
      [profileVersion, signature, evaluationAt],
    );
    const tick = await processJeffreysShadowTick(pool, config);
    expect(tick).toMatchObject({ acquired: true, evaluatedSubjects: 1, evaluationAt: evaluationAt.toISOString(), advancedCheckpoint: false });

    const firstEvaluation = await pool.query<{ current_observations: string }>(
      `SELECT current_observations::text FROM public.jeffreys_shadow_evaluations
       WHERE profile_version=$1 AND subject_user_id=$2 AND evaluated_at=$3`, [profileVersion, testUserId, evaluationAt],
    );
    expect(firstEvaluation.rows[0]?.current_observations).toBe('2');

    // This row commits after the first sweep, with an event-time before the
    // previously inserted +180s row. The verification sweep must include it.
    const lateEvent = await pool.query<{ log_id: string }>(
      `INSERT INTO public.audit_logs (user_id, action, status, details, created_at)
       VALUES ($1,'ORDER_CREATED','SUCCESS','{}'::jsonb,$2) RETURNING log_id::text AS log_id`,
      [testUserId, new Date(currentStart.getTime() + 120_000)],
    );
    auditIds.push(lateEvent.rows[0].log_id);
    const queueBefore = await pool.query(
      'SELECT log_id::text AS log_id, processed_at, attempts, dead_lettered_at FROM public.anomaly_event_queue WHERE log_id=ANY($1::bigint[]) ORDER BY log_id', [auditIds],
    );
    const verificationTick = await processJeffreysShadowTick(pool, config);
    expect(verificationTick).toMatchObject({ acquired: true, evaluatedSubjects: 1, evaluationAt: evaluationAt.toISOString(), advancedCheckpoint: true });

    const saved = await pool.query<{
      baseline_observations: string; current_observations: string; evaluation_status: string;
      divergence: number | null; baseline_distribution: Record<string, number>; current_distribution: Record<string, number>;
    }>(
      `SELECT baseline_observations::text, current_observations::text, evaluation_status, divergence,
              baseline_distribution, current_distribution
       FROM public.jeffreys_shadow_evaluations
       WHERE profile_version=$1 AND subject_user_id=$2 AND evaluated_at=$3`, [profileVersion, testUserId, evaluationAt],
    );
    expect(saved.rows).toHaveLength(1);
    expect(saved.rows[0]).toMatchObject({ baseline_observations: '2', current_observations: '3', evaluation_status: 'SUFFICIENT_DATA' });
    expect(saved.rows[0].divergence).toBeGreaterThan(0);
    expect(saved.rows[0].baseline_distribution.ORDER).toBeGreaterThan(0);
    expect(saved.rows[0].current_distribution.AUTH).toBeGreaterThan(0);

    const queueAfter = await pool.query(
      'SELECT log_id::text AS log_id, processed_at, attempts, dead_lettered_at FROM public.anomaly_event_queue WHERE log_id=ANY($1::bigint[]) ORDER BY log_id', [auditIds],
    );
    const incidentsAfter = await pool.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM public.anomaly_incidents WHERE subject_user_id=$1', [testUserId],
    );
    expect(queueAfter.rows).toEqual(queueBefore.rows);
    expect(incidentsAfter.rows[0].count).toBe(incidentsBefore.rows[0].count);
  });
});
