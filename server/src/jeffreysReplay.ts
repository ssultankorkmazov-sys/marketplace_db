import {
  calculateJeffreysDivergence, DEFAULT_JEFFREYS_CONFIG, type JeffreysConfig,
  type JeffreysDistributionResult,
} from './jeffreys.js';

const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;

export interface ReplayAuditEvent {
  user_id: number | null;
  action: string;
  created_at: Date | string;
}

export interface ReplayWindowConfig extends JeffreysConfig {
  baselineDays: number;
  currentWindowHours: number;
  /** Fixed sampling interval; every point uses only events available by its timestamp. */
  evaluationStepHours: number;
}

export interface JeffreysReplayPoint {
  user_id: number;
  evaluated_at: string;
  baseline_start: string;
  baseline_end: string;
  current_start: string;
  current_end: string;
  baseline_days: number;
  current_window_hours: number;
  minimumBaselineObservations: number;
  minimumCurrentObservations: number;
  baselineObservations: number;
  currentObservations: number;
  status: JeffreysDistributionResult['status'];
  divergence: number | null;
  smoothedBaseline: JeffreysDistributionResult['smoothedBaseline'] | null;
  smoothedCurrent: JeffreysDistributionResult['smoothedCurrent'] | null;
  categoryContributions: JeffreysDistributionResult['categoryContributions'] | null;
}

export interface JeffreysReplayOptions {
  /** Defaults to true for compatibility with existing exploratory studies. */
  calculateInsufficientDataScores?: boolean;
}

interface TimedEvent extends ReplayAuditEvent { time: number; inputOrder: number }

function validateWindow(config: ReplayWindowConfig): void {
  if (!Number.isSafeInteger(config.baselineDays) || config.baselineDays < 1 ||
      !Number.isSafeInteger(config.currentWindowHours) || config.currentWindowHours < 1 ||
      !Number.isSafeInteger(config.evaluationStepHours) || config.evaluationStepHours < 1) {
    throw new Error('Replay window durations must be positive safe integers.');
  }
  // Reuse the same validation as the divergence function.
  calculateJeffreysDivergence({}, {}, config);
}

function adjust(counts: Record<string, number>, action: string, delta: 1 | -1): void {
  const next = (counts[action] ?? 0) + delta;
  if (next < 0) throw new Error('Replay window counter became negative.');
  if (next === 0) delete counts[action];
  else counts[action] = next;
}

function userEvents(events: ReplayAuditEvent[]): Map<number, TimedEvent[]> {
  const grouped = new Map<number, TimedEvent[]>();
  events.forEach((event, inputOrder) => {
    if (!event || typeof event !== 'object' || typeof event.action !== 'string' || !event.action.trim()) {
      throw new Error('Replay events must have a non-empty audit action.');
    }
    const time = new Date(event.created_at).getTime();
    if (!Number.isFinite(time)) throw new Error('Replay event timestamp is invalid.');
    // Events without an authenticated subject cannot form a per-user baseline.
    if (event.user_id === null) return;
    if (!Number.isSafeInteger(event.user_id) || event.user_id < 1) throw new Error('Replay user_id must be a positive safe integer or null.');
    const list = grouped.get(event.user_id) ?? [];
    list.push({ ...event, time, inputOrder });
    grouped.set(event.user_id, list);
  });
  for (const list of grouped.values()) list.sort((a, b) => a.time - b.time || a.inputOrder - b.inputOrder);
  return grouped;
}

/**
 * Replays user-scoped audit activity in chronological fixed steps. Baseline is
 * [currentStart - baselineDays, currentStart); current is [currentStart, evaluatedAt].
 * No event later than evaluatedAt can contribute to either distribution.
 */
