import type { Pool, PoolClient } from 'pg';
import {
  calculateJeffreysDivergence,
  type ActionCategory,
  type JeffreysDistributionResult,
} from './jeffreys.js';

const SHADOW_LOCK_KEY = 6_771_204_081;
const SLOT_ANCHOR = '2000-01-01T00:00:00.000Z';

export interface JeffreysShadowConfig {
  profileVersion: string;
  baselineWindowSeconds: number;
  currentWindowSeconds: number;
  evaluationCadenceSeconds: number;
  allowedLatenessSeconds: number;
  alpha: number;
  minimumBaselineObservations: number;
  minimumCurrentObservations: number;
  maxSubjectsPerTick: number;
  maxEventsPerWindow: number;
  pollIntervalMs: number;
}

export interface JeffreysShadowTickResult {
  acquired: boolean;
  evaluatedSubjects: number;
  evaluationAt: string | null;
  advancedCheckpoint: boolean;
}

export const DEFAULT_JEFFREYS_SHADOW_CONFIG: Readonly<JeffreysShadowConfig> = Object.freeze({
  profileVersion: 'shadow-v1',
  baselineWindowSeconds: 30 * 24 * 60 * 60,
  currentWindowSeconds: 24 * 60 * 60,
  evaluationCadenceSeconds: 24 * 60 * 60,
  allowedLatenessSeconds: 60 * 60,
  alpha: 0.5,
  minimumBaselineObservations: 50,
  minimumCurrentObservations: 20,
  maxSubjectsPerTick: 25,
  maxEventsPerWindow: 2_000,
  pollIntervalMs: 60_000,
});

export type ShadowEvaluationStatus =
  | 'SUFFICIENT_DATA'
  | 'INSUFFICIENT_DATA'
  | 'WORK_LIMIT_EXCEEDED'
  | 'EVALUATION_ERROR';

interface ShadowCheckpoint {
  profile_version: string;
  configuration_signature: string;
  next_evaluation_at: Date | string;
  last_subject_user_id: number | null;
  verification_pass: boolean;
}

interface SubjectRow { user_id: number }
interface ActionRows { action: string }
interface DueRow { latest_due_at: Date | string }

