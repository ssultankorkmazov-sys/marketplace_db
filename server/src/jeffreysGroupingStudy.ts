import { ACTION_CATEGORIES, ACTION_CATEGORY_MAP, type ActionCategory } from './jeffreys.js';

export type GroupingVariant = 'A_CURRENT' | 'B_DETAILED_AUTH' | 'C_DETAILED_ACTIONS';

export interface GroupingSpec {
  variant: GroupingVariant;
  categories: string[];
  categoryByAction: Readonly<Record<string, string>>;
  frequencyThreshold?: number;
  calibrationActionCounts?: Readonly<Record<string, number>>;
}

export interface GroupedDivergence {
  divergence: number;
  baselineObservations: number;
  currentObservations: number;
  baselineDistribution: Readonly<Record<string, number>>;
  currentDistribution: Readonly<Record<string, number>>;
}

const AUTH_ACTIONS = ['USER_REGISTERED', 'LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGOUT'] as const;
/** Real app action currently intentionally grouped into OTHER by variant A. */
const ADDITIONAL_KNOWN_AUDIT_ACTIONS = ['ANOMALY_STATUS_CHANGED'] as const;

export function createGroupingSpec(
  variant: GroupingVariant,
  calibrationActionCounts: Readonly<Record<string, number>> = {},
  frequencyThreshold?: number,
): GroupingSpec {
  if (variant === 'A_CURRENT') {
    return { variant, categories: [...ACTION_CATEGORIES], categoryByAction: ACTION_CATEGORY_MAP };
  }

  if (variant === 'B_DETAILED_AUTH') {
    const categoryByAction: Record<string, string> = { ...ACTION_CATEGORY_MAP };
    for (const action of AUTH_ACTIONS) categoryByAction[action] = action;
    return {
      variant,
      categories: [...AUTH_ACTIONS, 'ORDER', 'ADMIN_DENIED', 'PRODUCT_ADMIN', 'OTHER'],
      categoryByAction,
    };
  }

  if (!Number.isSafeInteger(frequencyThreshold) || (frequencyThreshold ?? 0) < 1) {
    throw new Error('Detailed-action frequencyThreshold must be a positive safe integer.');
  }
  const knownAuditActions = [...new Set([...Object.keys(ACTION_CATEGORY_MAP), ...ADDITIONAL_KNOWN_AUDIT_ACTIONS])];
  const commonActions = knownAuditActions
    .filter((action) => (calibrationActionCounts[action] ?? 0) >= frequencyThreshold!)
    .sort();
  const categoryByAction: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const action of commonActions) categoryByAction[action] = action;
  return {
    variant,
    categories: [...commonActions, 'OTHER'],
    categoryByAction,
    frequencyThreshold,
    calibrationActionCounts: { ...calibrationActionCounts },
  };
}

export function categoryForAction(action: string, grouping: GroupingSpec): string {
  return grouping.categoryByAction[action] ?? 'OTHER';
}

export function groupActionCounts(
  actionCounts: Readonly<Record<string, number>>,
  grouping: GroupingSpec,
): Record<string, number> {
  const counts = Object.fromEntries(grouping.categories.map((category) => [category, 0])) as Record<string, number>;
  for (const [action, count] of Object.entries(actionCounts)) {
    if (!Number.isSafeInteger(count) || count < 0) throw new Error(`Invalid action count for ${action}.`);
    const category = categoryForAction(action, grouping);
    counts[category] = (counts[category] ?? 0) + count;
  }
  return counts;
}

function normalize(counts: Readonly<Record<string, number>>, categories: readonly string[], alpha: number): Record<string, number> {
  const total = categories.reduce((sum, category) => sum + (counts[category] ?? 0), 0);
  const denominator = total + alpha * categories.length;
  return Object.fromEntries(categories.map((category) => [category, ((counts[category] ?? 0) + alpha) / denominator]));
}

/** Research-only implementation of the unchanged Jeffreys formula over a configurable category list. */
export function calculateGroupedJeffreysDivergence(
  baselineActionCounts: Readonly<Record<string, number>>,
  currentActionCounts: Readonly<Record<string, number>>,
  grouping: GroupingSpec,
  alpha = 0.5,
): GroupedDivergence {
  if (!Number.isFinite(alpha) || alpha <= 0) throw new Error('alpha must be a finite positive number.');
  const baseline = groupActionCounts(baselineActionCounts, grouping);
  const current = groupActionCounts(currentActionCounts, grouping);
  const baselineDistribution = normalize(baseline, grouping.categories, alpha);
  const currentDistribution = normalize(current, grouping.categories, alpha);
  const divergence = grouping.categories.reduce((sum, category) => {
    const p = baselineDistribution[category];
    const q = currentDistribution[category];
    return sum + (p - q) * Math.log(p / q);
  }, 0);
  return {
    divergence,
    baselineObservations: Object.values(baseline).reduce((sum, count) => sum + count, 0),
    currentObservations: Object.values(current).reduce((sum, count) => sum + count, 0),
    baselineDistribution,
    currentDistribution,
  };
}

export function calibrationActionCounts(
  events: ReadonlyArray<{ action: string; created_at: string | Date }>,
  splitAt: string,
): Record<string, number> {
  const split = Date.parse(splitAt);
  if (!Number.isFinite(split)) throw new Error('splitAt must be a valid timestamp.');
  const counts: Record<string, number> = Object.create(null) as Record<string, number>;
  for (const event of events) {
    const time = new Date(event.created_at).getTime();
    if (!Number.isFinite(time)) throw new Error('Event timestamp must be valid.');
    if (time < split) counts[event.action] = (counts[event.action] ?? 0) + 1;
  }
  return counts;
}

export type { ActionCategory };
