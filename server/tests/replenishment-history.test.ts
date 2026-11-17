import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Pool, PoolClient } from 'pg';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, SESSION_COOKIE_NAME } from '../src/app.js';

const admin = { user_id: 4, name: 'Admin', email: 'admin@example.kz', phone: 'x', address: null, role: 'admin' as const };
const user = { ...admin, user_id: 5, role: 'user' as const };
const token = Buffer.from('s'.repeat(32)).toString('base64url');
const cookie = `${SESSION_COOKIE_NAME}=${token}`;
const reportPath = fileURLToPath(new URL('../../ml/sales_prediction/reports/phase3ab-synthetic-replenishment.json', import.meta.url));

type FakeState = {
  runs: Array<Record<string, unknown>>; recommendations: Array<Record<string, any>>; decisions: Map<string, Record<string, any>>;
  audit: Array<Record<string, unknown>>; transactionSql: string[]; failRecommendationInsert: boolean; nextRun: number;
};

function fakePool(session: typeof admin | typeof user | null, initial: Partial<FakeState> = {}) {
  const state: FakeState = { runs: [], recommendations: [], decisions: new Map(), audit: [], transactionSql: [], failRecommendationInsert: false, nextRun: 1, ...initial };
  const poolQuery = vi.fn(async (sql: string, values: unknown[] = []) => {
    if (sql.includes('FROM user_sessions')) return { rows: session ? [session] : [] };
    if (sql.includes('COUNT(*)::int AS total FROM public.replenishment_runs')) return { rows: [{ total: state.runs.length }] };
    if (sql.includes('FROM public.replenishment_runs r')) {
      return { rows: state.runs.slice().reverse().map(run => ({ ...run, recommendation_count: 1, accepted_count: 0, rejected_count: 0, pending_count: 1 })) };
    }
    if (sql.includes('SELECT run_id FROM public.replenishment_runs')) return { rows: state.runs.some(run => run.run_id === values[0]) ? [{ run_id: values[0] }] : [] };
    if (sql.includes('COUNT(*)::int AS total FROM public.replenishment_recommendations')) return { rows: [{ total: state.recommendations.filter(row => row.run_id === values[0]).length }] };
    if (sql.includes('FROM public.replenishment_recommendations rec')) return { rows: state.recommendations.filter(row => row.run_id === values[0]).map(row => ({ ...row, decision_status: 'PENDING', decided_at: null, decided_by_user_id: null, decided_by_name: null })) };
    throw new Error(`Unexpected pool query: ${sql}`);
  });
  const clientQuery = vi.fn(async (sql: string, values: unknown[] = []) => {
    state.transactionSql.push(sql);
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
    if (sql.includes('INSERT INTO public.replenishment_runs')) {
      const row = { run_id: String(state.nextRun++), created_at: '2026-11-17T12:00:00Z' };
      state.runs.push(row); return { rows: [row] };
    }
    if (sql.includes('INSERT INTO public.replenishment_recommendations')) {
      if (state.failRecommendationInsert) throw new Error('simulated insert failure');
      state.recommendations.push({ recommendation_id: String(state.recommendations.length + 10), run_id: values[0], recommendation_index: values[1], recommendation_snapshot: JSON.parse(String(values[5])) });
      return { rows: [] };
    }
    if (sql.includes('INSERT INTO audit_logs')) {
      const row = { log_id: String(state.audit.length + 1), user_id: values[0], action: values[1], entity_type: values[2], entity_id: values[3], status: values[4], details: JSON.parse(String(values[5])), ip_address: null, created_at: '2026-11-17T12:00:00Z' };
      state.audit.push(row); return { rows: [row] };
    }
    if (sql.includes('FROM public.replenishment_recommendations WHERE recommendation_id=$1 FOR UPDATE')) {
      const row = state.recommendations.find(entry => entry.recommendation_id === values[0]);
      return { rows: row ? [{ recommendation_snapshot: row.recommendation_snapshot, run_id: row.run_id }] : [] };
    }
    if (sql.includes('FROM public.replenishment_decisions WHERE recommendation_id=$1')) {
      const row = state.decisions.get(String(values[0])); return { rows: row ? [row] : [] };
    }
    if (sql.includes('INSERT INTO public.replenishment_decisions')) {
      const row = { decision_id: '55', decision: values[1], decided_at: '2026-11-17T12:00:00Z', decided_by_user_id: values[2] };
      state.decisions.set(String(values[0]), row); return { rows: [row] };
    }
    throw new Error(`Unexpected transaction query: ${sql}`);
  });
  let rowLocked = false;
  const lockWaiters: Array<() => void> = [];
  const connect = vi.fn(async () => {
    let ownsRowLock = false;
    const query = async (sql: string, values?: unknown[]) => {
      if (sql.includes('FOR UPDATE')) {
        if (rowLocked) await new Promise<void>(resolve => lockWaiters.push(resolve));
        else rowLocked = true;
        ownsRowLock = true;
      }
      const result = await clientQuery(sql, values);
      if ((sql === 'COMMIT' || sql === 'ROLLBACK') && ownsRowLock) {
        ownsRowLock = false;
        const next = lockWaiters.shift();
        if (next) next(); else rowLocked = false;
      }
      return result;
    };
    return { query, release: vi.fn() } as unknown as PoolClient;
  });
  return { pool: { query: poolQuery, connect } as unknown as Pool, state, poolQuery, clientQuery, connect };
}