export function* replayJeffreysEvents(
  events: ReplayAuditEvent[],
  windows: ReplayWindowConfig[],
  options: JeffreysReplayOptions = {},
): Generator<JeffreysReplayPoint> {
  if (!Array.isArray(events) || !Array.isArray(windows) || windows.length === 0) {
    throw new Error('Replay requires an event array and at least one window configuration.');
  }
  for (const window of windows) validateWindow(window);
  const groups = userEvents(events);

  for (const window of windows) {
    const stepMs = window.evaluationStepHours * HOUR_MS;
    const currentMs = window.currentWindowHours * HOUR_MS;
    const baselineMs = window.baselineDays * DAY_MS;
    for (const [userId, list] of groups) {
      if (list.length === 0) continue;
      const baselineCounts: Record<string, number> = Object.create(null) as Record<string, number>;
      const currentCounts: Record<string, number> = Object.create(null) as Record<string, number>;
      let baselineLeft = 0;
      let baselineRight = 0;
      let currentLeft = 0;
      let currentRight = 0;
      let anchor = list[0].time;
      let lastEvaluated = Number.NaN;

      const evaluate = (at: number) => {
        const currentStart = at - currentMs;
        const baselineStart = currentStart - baselineMs;
        while (baselineRight < list.length && list[baselineRight].time < currentStart) {
          adjust(baselineCounts, list[baselineRight].action, 1);
          baselineRight += 1;
        }
        while (baselineLeft < baselineRight && list[baselineLeft].time < baselineStart) {
          adjust(baselineCounts, list[baselineLeft].action, -1);
          baselineLeft += 1;
        }
        while (currentRight < list.length && list[currentRight].time <= at) {
          if (list[currentRight].time >= currentStart) adjust(currentCounts, list[currentRight].action, 1);
          currentRight += 1;
        }
        while (currentLeft < currentRight && list[currentLeft].time < currentStart) {
          // Old events are only present in the counter if they were within the previous current window.
          if (list[currentLeft].time <= lastEvaluated) adjust(currentCounts, list[currentLeft].action, -1);
          currentLeft += 1;
        }

        const baselineObservations = Object.values(baselineCounts).reduce((sum, count) => sum + count, 0);
        const currentObservations = Object.values(currentCounts).reduce((sum, count) => sum + count, 0);
        const sufficient = baselineObservations >= window.minimumBaselineObservations &&
          currentObservations >= window.minimumCurrentObservations;
        const result = sufficient || options.calculateInsufficientDataScores !== false
          ? calculateJeffreysDivergence(baselineCounts, currentCounts, window)
          : null;
        const iso = (value: number) => new Date(value).toISOString();
        return {
          user_id: userId,
          evaluated_at: iso(at),
          baseline_start: iso(baselineStart),
          baseline_end: iso(currentStart),
          current_start: iso(currentStart),
          current_end: iso(at),
          baseline_days: window.baselineDays,
          current_window_hours: window.currentWindowHours,
          minimumBaselineObservations: window.minimumBaselineObservations,
          minimumCurrentObservations: window.minimumCurrentObservations,
          baselineObservations: result?.baselineObservations ?? baselineObservations,
          currentObservations: result?.currentObservations ?? currentObservations,
          status: result?.status ?? 'insufficient_data',
          divergence: result?.divergence ?? null,
          smoothedBaseline: result?.smoothedBaseline ?? null,
          smoothedCurrent: result?.smoothedCurrent ?? null,
          categoryContributions: result?.categoryContributions ?? null,
        } satisfies JeffreysReplayPoint;
      };

      while (anchor <= list[list.length - 1].time) {
        const point = evaluate(anchor);
        yield point;
        lastEvaluated = anchor;
        anchor += stepMs;
      }
      if (lastEvaluated !== list[list.length - 1].time) yield evaluate(list[list.length - 1].time);
    }
  }
}

export const DEFAULT_REPLAY_MINIMUMS = Object.freeze([
  { minimumBaselineObservations: 30, minimumCurrentObservations: 10 },
  { minimumBaselineObservations: DEFAULT_JEFFREYS_CONFIG.minimumBaselineObservations, minimumCurrentObservations: DEFAULT_JEFFREYS_CONFIG.minimumCurrentObservations },
  { minimumBaselineObservations: 100, minimumCurrentObservations: 40 },
]);
