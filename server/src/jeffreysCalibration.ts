import type { JeffreysReplayPoint } from './jeffreysReplay.js';

export interface ReplayPeriod {
  startInclusive: string;
  endExclusive: string;
}

export interface PeriodSelection {
  points: JeffreysReplayPoint[];
  excludedOutsidePeriod: number;
  excludedIncompleteBaseline: number;
  excludedOverlappingWindow: number;
  excludedSharedBoundaryEvent: number;
}

export interface CalibrationThresholdCandidate {
  quantile: number;
  threshold: number | null;
  calibrationWindowCount: number;
  holdoutWindowCount: number;
  holdoutExceedances: number | null;
  holdoutExceedanceRate: number | null;
}

function parseBoundary(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a valid timestamp.`);
  return parsed;
}

/** Select full, sufficient, non-overlapping current windows within a period. */
export function selectNonOverlappingReplayPoints(
  points: JeffreysReplayPoint[],
  period: ReplayPeriod,
  earliestObservedAt: string,
  eventTimesByUser: ReadonlyMap<number, ReadonlySet<number>>,
): PeriodSelection {
  const periodStart = parseBoundary(period.startInclusive, 'Period start');
  const periodEnd = parseBoundary(period.endExclusive, 'Period end');
  const earliestObserved = parseBoundary(earliestObservedAt, 'Earliest observed time');
  if (periodStart >= periodEnd) throw new Error('Replay period must have a positive duration.');

  const byUser = new Map<number, JeffreysReplayPoint[]>();
  let excludedOutsidePeriod = 0;
  let excludedIncompleteBaseline = 0;
  for (const point of points) {
    const start = parseBoundary(point.current_start, 'Current window start');
    const end = parseBoundary(point.current_end, 'Current window end');
    const baselineStart = parseBoundary(point.baseline_start, 'Baseline start');
    if (start < periodStart || end >= periodEnd || end <= start) {
      excludedOutsidePeriod += 1;
      continue;
    }
    if (baselineStart < earliestObserved || point.baseline_end !== point.current_start) {
      excludedIncompleteBaseline += 1;
      continue;
    }
    const list = byUser.get(point.user_id) ?? [];
    list.push(point);
    byUser.set(point.user_id, list);
  }

  const selected: JeffreysReplayPoint[] = [];
  let excludedOverlappingWindow = 0;
  let excludedSharedBoundaryEvent = 0;
  for (const [userId, list] of byUser) {
    list.sort((a, b) => Date.parse(a.current_start) - Date.parse(b.current_start));
    let lastEnd = Number.NEGATIVE_INFINITY;
    for (const point of list) {
      const start = Date.parse(point.current_start);
      if (start < lastEnd) {
        excludedOverlappingWindow += 1;
        continue;
      }
      // Adjacent closed windows share a boundary. If an event is exactly on it,
      // keep it in the earlier window only so it is never counted twice.
      if (start === lastEnd && eventTimesByUser.get(userId)?.has(start)) {
        excludedSharedBoundaryEvent += 1;
        continue;
      }
      selected.push(point);
      lastEnd = Date.parse(point.current_end);
    }
  }

  return {
    points: selected.sort((a, b) => Date.parse(a.evaluated_at) - Date.parse(b.evaluated_at) || a.user_id - b.user_id),
    excludedOutsidePeriod,
    excludedIncompleteBaseline,
    excludedOverlappingWindow,
    excludedSharedBoundaryEvent,
  };
}

function empiricalQuantile(values: number[], quantile: number): number | null {
  if (!Number.isFinite(quantile) || quantile <= 0 || quantile > 1) {
    throw new Error('Quantile must be greater than zero and no greater than one.');
  }
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(quantile * sorted.length) - 1)];
}

/** Threshold candidates are derived exclusively from calibration scores. */
export function compareCalibrationWithHoldout(
  calibration: JeffreysReplayPoint[],
  holdout: JeffreysReplayPoint[],
  quantiles: number[] = [0.95, 0.99],
): CalibrationThresholdCandidate[] {
  const calibrationScores = calibration.flatMap((point) =>
    point.status === 'sufficient_data' && point.divergence !== null ? [point.divergence] : []);
  const holdoutScores = holdout.flatMap((point) =>
    point.status === 'sufficient_data' && point.divergence !== null ? [point.divergence] : []);
  return quantiles.map((quantile) => {
    const threshold = empiricalQuantile(calibrationScores, quantile);
    const exceedances = threshold === null ? null : holdoutScores.filter((score) => score > threshold).length;
    return {
      quantile,
      threshold,
      calibrationWindowCount: calibrationScores.length,
      holdoutWindowCount: holdoutScores.length,
      holdoutExceedances: exceedances,
      holdoutExceedanceRate: exceedances === null || holdoutScores.length === 0 ? null : exceedances / holdoutScores.length,
    };
  });
}