afterEach(() => vi.restoreAllMocks());

describe('replenishment history API', () => {
  it('requires an admin for writes and reads', async () => {
    const unauth = fakePool(null);
    expect((await request(createApp(unauth.pool)).post('/api/v1/admin/replenishment/runs')).status).toBe(401);
    expect(unauth.connect).not.toHaveBeenCalled();
    const nonAdmin = fakePool(user);
    expect((await request(createApp(nonAdmin.pool)).get('/api/v1/admin/replenishment/runs').set('Cookie', cookie)).status).toBe(403);
    expect((await request(createApp(nonAdmin.pool)).post('/api/v1/admin/replenishment/runs').set('Cookie', cookie)).status).toBe(403);
    expect(nonAdmin.connect).not.toHaveBeenCalled();
  });

  it.each([
    ['GET', '/api/v1/admin/replenishment/runs'],
    ['GET', '/api/v1/admin/replenishment/runs/1/recommendations'],
    ['PATCH', '/api/v1/admin/replenishment/recommendations/1/decision'],
  ])('protects %s %s against unauthenticated and non-admin users', async (method, path) => {
    const unauthenticated = fakePool(null);
    const anonResponse = method === 'GET'
      ? await request(createApp(unauthenticated.pool)).get(path)
      : await request(createApp(unauthenticated.pool)).patch(path).send({ decision: 'ACCEPTED' });
    expect(anonResponse.status).toBe(401);
    expect(unauthenticated.connect).not.toHaveBeenCalled();
    const nonAdmin = fakePool(user);
    const userResponse = method === 'GET'
      ? await request(createApp(nonAdmin.pool)).get(path).set('Cookie', cookie)
      : await request(createApp(nonAdmin.pool)).patch(path).set('Cookie', cookie).send({ decision: 'ACCEPTED' });
    expect(userResponse.status).toBe(403);
    expect(nonAdmin.connect).not.toHaveBeenCalled();
  });

  it('creates separate immutable synthetic snapshots and writes audit in each transaction', async () => {
    const fake = fakePool(admin);
    const app = createApp(fake.pool);
    const first = await request(app).post('/api/v1/admin/replenishment/runs').set('Cookie', cookie);
    const second = await request(app).post('/api/v1/admin/replenishment/runs').set('Cookie', cookie);
    const source = JSON.parse(await readFile(reportPath, 'utf8'));
    expect(first.status).toBe(201); expect(second.status).toBe(201);
    expect(first.body.run.run_id).not.toBe(second.body.run.run_id);
    expect(fake.state.runs).toHaveLength(2);
    expect(fake.state.recommendations).toHaveLength(source.recommendations.length * 2);
    expect(fake.state.recommendations.slice(0, source.recommendations.length).map(row => row.recommendation_snapshot)).toEqual(source.recommendations);
    expect(fake.state.audit.map(row => row.action)).toEqual(['REPLENISHMENT_RUN_CREATED', 'REPLENISHMENT_RUN_CREATED']);
    expect(fake.state.transactionSql.filter(sql => sql === 'COMMIT')).toHaveLength(2);
    expect(fake.state.transactionSql).not.toContain('UPDATE products');
  });

  it('rolls back the run when recommendation persistence fails', async () => {
    const fake = fakePool(admin, { failRecommendationInsert: true });
    const response = await request(createApp(fake.pool)).post('/api/v1/admin/replenishment/runs').set('Cookie', cookie);
    expect(response.status).toBe(500);
    expect(fake.state.transactionSql).toContain('ROLLBACK');
    expect(fake.state.transactionSql).not.toContain('COMMIT');
    expect(fake.state.audit).toHaveLength(0);
  });

  it('rejects a non-empty client report body instead of accepting caller supplied snapshots', async () => {
    const fake = fakePool(admin);
    const response = await request(createApp(fake.pool)).post('/api/v1/admin/replenishment/runs').set('Cookie', cookie).send({ source: 'SYNTHETIC' });
    expect(response.status).toBe(400);
    expect(fake.connect).not.toHaveBeenCalled();
  });

  it('returns a safe error rather than snapshotting a malformed authoritative report', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'marketkz-replenishment-history-'));
    try {
      const path = join(directory, 'invalid.json');
      await writeFile(path, JSON.stringify({ metadata: { source: 'REAL' }, recommendations: [] }), 'utf8');
      const fake = fakePool(admin);
      const response = await request(createApp(fake.pool, { replenishmentDemoReportPath: path })).post('/api/v1/admin/replenishment/runs').set('Cookie', cookie);
      expect(response.status).toBe(503);
      expect(response.body).toEqual({ error: 'Демонстрационный отчёт временно недоступен.' });
      expect(fake.connect).not.toHaveBeenCalled();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('returns bounded run history and run-scoped recommendations', async () => {
    const fake = fakePool(admin, { runs: [{ run_id: '9' }], recommendations: [{ recommendation_id: '20', run_id: '9', recommendation_index: 0, recommendation_snapshot: { synthetic_product_id: 'SYN-P1' } }] });
    const app = createApp(fake.pool);
    const history = await request(app).get('/api/v1/admin/replenishment/runs?page=1&pageSize=10').set('Cookie', cookie);
    const detail = await request(app).get('/api/v1/admin/replenishment/runs/9/recommendations').set('Cookie', cookie);
    const invalid = await request(app).get('/api/v1/admin/replenishment/runs/9/recommendations?pageSize=1000').set('Cookie', cookie);
    const missing = await request(app).get('/api/v1/admin/replenishment/runs/10/recommendations').set('Cookie', cookie);
    expect(history.status).toBe(200); expect(history.body.runs[0].run_id).toBe('9');
    expect(detail.body.recommendations[0]).toMatchObject({ synthetic_product_id: 'SYN-P1', decision_status: 'PENDING' });
    expect(invalid.status).toBe(400); expect(missing.status).toBe(404);
  });

  it('records only eligible decisions, preserves same-decision retries, and rejects the opposite decision', async () => {
    const row = (id: string, recommendation_status: string) => ({ recommendation_id: id, run_id: '1', recommendation_index: 0, recommendation_snapshot: { recommendation_status } });
    const fake = fakePool(admin, { recommendations: [row('10', 'PURCHASE_RECOMMENDED'), row('11', 'NO_PURCHASE_NEEDED')] });
    const app = createApp(fake.pool);
    const ineligible = await request(app).patch('/api/v1/admin/replenishment/recommendations/11/decision').set('Cookie', cookie).send({ decision: 'ACCEPTED' });
    const created = await request(app).patch('/api/v1/admin/replenishment/recommendations/10/decision').set('Cookie', cookie).send({ decision: 'ACCEPTED' });
    fake.state.decisions.set('10', { decision_id: '55', decision: 'ACCEPTED', decided_at: '2026-01-01T00:00:00Z', decided_by_user_id: 4 });
    const retry = await request(app).patch('/api/v1/admin/replenishment/recommendations/10/decision').set('Cookie', cookie).send({ decision: 'ACCEPTED' });
    const opposite = await request(app).patch('/api/v1/admin/replenishment/recommendations/10/decision').set('Cookie', cookie).send({ decision: 'REJECTED' });
    expect(ineligible.status).toBe(400); expect(created.status).toBe(200); expect(retry.body).toMatchObject({ already_recorded: true, decision: { decided_at: '2026-01-01T00:00:00Z', decided_by_user_id: 4 } });
    expect(opposite.status).toBe(409); expect(fake.state.audit).toHaveLength(1);
  });

  it('records REJECTED decisions and validates missing recommendations and malformed decisions', async () => {
    const fake = fakePool(admin, { recommendations: [{ recommendation_id: '13', run_id: '1', recommendation_index: 0, recommendation_snapshot: { recommendation_status: 'PURCHASE_RECOMMENDED' } }] });
    const app = createApp(fake.pool);
    const rejected = await request(app).patch('/api/v1/admin/replenishment/recommendations/13/decision').set('Cookie', cookie).send({ decision: 'REJECTED' });
    const missing = await request(app).patch('/api/v1/admin/replenishment/recommendations/999/decision').set('Cookie', cookie).send({ decision: 'ACCEPTED' });
    const invalid = await request(app).patch('/api/v1/admin/replenishment/recommendations/13/decision').set('Cookie', cookie).send({ decision: 'MAYBE' });
    expect(rejected.status).toBe(200); expect(rejected.body.decision.decision).toBe('REJECTED');
    expect(missing.status).toBe(404); expect(invalid.status).toBe(400);
    expect(fake.state.audit).toHaveLength(1);
    expect(fake.state.decisions.get('13')?.decided_at).toBe('2026-11-17T12:00:00Z');
  });

  it('serializes concurrent conflicting decisions so only one can be recorded', async () => {
    const fake = fakePool(admin, { recommendations: [{ recommendation_id: '12', run_id: '1', recommendation_index: 0, recommendation_snapshot: { recommendation_status: 'PURCHASE_RECOMMENDED' } }] });
    const app = createApp(fake.pool);
    const [accept, reject] = await Promise.all([
      request(app).patch('/api/v1/admin/replenishment/recommendations/12/decision').set('Cookie', cookie).send({ decision: 'ACCEPTED' }),
      request(app).patch('/api/v1/admin/replenishment/recommendations/12/decision').set('Cookie', cookie).send({ decision: 'REJECTED' }),
    ]);
    expect([accept.status, reject.status].sort()).toEqual([200, 409]);
    expect(fake.state.decisions.size).toBe(1);
    expect(fake.state.audit).toHaveLength(1);
    expect(fake.clientQuery.mock.calls.filter(([sql]) => String(sql).includes('FOR UPDATE'))).toHaveLength(2);
  });

  it('does not invoke Python or issue writes to marketplace stock or order tables', async () => {
    const fake = fakePool(admin);
    const response = await request(createApp(fake.pool)).post('/api/v1/admin/replenishment/runs').set('Cookie', cookie);
    expect(response.status).toBe(201);
    const writes = fake.state.transactionSql.filter(sql => /\b(INSERT|UPDATE|DELETE)\b/i.test(sql)).join('\n');
    expect(writes).not.toMatch(/\b(products|orders|order_items|stock_quantity)\b/i);
    expect(fake.state.transactionSql.some(sql => /python|spawn|execfile/i.test(sql))).toBe(false);
  });
});