function positiveInteger(name: string, value: string | undefined, fallback: number, max: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  if (!/^\d+$/.test(value.trim())) throw new Error(`${name} must be a positive integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
    throw new Error(`${name} must be between 1 and ${max}.`);
  }
  return parsed;
}

export function loadJeffreysShadowConfig(env: NodeJS.ProcessEnv = process.env): JeffreysShadowConfig {
  const profileVersion = env.JEFFREYS_SHADOW_PROFILE_VERSION?.trim() || DEFAULT_JEFFREYS_SHADOW_CONFIG.profileVersion;
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(profileVersion)) {
    throw new Error('JEFFREYS_SHADOW_PROFILE_VERSION must contain 1-64 letters, digits, dots, underscores, or hyphens.');
  }
  const alphaRaw = env.JEFFREYS_SHADOW_ALPHA?.trim();
  const alpha = alphaRaw ? Number(alphaRaw) : DEFAULT_JEFFREYS_SHADOW_CONFIG.alpha;
  if (!Number.isFinite(alpha) || alpha <= 0 || alpha > 10) throw new Error('JEFFREYS_SHADOW_ALPHA must be greater than 0 and at most 10.');
  return {
    profileVersion,
    baselineWindowSeconds: positiveInteger('JEFFREYS_SHADOW_BASELINE_WINDOW_SECONDS', env.JEFFREYS_SHADOW_BASELINE_WINDOW_SECONDS, DEFAULT_JEFFREYS_SHADOW_CONFIG.baselineWindowSeconds, 31_536_000),
    currentWindowSeconds: positiveInteger('JEFFREYS_SHADOW_CURRENT_WINDOW_SECONDS', env.JEFFREYS_SHADOW_CURRENT_WINDOW_SECONDS, DEFAULT_JEFFREYS_SHADOW_CONFIG.currentWindowSeconds, 2_592_000),
    evaluationCadenceSeconds: positiveInteger('JEFFREYS_SHADOW_EVALUATION_CADENCE_SECONDS', env.JEFFREYS_SHADOW_EVALUATION_CADENCE_SECONDS, DEFAULT_JEFFREYS_SHADOW_CONFIG.evaluationCadenceSeconds, 2_592_000),
    allowedLatenessSeconds: positiveInteger('JEFFREYS_SHADOW_ALLOWED_LATENESS_SECONDS', env.JEFFREYS_SHADOW_ALLOWED_LATENESS_SECONDS, DEFAULT_JEFFREYS_SHADOW_CONFIG.allowedLatenessSeconds, 604_800),
    alpha,
    minimumBaselineObservations: positiveInteger('JEFFREYS_SHADOW_MIN_BASELINE_OBSERVATIONS', env.JEFFREYS_SHADOW_MIN_BASELINE_OBSERVATIONS, DEFAULT_JEFFREYS_SHADOW_CONFIG.minimumBaselineObservations, 1_000_000),
    minimumCurrentObservations: positiveInteger('JEFFREYS_SHADOW_MIN_CURRENT_OBSERVATIONS', env.JEFFREYS_SHADOW_MIN_CURRENT_OBSERVATIONS, DEFAULT_JEFFREYS_SHADOW_CONFIG.minimumCurrentObservations, 1_000_000),
    maxSubjectsPerTick: positiveInteger('JEFFREYS_SHADOW_MAX_SUBJECTS_PER_TICK', env.JEFFREYS_SHADOW_MAX_SUBJECTS_PER_TICK, DEFAULT_JEFFREYS_SHADOW_CONFIG.maxSubjectsPerTick, 1_000),
    maxEventsPerWindow: positiveInteger('JEFFREYS_SHADOW_MAX_EVENTS_PER_WINDOW', env.JEFFREYS_SHADOW_MAX_EVENTS_PER_WINDOW, DEFAULT_JEFFREYS_SHADOW_CONFIG.maxEventsPerWindow, 100_000),
    pollIntervalMs: positiveInteger('JEFFREYS_SHADOW_POLL_INTERVAL_MS', env.JEFFREYS_SHADOW_POLL_INTERVAL_MS, DEFAULT_JEFFREYS_SHADOW_CONFIG.pollIntervalMs, 300_000),
  };
}

function validateConfig(config: JeffreysShadowConfig): void {
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(config.profileVersion) ||
      !Number.isFinite(config.alpha) || config.alpha <= 0 || config.alpha > 10) {
    throw new Error('Invalid Jeffreys shadow profile configuration.');
  }
  for (const [name, value] of Object.entries(config)) {
    if (name === 'profileVersion' || name === 'alpha') continue;
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid Jeffreys shadow setting: ${name}.`);
  }
  calculateJeffreysDivergence({}, {}, {
    alpha: config.alpha,
    minimumBaselineObservations: config.minimumBaselineObservations,
    minimumCurrentObservations: config.minimumCurrentObservations,
  });
}

function configurationSignature(config: JeffreysShadowConfig): string {
  return JSON.stringify({
    baselineWindowSeconds: config.baselineWindowSeconds,
    currentWindowSeconds: config.currentWindowSeconds,
    evaluationCadenceSeconds: config.evaluationCadenceSeconds,
    allowedLatenessSeconds: config.allowedLatenessSeconds,
    alpha: config.alpha,
    minimumBaselineObservations: config.minimumBaselineObservations,
    minimumCurrentObservations: config.minimumCurrentObservations,
    maxSubjectsPerTick: config.maxSubjectsPerTick,
    maxEventsPerWindow: config.maxEventsPerWindow,
  });
}

