import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import { validateTestDatabaseUrl } from '../src/testDatabaseConfig.js';

const rawTestDatabaseUrl = process.env.TEST_DATABASE_URL;
// A present but invalid URL is a failing configuration, never a skipped suite.
const verifiedTestDatabase = rawTestDatabaseUrl === undefined ? null : validateTestDatabaseUrl(rawTestDatabaseUrl);
const postgresIntegration = verifiedTestDatabase ? describe : describe.skip;
const reportPath = fileURLToPath(new URL('../../ml/sales_prediction/reports/phase3ab-synthetic-replenishment.json', import.meta.url));
const unique = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
const testPassword = 'integration-test-password-932';

type TestAccount = { agent: ReturnType<typeof request.agent>; userId: number; email: string; password: string };
type BusinessSnapshot = {
  products: string; stock_total: string; product_rows: string;
  orders: string; order_rows: string;
  order_items: string; order_item_rows: string;
};
type SavedRecommendation = { recommendation_id: string; recommendation_status: string; synthetic_product_id: string; supplier_id: string };

postgresIntegration('Phase 4D replenishment history PostgreSQL integration (local market_db_test only)', () => {
  let pool: Pool | undefined;
  let adminOne: TestAccount | undefined;
  let adminTwo: TestAccount | undefined;
  let businessBefore: BusinessSnapshot | undefined;
  const createdRunIds: string[] = [];
  const accountIds: number[] = [];
  const tempDirectories: string[] = [];
  let firstRunRecommendations: SavedRecommendation[] = [];

  const app = () => {
    if (!pool) throw new Error('Integration pool is not initialized.');
    return createApp(pool);
  };

  async function snapshotBusinessTables(): Promise<BusinessSnapshot> {
    const result = await pool!.query<BusinessSnapshot>(
      `SELECT (SELECT COUNT(*)::text FROM public.products) AS products,
         (SELECT COALESCE(SUM(stock_quantity), 0)::text FROM public.products) AS stock_total,
         (SELECT md5(COALESCE(string_agg(ctid::text || ':' || xmin::text, ',' ORDER BY ctid), '')) FROM public.products) AS product_rows,
         (SELECT COUNT(*)::text FROM public.orders) AS orders,
         (SELECT md5(COALESCE(string_agg(ctid::text || ':' || xmin::text, ',' ORDER BY ctid), '')) FROM public.orders) AS order_rows,
         (SELECT COUNT(*)::text FROM public.order_items) AS order_items,
         (SELECT md5(COALESCE(string_agg(ctid::text || ':' || xmin::text, ',' ORDER BY ctid), '')) FROM public.order_items) AS order_item_rows`,
    );
    return result.rows[0];
  }

  async function registerAdmin(label: string): Promise<TestAccount> {
    const agent = request.agent(app());
    const sequence = accountIds.length + 1;
    const registered = await agent.post('/api/v1/auth/register').send({
      name: `Synthetic replenishment test ${label}`,
      email: `replenishment_${label}_${unique}@example.test`,
      phone: `+770${String(Date.now()).slice(-8)}${sequence}`,
      address: 'Local integration fixture',
      password: testPassword,
    });
    expect(registered.status).toBe(201);
    const userId = registered.body.user.user_id as number;
    accountIds.push(userId);
    await pool!.query('UPDATE public.users SET role=$1 WHERE user_id=$2', ['admin', userId]);
    return { agent, userId, email: `replenishment_${label}_${unique}@example.test`, password: testPassword };
  }

  async function createRun(agent = adminOne!.agent) {
    const response = await agent.post('/api/v1/admin/replenishment/runs');
    if (response.status === 201) createdRunIds.push(String(response.body.run.run_id));
    return response;
  }

  async function recommendations(runId: string): Promise<SavedRecommendation[]> {
    const response = await adminOne!.agent.get(`/api/v1/admin/replenishment/runs/${runId}/recommendations?page=1&pageSize=100`);
    expect(response.status).toBe(200);
    return response.body.recommendations;
  }

  beforeAll(async () => {
    // The URL has passed strict hostname, explicit port, database, credentials, and routing-override checks
    // before this is the first line that constructs a PostgreSQL Pool.
    pool = new Pool({ connectionString: verifiedTestDatabase!.connectionString });
    const context = await pool.query<{ database_name: string }>('SELECT current_database() AS database_name');
    if (context.rows[0]?.database_name !== 'market_db_test') throw new Error('Refusing integration writes: connected database is not market_db_test.');

    const tracker = await pool.query<{ tracker: string | null }>("SELECT to_regclass('public.schema_migrations')::text AS tracker");
    if (!tracker.rows[0]?.tracker) throw new Error('Migration tracking is absent; apply migration 007 manually to the verified local test database before running this suite.');
    const migration = await pool.query<{ present: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM public.schema_migrations WHERE migration_name=$1) AS present', ['007_replenishment_history.sql'],
    );
    if (!migration.rows[0]?.present) throw new Error('Migration 007 is not recorded in the verified local test database; this suite does not apply migrations.');

    const objectRows = await pool.query<{ object_name: string; present: boolean }>(
      `SELECT object_name, present FROM (VALUES
        ('replenishment_runs', to_regclass('public.replenishment_runs') IS NOT NULL),
        ('replenishment_recommendations', to_regclass('public.replenishment_recommendations') IS NOT NULL),
        ('replenishment_decisions', to_regclass('public.replenishment_decisions') IS NOT NULL),
        ('replenishment_runs_created_idx', to_regclass('public.replenishment_runs_created_idx') IS NOT NULL),
        ('replenishment_recommendations_product_idx', to_regclass('public.replenishment_recommendations_product_idx') IS NOT NULL)
       ) AS objects(object_name, present)`,
    );
    expect(objectRows.rows.every((row) => row.present), 'all migration 007 tables and indexes should exist').toBe(true);
    const constraints = await pool.query<{ conname: string; contype: string; confdeltype: string | null; definition: string }>(
      `SELECT conname, contype, confdeltype, pg_get_constraintdef(oid) AS definition FROM pg_constraint
       WHERE conrelid = ANY(ARRAY[
         'public.replenishment_runs'::regclass,
         'public.replenishment_recommendations'::regclass,
         'public.replenishment_decisions'::regclass
       ])`,
    );
    const constraintMap = new Map(constraints.rows.map((row) => [row.conname, row]));
    for (const required of [
      'replenishment_runs_pkey', 'replenishment_runs_source_check', 'replenishment_runs_review_period_days_check', 'replenishment_runs_forecast_period_check',
      'replenishment_recommendations_pkey', 'replenishment_recommendations_run_index_uq',
      'replenishment_decisions_pkey', 'replenishment_decisions_decision_check', 'replenishment_decisions_recommendation_uq',
    ]) expect(constraintMap.has(required), `missing constraint ${required}`).toBe(true);
    expect(constraintMap.get('replenishment_runs_source_check')?.definition).toContain('SYNTHETIC');
    expect(constraintMap.get('replenishment_runs_forecast_period_check')?.definition).toContain('forecast_start <= forecast_end');
    expect(constraintMap.get('replenishment_recommendations_run_index_uq')?.definition).toContain('(run_id, recommendation_index)');
    expect(constraintMap.get('replenishment_decisions_decision_check')?.definition).toContain('ACCEPTED');
    expect(constraintMap.get('replenishment_decisions_decision_check')?.definition).toContain('REJECTED');
    expect(constraintMap.get('replenishment_runs_created_by_user_id_fkey')?.confdeltype).toBe('n');
    expect(constraintMap.get('replenishment_recommendations_run_id_fkey')?.confdeltype).toBe('r');
    expect(constraintMap.get('replenishment_decisions_recommendation_id_fkey')?.confdeltype).toBe('r');
    expect(constraintMap.get('replenishment_decisions_decided_by_user_id_fkey')?.confdeltype).toBe('n');
    const realProductLinks = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM pg_constraint
       WHERE conrelid='public.replenishment_recommendations'::regclass AND contype='f'
         AND confrelid IN ('public.products'::regclass, 'public.orders'::regclass, 'public.order_items'::regclass)`,
    );
    expect(realProductLinks.rows[0]?.count).toBe(0);

    businessBefore = await snapshotBusinessTables();
    adminOne = await registerAdmin('one');
    adminTwo = await registerAdmin('two');
  }, 30_000);

  afterAll(async () => {
    if (!pool) return;
    try {
      if (createdRunIds.length) {
        await pool.query(`DELETE FROM public.replenishment_decisions WHERE recommendation_id IN
          (SELECT recommendation_id FROM public.replenishment_recommendations WHERE run_id=ANY($1::bigint[]))`, [createdRunIds]);
        await pool.query('DELETE FROM public.replenishment_recommendations WHERE run_id=ANY($1::bigint[])', [createdRunIds]);
        await pool.query('DELETE FROM public.replenishment_runs WHERE run_id=ANY($1::bigint[])', [createdRunIds]);
      }
      if (accountIds.length) {
        await pool.query('DELETE FROM public.audit_logs WHERE user_id=ANY($1::int[])', [accountIds]);
        await pool.query('DELETE FROM public.users WHERE user_id=ANY($1::int[])', [accountIds]);
      }
      if (businessBefore) {
        const businessAfter = await snapshotBusinessTables();
        expect(businessAfter).toEqual(businessBefore);
      }
    } finally {
      await Promise.all(tempDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
      await pool.end();
    }
  });

  it('stores every recommendation snapshot and creates a distinct run for repeated identical requests', async () => {
    const source = JSON.parse(await readFile(reportPath, 'utf8')) as { recommendations: unknown[] };
    const first = await createRun();
    const second = await createRun();
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.run.run_id).not.toBe(second.body.run.run_id);
    expect(first.body.run.source).toBe('SYNTHETIC');
    const [firstRows, secondRows] = await Promise.all([
      recommendations(String(first.body.run.run_id)), recommendations(String(second.body.run.run_id)),
    ]);
    expect(firstRows).toHaveLength(source.recommendations.length);
    expect(secondRows).toHaveLength(source.recommendations.length);
    expect(firstRows.every((row) => row.recommendation_id !== undefined)).toBe(true);
    expect(firstRows.map((row) => row.recommendation_id)).not.toEqual(secondRows.map((row) => row.recommendation_id));
    firstRunRecommendations = firstRows;
    const audit = await pool!.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM public.audit_logs
       WHERE user_id=$1 AND action='REPLENISHMENT_RUN_CREATED' AND details->>'run_id'=ANY($2::text[])`,
      [adminOne!.userId, [String(first.body.run.run_id), String(second.body.run.run_id)]],
    );
    expect(audit.rows[0]?.count).toBe(2);
  });

  it('rolls back a run if a recommendation snapshot fails database length constraints', async () => {
    const report = JSON.parse(await readFile(reportPath, 'utf8')) as { recommendations: Array<Record<string, unknown>> };
    const originalProductId = report.recommendations[0].synthetic_product_id;
    const oversizedProductId = `SYN-${'A'.repeat(70)}`;
    for (const recommendation of report.recommendations) {
      if (recommendation.synthetic_product_id === originalProductId) recommendation.synthetic_product_id = oversizedProductId;
    }
    const directory = await mkdtemp(join(tmpdir(), 'marketkz-replenishment-integration-'));
    tempDirectories.push(directory);
    const invalidReport = join(directory, 'oversized-synthetic-id.json');
    await writeFile(invalidReport, JSON.stringify(report), 'utf8');
    const beforeRuns = await pool!.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM public.replenishment_runs');
    const beforeAudit = await pool!.query<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM public.audit_logs WHERE user_id=$1 AND action='REPLENISHMENT_RUN_CREATED'", [adminOne!.userId],
    );
    const invalidAgent = request.agent(createApp(pool!, { replenishmentDemoReportPath: invalidReport }));
    expect((await invalidAgent.post('/api/v1/auth/login').send({ email: adminOne!.email, password: adminOne!.password })).status).toBe(200);
    const response = await invalidAgent.post('/api/v1/admin/replenishment/runs');
    expect(response.status).toBe(500);
    const afterRuns = await pool!.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM public.replenishment_runs');
    const afterAudit = await pool!.query<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM public.audit_logs WHERE user_id=$1 AND action='REPLENISHMENT_RUN_CREATED'", [adminOne!.userId],
    );
    expect(afterRuns.rows[0]?.count).toBe(beforeRuns.rows[0]?.count);
    expect(afterAudit.rows[0]?.count).toBe(beforeAudit.rows[0]?.count);
  });

  it('paginates history and scopes recommendation snapshots to their run', async () => {
    const created = await createRun();
    const otherCreated = await createRun();
    expect(created.status).toBe(201);
    expect(otherCreated.status).toBe(201);
    const runId = String(created.body.run.run_id);
    const otherRunId = String(otherCreated.body.run.run_id);
    expect(otherRunId).not.toBe(runId);
    const [pageOne, pageTwo, scoped, otherScoped, missing] = await Promise.all([
      adminOne!.agent.get('/api/v1/admin/replenishment/runs?page=1&pageSize=1'),
      adminOne!.agent.get('/api/v1/admin/replenishment/runs?page=2&pageSize=1'),
      adminOne!.agent.get(`/api/v1/admin/replenishment/runs/${runId}/recommendations?page=1&pageSize=100`),
      adminOne!.agent.get(`/api/v1/admin/replenishment/runs/${otherRunId}/recommendations?page=1&pageSize=100`),
      adminOne!.agent.get('/api/v1/admin/replenishment/runs/9223372036854775807/recommendations'),
    ]);
    expect(pageOne.status).toBe(200); expect(pageTwo.status).toBe(200);
    expect(pageOne.body.runs).toHaveLength(1); expect(pageTwo.body.runs).toHaveLength(1);
    expect(pageOne.body.runs[0].run_id).not.toBe(pageTwo.body.runs[0].run_id);
    expect(scoped.status).toBe(200); expect(scoped.body.run_id).toBe(runId);
    expect(otherScoped.status).toBe(200); expect(otherScoped.body.run_id).toBe(otherRunId);
    expect(scoped.body.recommendations.every((row: { recommendation_id: string }) => row.recommendation_id)).toBe(true);
    expect(missing.status).toBe(404);
    const firstIds = scoped.body.recommendations.map((row: { recommendation_id: string }) => row.recommendation_id);
    const secondIds = otherScoped.body.recommendations.map((row: { recommendation_id: string }) => row.recommendation_id);
    expect(firstIds.length).toBeGreaterThan(0);
    expect(secondIds.length).toBe(firstIds.length);
    expect(firstIds.some((id: string) => secondIds.includes(id))).toBe(false);
  });

  it('persists both decisions, preserves the original same-decision record, and rejects an opposite decision', async () => {
    const eligible = firstRunRecommendations.filter((row) => row.recommendation_status === 'PURCHASE_RECOMMENDED');
    expect(eligible.length).toBeGreaterThanOrEqual(3);
    const [accepted, rejected] = eligible;
    const acceptedPath = `/api/v1/admin/replenishment/recommendations/${accepted.recommendation_id}/decision`;
    const first = await adminOne!.agent.patch(acceptedPath).send({ decision: 'ACCEPTED' });
    expect(first.status).toBe(200);
    const original = await pool!.query<{ decided_at: string; decided_by_user_id: number }>(
      'SELECT decided_at::text AS decided_at, decided_by_user_id FROM public.replenishment_decisions WHERE recommendation_id=$1', [accepted.recommendation_id],
    );
    const retry = await adminTwo!.agent.patch(acceptedPath).send({ decision: 'ACCEPTED' });
    expect(retry.status).toBe(200); expect(retry.body.already_recorded).toBe(true);
    const afterRetry = await pool!.query<{ decided_at: string; decided_by_user_id: number }>(
      'SELECT decided_at::text AS decided_at, decided_by_user_id FROM public.replenishment_decisions WHERE recommendation_id=$1', [accepted.recommendation_id],
    );
    expect(afterRetry.rows[0]).toEqual(original.rows[0]);
    expect(afterRetry.rows[0]?.decided_by_user_id).toBe(adminOne!.userId);
    expect((await adminTwo!.agent.patch(acceptedPath).send({ decision: 'REJECTED' })).status).toBe(409);

    const rejectedResponse = await adminTwo!.agent.patch(`/api/v1/admin/replenishment/recommendations/${rejected.recommendation_id}/decision`).send({ decision: 'REJECTED' });
    expect(rejectedResponse.status).toBe(200);
    const persisted = await pool!.query<{ decision: string }>(
      'SELECT decision FROM public.replenishment_decisions WHERE recommendation_id=$1', [rejected.recommendation_id],
    );
    expect(persisted.rows[0]?.decision).toBe('REJECTED');
    const actionCount = await pool!.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM public.audit_logs
       WHERE user_id=$1 AND action='REPLENISHMENT_DECISION_RECORDED' AND details->>'recommendation_id'=$2`,
      [adminOne!.userId, accepted.recommendation_id],
    );
    expect(actionCount.rows[0]?.count).toBe(1);
  });

  it('serializes concurrent conflicting decisions and commits decision with its audit event', async () => {
    const eligible = firstRunRecommendations.filter((row) => row.recommendation_status === 'PURCHASE_RECOMMENDED');
    const candidate = eligible[2];
    const path = `/api/v1/admin/replenishment/recommendations/${candidate.recommendation_id}/decision`;
    const [accept, reject] = await Promise.all([
      adminOne!.agent.patch(path).send({ decision: 'ACCEPTED' }),
      adminTwo!.agent.patch(path).send({ decision: 'REJECTED' }),
    ]);
    expect([accept.status, reject.status].sort()).toEqual([200, 409]);
    const decision = await pool!.query<{ decision: string; decided_by_user_id: number }>(
      'SELECT decision, decided_by_user_id FROM public.replenishment_decisions WHERE recommendation_id=$1', [candidate.recommendation_id],
    );
    expect(decision.rows).toHaveLength(1);
    const audit = await pool!.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM public.audit_logs
       WHERE action='REPLENISHMENT_DECISION_RECORDED' AND details->>'recommendation_id'=$1`, [candidate.recommendation_id],
    );
    expect(audit.rows[0]?.count).toBe(1);
  });

  it('rolls back a decision if its audit insert fails inside the transaction', async () => {
    const candidate = firstRunRecommendations.find((row) => row.recommendation_status === 'PURCHASE_RECOMMENDED' &&
      !firstRunRecommendations.slice(0, 3).some((prior) => prior.recommendation_id === row.recommendation_id))!;
    const failingPool = {
      query: pool!.query.bind(pool),
      connect: async () => {
        const client = await pool!.connect();
        return {
          query: async (sql: string, values?: unknown[]) => {
            if (sql.includes('INSERT INTO audit_logs')) throw new Error('simulated audit insertion failure');
            return client.query(sql, values);
          },
          release: () => client.release(),
        } as unknown as PoolClient;
      },
    } as unknown as Pool;
    const path = `/api/v1/admin/replenishment/recommendations/${candidate.recommendation_id}/decision`;
    const failingAgent = request.agent(createApp(failingPool));
    expect((await failingAgent.post('/api/v1/auth/login').send({ email: adminOne!.email, password: adminOne!.password })).status).toBe(200);
    const beforeDecision = await pool!.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM public.replenishment_decisions WHERE recommendation_id=$1', [candidate.recommendation_id],
    );
    const beforeEvent = await pool!.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM public.audit_logs
       WHERE action='REPLENISHMENT_DECISION_RECORDED' AND details->>'recommendation_id'=$1`, [candidate.recommendation_id],
    );
    const response = await failingAgent.patch(path).send({ decision: 'ACCEPTED' });
    expect(response.status).toBe(500);
    const afterDecision = await pool!.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM public.replenishment_decisions WHERE recommendation_id=$1', [candidate.recommendation_id],
    );
    const afterEvent = await pool!.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM public.audit_logs
       WHERE action='REPLENISHMENT_DECISION_RECORDED' AND details->>'recommendation_id'=$1`, [candidate.recommendation_id],
    );
    expect(afterDecision.rows[0]?.count).toBe(beforeDecision.rows[0]?.count);
    expect(afterEvent.rows[0]?.count).toBe(beforeEvent.rows[0]?.count);
  });
});
