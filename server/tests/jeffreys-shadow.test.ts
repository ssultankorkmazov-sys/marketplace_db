import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import {
  DEFAULT_JEFFREYS_SHADOW_CONFIG,
  getJeffreysShadowWindowBounds,
  loadJeffreysShadowConfig,
  processJeffreysShadowTick,
  startJeffreysShadowProcessor,
  type JeffreysShadowConfig,
} from '../src/jeffreysShadow.js';

const evaluationAt = '2026-11-16T00:00:00.000Z';
const config: JeffreysShadowConfig = {
  ...DEFAULT_JEFFREYS_SHADOW_CONFIG,
  baselineWindowSeconds: 100,
  currentWindowSeconds: 20,
  evaluationCadenceSeconds: 20,
  allowedLatenessSeconds: 5,
  minimumBaselineObservations: 50,
  minimumCurrentObservations: 20,
  maxSubjectsPerTick: 10,
  maxEventsPerWindow: 200,
  pollIntervalMs: 1000,
};

function makeFakePool(options: { lock?: boolean; failEvaluationInsert?: boolean; baseline?: string[]; current?: string[] } = {}) {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  let state: { profile_version: string; configuration_signature: string; next_evaluation_at: Date; last_subject_user_id: number | null; verification_pass: boolean } | null = null;
  let beforeTransaction: typeof state = null;
  let lockHeld = false;
  let failed = false;
  const pool = {
    async connect() {
      let ownsLock = false;
      const client = {
        async query(sql: string, values?: unknown[]) {
          calls.push({ sql, values });
          if (sql === 'BEGIN') beforeTransaction = state ? { ...state } : null;
          if (sql === 'ROLLBACK') state = beforeTransaction ? { ...beforeTransaction } : null;
          if ((sql === 'COMMIT' || sql === 'ROLLBACK') && ownsLock) lockHeld = false;
          if (sql.includes('pg_try_advisory_xact_lock')) {
            const acquired = options.lock === false ? false : !lockHeld;
            if (acquired) { lockHeld = true; ownsLock = true; }
            return { rows: [{ acquired }] };
          }
          if (sql.includes('date_bin(')) return { rows: [{ latest_due_at: new Date(evaluationAt) }] };
          if (sql.includes('INSERT INTO public.jeffreys_shadow_checkpoint')) {
            if (!state) state = {
              profile_version: String(values?.[0]), configuration_signature: String(values?.[1]),
              next_evaluation_at: new Date(String(values?.[2])), last_subject_user_id: null, verification_pass: false,
            };
            return { rows: [] };
          }
          if (sql.includes('FROM public.jeffreys_shadow_checkpoint WHERE singleton_id=1')) return { rows: state ? [{ ...state }] : [] };
          if (sql.includes('GROUP BY user_id ORDER BY user_id')) {
            return { rows: state?.last_subject_user_id === null ? [{ user_id: 77 }] : [] };
          }
          if (sql.includes('SELECT action') && sql.includes('FROM public.audit_logs')) {
            const start = new Date(String(values?.[1])).getTime();
            const currentStart = new Date(evaluationAt).getTime() - config.currentWindowSeconds * 1000;
            const actions = start < currentStart ? options.baseline ?? Array.from({ length: 50 }, (_, i) => i < 30 ? 'LOGIN_SUCCESS' : i < 49 ? 'ORDER_CREATED' : 'UNKNOWN_ACTION')
              : options.current ?? Array.from({ length: 20 }, (_, i) => i < 12 ? 'LOGIN_FAILED' : 'ORDER_CREATED');
            return { rows: actions.map((action) => ({ action })) };
          }
          if (sql.includes('INSERT INTO public.jeffreys_shadow_evaluations')) {
            if (options.failEvaluationInsert && !failed) { failed = true; throw new Error('simulated storage failure'); }
            return { rows: [] };
          }
          if (sql.includes('SET last_subject_user_id=$1')) {
            if (state) state.last_subject_user_id = Number(values?.[0]);
            return { rows: [] };
          }
          if (sql.includes('SET next_evaluation_at=next_evaluation_at')) {
            if (state) { state.next_evaluation_at = new Date(state.next_evaluation_at.getTime() + config.evaluationCadenceSeconds * 1000); state.last_subject_user_id = null; state.verification_pass = false; }
            return { rows: [] };
          }
          if (sql.includes('SET last_subject_user_id=NULL, verification_pass=TRUE')) {
            if (state) { state.last_subject_user_id = null; state.verification_pass = true; }
            return { rows: [] };
          }
          return { rows: [] };
        },
        release() {},
      };
      return client;
    },
  };
  return { pool: pool as unknown as Pool, calls, getState: () => state };
}