export function getJeffreysShadowConfigurationSignature(config: JeffreysShadowConfig): string {
  validateConfig(config);
  return configurationSignature(config);
}

function profileConfig(config: JeffreysShadowConfig): Omit<JeffreysShadowConfig, 'pollIntervalMs'> {
  const { pollIntervalMs: _pollIntervalMs, ...persisted } = config;
  return persisted;
}

async function readActions(
  client: PoolClient,
  userId: number,
  start: Date,
  end: Date,
  limit: number,
): Promise<{ actions: string[]; capped: boolean }> {
  const result = await client.query<ActionRows>(
    `SELECT action
     FROM public.audit_logs
     WHERE user_id=$1 AND created_at >= $2 AND created_at < $3
     ORDER BY created_at, log_id
     LIMIT $4`,
    [userId, start, end, limit + 1],
  );
  return { actions: result.rows.slice(0, limit).map((row) => row.action), capped: result.rows.length > limit };
}

function countsByAction(actions: string[]): Record<string, number> {
  const counts: Record<string, number> = Object.create(null) as Record<string, number>;
  for (const action of actions) counts[action] = (counts[action] ?? 0) + 1;
  return counts;
}

export interface JeffreysShadowWindowBounds {
  baselineStart: Date;
  baselineEnd: Date;
  currentStart: Date;
  currentEnd: Date;
}

/** Uses half-open UTC intervals so adjacent baseline/current windows never overlap. */
export function getJeffreysShadowWindowBounds(evaluationAt: Date | string, config: JeffreysShadowConfig): JeffreysShadowWindowBounds {
  const currentEnd = new Date(evaluationAt);
  if (!Number.isFinite(currentEnd.getTime())) throw new Error('Invalid shadow evaluation timestamp.');
  const currentStart = new Date(currentEnd.getTime() - config.currentWindowSeconds * 1_000);
  const baselineEnd = currentStart;
  const baselineStart = new Date(baselineEnd.getTime() - config.baselineWindowSeconds * 1_000);
  return { baselineStart, baselineEnd, currentStart, currentEnd };
}

function safeEvaluation(
  baselineActions: string[],
  currentActions: string[],
  config: JeffreysShadowConfig,
): { result: JeffreysDistributionResult | null; status: ShadowEvaluationStatus } {
  try {
    const result = calculateJeffreysDivergence(countsByAction(baselineActions), countsByAction(currentActions), config);
    return { result, status: result.status === 'sufficient_data' ? 'SUFFICIENT_DATA' : 'INSUFFICIENT_DATA' };
  } catch {
    // Store the fact that this profile/window could not be evaluated, without
    // including raw actions, user identifiers, or error details in logs/results.
    return { result: null, status: 'EVALUATION_ERROR' };
  }
}

