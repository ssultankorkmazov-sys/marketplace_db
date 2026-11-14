/** Fixed, ordered categories keep both distributions comparable across calls. */
export const ACTION_CATEGORIES = ['AUTH', 'ORDER', 'ADMIN_DENIED', 'PRODUCT_ADMIN', 'OTHER'] as const;
export type ActionCategory = typeof ACTION_CATEGORIES[number];

/** Initial values only; tune the observation minimums after replay calibration. */
export interface JeffreysConfig {
  alpha: number;
  minimumBaselineObservations: number;
  minimumCurrentObservations: number;
}

export const DEFAULT_JEFFREYS_CONFIG: Readonly<JeffreysConfig> = Object.freeze({
  alpha: 0.5,
  minimumBaselineObservations: 50,
  minimumCurrentObservations: 20,
});

/** Audit actions currently written by server/src/app.ts, grouped by their primary operation. */
export const ACTION_CATEGORY_MAP: Readonly<Record<string, ActionCategory>> = Object.freeze({
  USER_REGISTERED: 'AUTH',
  LOGIN_SUCCESS: 'AUTH',
  LOGIN_FAILED: 'AUTH',
  LOGOUT: 'AUTH',

  ORDER_CREATED: 'ORDER',
  ORDER_CREATE_FAILED: 'ORDER',
  ORDER_STATUS_CHANGED: 'ORDER',

  ADMIN_LOGS_ACCESS_DENIED: 'ADMIN_DENIED',
  ADMIN_ORDERS_ACCESS_DENIED: 'ADMIN_DENIED',
  ADMIN_ANOMALIES_ACCESS_DENIED: 'ADMIN_DENIED',
  PRODUCTS_ACCESS_DENIED: 'ADMIN_DENIED',

  PRODUCT_CREATED: 'PRODUCT_ADMIN',
  PRODUCT_UPDATED: 'PRODUCT_ADMIN',
  PRODUCT_DELETED: 'PRODUCT_ADMIN',
});

export type ActionCounts = Readonly<Record<string, number>>;
export type JeffreysDataStatus = 'sufficient_data' | 'insufficient_data';

export interface JeffreysDistributionResult {
  /** Raw, unbounded Jeffreys divergence in nats. Available for investigation even below minimum sample sizes. */
  divergence: number;
  smoothedBaseline: Readonly<Record<ActionCategory, number>>;
  smoothedCurrent: Readonly<Record<ActionCategory, number>>;
  categoryContributions: Readonly<Record<ActionCategory, number>>;
  baselineObservations: number;
  currentObservations: number;
  status: JeffreysDataStatus;
}

function emptyCounts(): Record<ActionCategory, number> {
  return { AUTH: 0, ORDER: 0, ADMIN_DENIED: 0, PRODUCT_ADMIN: 0, OTHER: 0 };
}

function validateConfig(config: JeffreysConfig): void {
  if (!Number.isFinite(config.alpha) || config.alpha <= 0) {
    throw new Error('Jeffreys alpha must be a finite positive number.');
  }
  if (!Number.isSafeInteger(config.minimumBaselineObservations) || config.minimumBaselineObservations < 1 ||
      !Number.isSafeInteger(config.minimumCurrentObservations) || config.minimumCurrentObservations < 1) {
    throw new Error('Jeffreys minimum observation counts must be positive safe integers.');
  }
}

function categorize(actionCounts: ActionCounts): { counts: Record<ActionCategory, number>; total: number } {
  if (actionCounts === null || typeof actionCounts !== 'object' || Array.isArray(actionCounts)) {
    throw new Error('Action counts must be an object keyed by audit action.');
  }

  const counts = emptyCounts();
  let total = 0;
  for (const [action, count] of Object.entries(actionCounts)) {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error(`Count for audit action ${action} must be a non-negative safe integer.`);
    }
    const category = ACTION_CATEGORY_MAP[action] ?? 'OTHER';
    counts[category] += count;
    total += count;
    if (!Number.isSafeInteger(counts[category]) || !Number.isSafeInteger(total)) {
      throw new Error('Total action count exceeds the safe integer range.');
    }
  }
  return { counts, total };
}

function smooth(counts: Record<ActionCategory, number>, total: number, alpha: number): Record<ActionCategory, number> {
  const denominator = total + alpha * ACTION_CATEGORIES.length;
  return Object.fromEntries(ACTION_CATEGORIES.map((category) => [
    category, (counts[category] + alpha) / denominator,
  ])) as Record<ActionCategory, number>;
}

/**
 * Compares two audit-action count sets using symmetric KL (Jeffreys) divergence.
 * Counts from unmapped/future action names are retained in OTHER. A finite raw
 * score is returned for every input; `status` indicates whether both windows
 * meet their configured minimums and therefore have enough data for evaluation.
 */
export function calculateJeffreysDivergence(
  baselineActionCounts: ActionCounts,
  currentActionCounts: ActionCounts,
  config: JeffreysConfig = DEFAULT_JEFFREYS_CONFIG,
): JeffreysDistributionResult {
  validateConfig(config);
  const baseline = categorize(baselineActionCounts);
  const current = categorize(currentActionCounts);
  const smoothedBaseline = smooth(baseline.counts, baseline.total, config.alpha);
  const smoothedCurrent = smooth(current.counts, current.total, config.alpha);
  const categoryContributions = emptyCounts();
  let divergence = 0;

  for (const category of ACTION_CATEGORIES) {
    const p = smoothedBaseline[category];
    const q = smoothedCurrent[category];
    const contribution = (p - q) * Math.log(p / q);
    categoryContributions[category] = contribution;
    divergence += contribution;
  }

  return {
    divergence,
    smoothedBaseline,
    smoothedCurrent,
    categoryContributions,
    baselineObservations: baseline.total,
    currentObservations: current.total,
    status: baseline.total >= config.minimumBaselineObservations && current.total >= config.minimumCurrentObservations
      ? 'sufficient_data'
      : 'insufficient_data',
  };
}