afterEach(() => vi.restoreAllMocks());

describe('Jeffreys shadow processor', () => {
  it('loads explicit versioned windows, minima, cadence, and bounded work settings', () => {
    expect(loadJeffreysShadowConfig({
      JEFFREYS_SHADOW_PROFILE_VERSION: 'demo-v2',
      JEFFREYS_SHADOW_BASELINE_WINDOW_SECONDS: '3600',
      JEFFREYS_SHADOW_CURRENT_WINDOW_SECONDS: '600',
      JEFFREYS_SHADOW_EVALUATION_CADENCE_SECONDS: '600',
      JEFFREYS_SHADOW_MIN_BASELINE_OBSERVATIONS: '50',
      JEFFREYS_SHADOW_MIN_CURRENT_OBSERVATIONS: '20',
    })).toMatchObject({ profileVersion: 'demo-v2', baselineWindowSeconds: 3600, currentWindowSeconds: 600, evaluationCadenceSeconds: 600, minimumBaselineObservations: 50, minimumCurrentObservations: 20 });
    expect(() => loadJeffreysShadowConfig({ JEFFREYS_SHADOW_PROFILE_VERSION: 'bad version' })).toThrow(/PROFILE_VERSION/);
  });

  it('creates chronological non-overlapping baseline/current boundaries', () => {
    const bounds = getJeffreysShadowWindowBounds(evaluationAt, config);
    expect(bounds).toEqual({
      baselineStart: new Date('2026-11-15T23:58:00.000Z'),
      baselineEnd: new Date('2026-11-15T23:59:40.000Z'),
      currentStart: new Date('2026-11-15T23:59:40.000Z'),
      currentEnd: new Date(evaluationAt),
    });
  });

  it('reuses the fixed action mapping, stores contributions only for sufficient data, and never touches the rule queue or incidents', async () => {
    const fake = makeFakePool();
    const result = await processJeffreysShadowTick(fake.pool, config);
    expect(result).toMatchObject({ acquired: true, evaluatedSubjects: 1, evaluationAt, advancedCheckpoint: false });
    const insert = fake.calls.find(({ sql }) => sql.includes('INSERT INTO public.jeffreys_shadow_evaluations'))!;
    const values = insert.values!;
    expect(values[0]).toBe(config.profileVersion);
    expect(values[1]).toBe(77);
    expect(values[5]).toBe(50);
    expect(values[6]).toBe(20);
    const baselineDistribution = JSON.parse(String(values[7])) as Record<string, number>;
    expect(baselineDistribution.ORDER).toBeGreaterThan(0);
    expect(baselineDistribution.OTHER).toBeGreaterThan(0);
    expect(values[11]).toBe('SUFFICIENT_DATA');
    expect(Number(values[9])).toBeGreaterThan(0);
    expect(insert.sql).toContain('ON CONFLICT (profile_version, subject_user_id, evaluated_at) DO UPDATE');
    expect(fake.calls.some(({ sql }) => /anomaly_event_queue|anomaly_incidents|INSERT INTO public\.audit_logs|UPDATE public\.audit_logs/i.test(sql))).toBe(false);
  });

  it('records insufficient sample windows without a divergence decision', async () => {
    const fake = makeFakePool({ baseline: ['LOGIN_SUCCESS'], current: ['ORDER_CREATED'] });
    await processJeffreysShadowTick(fake.pool, config);
    const values = fake.calls.find(({ sql }) => sql.includes('INSERT INTO public.jeffreys_shadow_evaluations'))!.values!;
    expect(values[11]).toBe('INSUFFICIENT_DATA');
    expect(values[9]).toBeNull();
    expect(values[10]).toBeNull();
  });

  it('re-evaluates the same slot idempotently during its late-arrival verification pass', async () => {
    const fake = makeFakePool();
    const first = await processJeffreysShadowTick(fake.pool, config);
    expect(first.advancedCheckpoint).toBe(false);
    const verification = await processJeffreysShadowTick(fake.pool, config);
    expect(verification).toMatchObject({ evaluationAt, advancedCheckpoint: true });
    const next = await processJeffreysShadowTick(fake.pool, config);
    expect(next.evaluatedSubjects).toBe(0);
    expect(fake.calls.filter(({ sql }) => sql.includes('INSERT INTO public.jeffreys_shadow_evaluations'))).toHaveLength(2);
    expect(fake.calls.filter(({ sql }) => sql.includes('ON CONFLICT (profile_version, subject_user_id, evaluated_at) DO UPDATE'))).toHaveLength(2);
  });

  it('caps per-window reads and stores a non-scored work-limit status', async () => {
    const fake = makeFakePool({ baseline: Array.from({ length: config.maxEventsPerWindow + 1 }, () => 'LOGIN_SUCCESS') });
    await processJeffreysShadowTick(fake.pool, config);
    const values = fake.calls.find(({ sql }) => sql.includes('INSERT INTO public.jeffreys_shadow_evaluations'))!.values!;
    expect(values[11]).toBe('WORK_LIMIT_EXCEEDED');
    expect(values[12]).toBe(true);
    expect(values[9]).toBeNull();
  });

  it('uses an advisory lock so a concurrent instance does no work', async () => {
    const fake = makeFakePool({ lock: false });
    await expect(processJeffreysShadowTick(fake.pool, config)).resolves.toEqual({
      acquired: false, evaluatedSubjects: 0, evaluationAt: null, advancedCheckpoint: false,
    });
    expect(fake.calls.some(({ sql }) => sql.includes('FROM public.audit_logs'))).toBe(false);
  });

  it('lets only one concurrent processor instance claim the scheduled tick', async () => {
    const fake = makeFakePool();
    const results = await Promise.all([
      processJeffreysShadowTick(fake.pool, config),
      processJeffreysShadowTick(fake.pool, config),
    ]);
    expect(results.filter((result) => result.acquired)).toHaveLength(1);
    expect(fake.calls.filter(({ sql }) => sql.includes('INSERT INTO public.jeffreys_shadow_evaluations'))).toHaveLength(1);
  });

  it('rolls back result and checkpoint progress together and retries safely', async () => {
    const fake = makeFakePool({ failEvaluationInsert: true });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(processJeffreysShadowTick(fake.pool, config)).rejects.toThrow('simulated storage failure');
    expect(fake.calls.some(({ sql }) => sql === 'ROLLBACK')).toBe(true);
    expect(fake.getState()).toBeNull();
    await expect(processJeffreysShadowTick(fake.pool, config)).resolves.toMatchObject({ evaluatedSubjects: 1, advancedCheckpoint: false });
    expect(fake.calls.filter(({ sql }) => sql.includes('INSERT INTO public.jeffreys_shadow_evaluations'))).toHaveLength(2);
    expect(errorSpy).toHaveBeenCalledWith('Jeffreys shadow tick failed; checkpoint was not advanced.');
  });

  it('does no database work when disabled', async () => {
    const query = vi.fn();
    const processor = startJeffreysShadowProcessor({ connect: query } as unknown as Pool, false, config);
    await processor.close();
    expect(query).not.toHaveBeenCalled();
  });
});