async function persistEvaluation(
  client: PoolClient,
  config: JeffreysShadowConfig,
  userId: number,
  evaluationAt: Date,
  baselineStart: Date,
  currentStart: Date,
  baselineActions: string[],
  currentActions: string[],
  workLimited: boolean,
): Promise<ShadowEvaluationStatus> {
  const calculated = safeEvaluation(baselineActions, currentActions, config);
  const status: ShadowEvaluationStatus = workLimited ? 'WORK_LIMIT_EXCEEDED' : calculated.status;
  const result = calculated.result;
  const scoreAllowed = status === 'SUFFICIENT_DATA' && result !== null;
  const observationsKnown = status !== 'EVALUATION_ERROR';
  const storedBaselineCount = observationsKnown ? baselineActions.length : null;
  const storedCurrentCount = observationsKnown ? currentActions.length : null;
  const capped = workLimited;
  await client.query(
    `INSERT INTO public.jeffreys_shadow_evaluations (
       profile_version, subject_user_id, evaluated_at,
       baseline_start_at, baseline_end_at, current_start_at, current_end_at,
       baseline_observations, current_observations, baseline_distribution, current_distribution,
       divergence, category_contributions, evaluation_status, sample_counts_capped, profile_config
     ) VALUES ($1,$2,$3,$4,$5,$5,$3,$6,$7,$8::jsonb,$9::jsonb,$10,$11::jsonb,$12,$13,$14::jsonb)
     ON CONFLICT (profile_version, subject_user_id, evaluated_at) DO UPDATE SET
       baseline_start_at=EXCLUDED.baseline_start_at, baseline_end_at=EXCLUDED.baseline_end_at,
       current_start_at=EXCLUDED.current_start_at, current_end_at=EXCLUDED.current_end_at,
       baseline_observations=EXCLUDED.baseline_observations, current_observations=EXCLUDED.current_observations,
       baseline_distribution=EXCLUDED.baseline_distribution, current_distribution=EXCLUDED.current_distribution,
       divergence=EXCLUDED.divergence, category_contributions=EXCLUDED.category_contributions,
       evaluation_status=EXCLUDED.evaluation_status, sample_counts_capped=EXCLUDED.sample_counts_capped,
       profile_config=EXCLUDED.profile_config`,
    [
      config.profileVersion, userId, evaluationAt, baselineStart, currentStart,
      storedBaselineCount, storedCurrentCount,
      result?.smoothedBaseline ? JSON.stringify(result.smoothedBaseline) : null,
      result?.smoothedCurrent ? JSON.stringify(result.smoothedCurrent) : null,
      scoreAllowed ? result!.divergence : null,
      scoreAllowed ? JSON.stringify(result!.categoryContributions) : null,
      status, capped, JSON.stringify(profileConfig(config)),
    ],
  );
  return status;
}

async function begin(client: PoolClient): Promise<void> {
  await client.query('BEGIN');
}

/** Reads bounded event windows and atomically persists only shadow measurements and checkpoint progress. */
export async function processJeffreysShadowTick(
  pool: Pool,
  config: JeffreysShadowConfig,
): Promise<JeffreysShadowTickResult> {
  validateConfig(config);
  const client = await pool.connect();
  let inTransaction = false;
  try {
    await begin(client);
    inTransaction = true;
    const lock = await client.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_xact_lock($1::bigint) AS acquired', [SHADOW_LOCK_KEY],
    );
    if (!lock.rows[0]?.acquired) {
      await client.query('COMMIT');
      inTransaction = false;
      return { acquired: false, evaluatedSubjects: 0, evaluationAt: null, advancedCheckpoint: false };
    }

    const signature = configurationSignature(config);
    const due = await client.query<DueRow>(
      `SELECT date_bin(make_interval(secs => $1),
                       statement_timestamp() - make_interval(secs => $2),
                       $3::timestamptz) AS latest_due_at`,
      [config.evaluationCadenceSeconds, config.allowedLatenessSeconds, SLOT_ANCHOR],
    );
    const latestDue = new Date(due.rows[0].latest_due_at);
    await client.query(
      `INSERT INTO public.jeffreys_shadow_checkpoint
       (singleton_id, profile_version, configuration_signature, next_evaluation_at)
       VALUES (1, $1, $2, $3)
       ON CONFLICT (singleton_id) DO NOTHING`, [config.profileVersion, signature, latestDue],
    );
    const checkpointResult = await client.query<ShadowCheckpoint>(
      `SELECT profile_version, configuration_signature, next_evaluation_at, last_subject_user_id, verification_pass
       FROM public.jeffreys_shadow_checkpoint WHERE singleton_id=1 FOR UPDATE`,
    );
    const checkpoint = checkpointResult.rows[0];
    if (!checkpoint) throw new Error('Shadow checkpoint row is unavailable.');
    if (checkpoint.profile_version !== config.profileVersion || checkpoint.configuration_signature !== signature) {
      throw new Error('Jeffreys shadow profile changed; increment JEFFREYS_SHADOW_PROFILE_VERSION before restarting.');
    }
    const evaluationAt = new Date(checkpoint.next_evaluation_at);
    if (evaluationAt > latestDue) {
      await client.query('COMMIT');
      inTransaction = false;
      return { acquired: true, evaluatedSubjects: 0, evaluationAt: null, advancedCheckpoint: false };
    }

    const { currentStart, baselineStart } = getJeffreysShadowWindowBounds(evaluationAt, config);
    const subjects = await client.query<SubjectRow>(
      `SELECT user_id
       FROM public.audit_logs
       WHERE user_id IS NOT NULL AND created_at >= $1 AND created_at < $2
         AND ($3::integer IS NULL OR user_id > $3)
       GROUP BY user_id ORDER BY user_id LIMIT $4`,
      [currentStart, evaluationAt, checkpoint.last_subject_user_id, config.maxSubjectsPerTick + 1],
    );
    const selected = subjects.rows.slice(0, config.maxSubjectsPerTick);
    for (const subject of selected) {
      const baseline = await readActions(client, subject.user_id, baselineStart, currentStart, config.maxEventsPerWindow);
      const current = await readActions(client, subject.user_id, currentStart, evaluationAt, config.maxEventsPerWindow);
      const status = await persistEvaluation(
        client, config, subject.user_id, evaluationAt, baselineStart, currentStart,
        baseline.actions, current.actions, baseline.capped || current.capped,
      );
      if (status === 'EVALUATION_ERROR') console.error('Jeffreys shadow evaluation failed for one subject; a safe status was recorded.');
      await client.query(
        `UPDATE public.jeffreys_shadow_checkpoint
         SET last_subject_user_id=$1, updated_at=NOW() WHERE singleton_id=1`, [subject.user_id],
      );
    }

    let advancedCheckpoint = false;
    if (subjects.rows.length <= config.maxSubjectsPerTick) {
      if (!checkpoint.verification_pass) {
        // A second bounded pass catches out-of-order/late rows that committed
        // while the first account-ID cursor sweep was in progress.
        await client.query(
          `UPDATE public.jeffreys_shadow_checkpoint
           SET last_subject_user_id=NULL, verification_pass=TRUE, updated_at=NOW()
           WHERE singleton_id=1`,
        );
      } else {
        await client.query(
          `UPDATE public.jeffreys_shadow_checkpoint
           SET next_evaluation_at=next_evaluation_at + make_interval(secs => $1),
               last_subject_user_id=NULL, verification_pass=FALSE, updated_at=NOW()
           WHERE singleton_id=1`, [config.evaluationCadenceSeconds],
        );
        advancedCheckpoint = true;
      }
    }
    await client.query('COMMIT');
    inTransaction = false;
    return {
      acquired: true,
      evaluatedSubjects: selected.length,
      evaluationAt: evaluationAt.toISOString(),
      advancedCheckpoint,
    };
  } catch (error) {
    if (inTransaction) await client.query('ROLLBACK').catch(() => undefined);
    // Do not log SQL errors, event contents, or user-level identifiers.
    console.error('Jeffreys shadow tick failed; checkpoint was not advanced.');
    throw error;
  } finally {
    client.release();
  }
}

export function startJeffreysShadowProcessor(
  pool: Pool,
  enabled: boolean,
  config: JeffreysShadowConfig,
): { close(): Promise<void> } {
  if (!enabled) return { async close() {} };
  validateConfig(config);
  let running = false;
  let stopped = false;
  let current: Promise<void> = Promise.resolve();
  const tick = () => {
    if (running || stopped) return;
    running = true;
    current = processJeffreysShadowTick(pool, config)
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => { running = false; });
  };
  const timer = setInterval(tick, config.pollIntervalMs);
  timer.unref();
  tick();
  return { async close() { stopped = true; clearInterval(timer); await current; } };
}

export type JeffreysShadowCategory = ActionCategory;
