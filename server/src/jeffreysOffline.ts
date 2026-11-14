import { ACTION_CATEGORIES, type ActionCategory } from './jeffreys.js';
import {
  compareCalibrationWithHoldout, selectNonOverlappingReplayPoints,
  type CalibrationThresholdCandidate, type PeriodSelection, type ReplayPeriod,
} from './jeffreysCalibration.js';
import { replayJeffreysEvents, type JeffreysReplayPoint, type ReplayAuditEvent, type ReplayWindowConfig } from './jeffreysReplay.js';

const PG_INT_MAX = 2_147_483_647;
const ACCEPTED_PSEUDONYMIZED_ACTIONS = new Set([
  'USER_REGISTERED', 'LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGOUT', 'ORDER_CREATED', 'ORDER_CREATE_FAILED',
  'ORDER_STATUS_CHANGED', 'ADMIN_LOGS_ACCESS_DENIED', 'ADMIN_ORDERS_ACCESS_DENIED',
  'ADMIN_ANOMALIES_ACCESS_DENIED', 'PRODUCTS_ACCESS_DENIED', 'PRODUCT_CREATED', 'PRODUCT_UPDATED',
  'PRODUCT_DELETED', 'ANOMALY_STATUS_CHANGED', '__UNKNOWN_ACTION__',
]);

export interface PseudonymizedAuditEvent extends Omit<ReplayAuditEvent, 'created_at'> {
  created_at: string;
  status: 'SUCCESS' | 'FAILURE';
}

export interface OfflineReplayManifest {
  formatVersion: 1;
  timezone: 'UTC';
  calibrationStartInclusive: string;
  calibrationEndExclusive: string;
  holdoutStartInclusive: string;
  holdoutEndExclusive: string;
  exportedEventCount: number;
  sourceDescription: 'separate_test_database' | 'approved_anonymized_export';
}

export interface OfflineReplayConfig extends ReplayWindowConfig {
  thresholdQuantiles: number[];
}

export const DEFAULT_OFFLINE_REPLAY_CONFIG: Readonly<OfflineReplayConfig> = Object.freeze({
  baselineDays: 30,
  currentWindowHours: 24,
  evaluationStepHours: 24,
  alpha: 0.5,
  minimumBaselineObservations: 50,
  minimumCurrentObservations: 20,
  thresholdQuantiles: [0.95, 0.99],
});

export interface ValidatedOfflineInput {
  events: PseudonymizedAuditEvent[];
  manifest: OfflineReplayManifest;
  exactDuplicateRows: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function utcMillis(value: unknown, label: string): number {
  if (typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|\+00:00)$/.test(value)) {
    throw new Error(`${label} must be an ISO-8601 UTC timestamp.`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 19) !== value.slice(0, 19)) {
    throw new Error(`${label} must be an ISO-8601 UTC timestamp.`);
  }
  return parsed;
}

function validateConfig(config: OfflineReplayConfig): void {
  if (!config || !Number.isFinite(config.alpha) || config.alpha <= 0 ||
      !Number.isSafeInteger(config.baselineDays) || config.baselineDays < 1 ||
      !Number.isSafeInteger(config.currentWindowHours) || config.currentWindowHours < 1 ||
      !Number.isSafeInteger(config.evaluationStepHours) || config.evaluationStepHours < 1 ||
      !Number.isSafeInteger(config.minimumBaselineObservations) || config.minimumBaselineObservations < 1 ||
      !Number.isSafeInteger(config.minimumCurrentObservations) || config.minimumCurrentObservations < 1 ||
      !Array.isArray(config.thresholdQuantiles) || config.thresholdQuantiles.length === 0 ||
      config.thresholdQuantiles.some((value) => !Number.isFinite(value) || value <= 0 || value > 1)) {
    throw new Error('Offline replay configuration contains invalid window, minimum, alpha, or quantile values.');
  }
}

export function validateOfflineReplayInput(eventsInput: unknown, manifestInput: unknown): ValidatedOfflineInput {
  if (!Array.isArray(eventsInput) || eventsInput.length === 0) {
    throw new Error('Input must be a non-empty pseudonymized event array.');
  }

  const requiredEventKeys = ['action', 'created_at', 'status', 'user_id'];
  const duplicateKeys = new Set<string>();
  let exactDuplicateRows = 0;
  const events: PseudonymizedAuditEvent[] = eventsInput.map((value, index) => {
    if (!isRecord(value) || Object.keys(value).sort().join(',') !== requiredEventKeys.join(',')) {
      throw new Error(`Event ${index + 1} must contain only user_id, action, created_at, and status.`);
    }
    const userId = value.user_id;
    if (userId !== null && (!Number.isSafeInteger(userId) || Number(userId) <= PG_INT_MAX)) {
      throw new Error(`Event ${index + 1} does not contain a valid pseudonymized user ID.`);
    }
    if (typeof value.action !== 'string' || !ACCEPTED_PSEUDONYMIZED_ACTIONS.has(value.action)) {
      throw new Error(`Event ${index + 1} has an invalid audit action.`);
    }
    if (value.status !== 'SUCCESS' && value.status !== 'FAILURE') {
      throw new Error(`Event ${index + 1} has an invalid audit status.`);
    }
    utcMillis(value.created_at, `Event ${index + 1} timestamp`);
    const event = value as unknown as PseudonymizedAuditEvent;
    const duplicateKey = `${event.user_id ?? 'null'}\u0000${event.action}\u0000${event.created_at}\u0000${event.status}`;
    if (duplicateKeys.has(duplicateKey)) exactDuplicateRows += 1;
    duplicateKeys.add(duplicateKey);
    return event;
  });

  if (!isRecord(manifestInput)) throw new Error('A valid replay manifest is required.');
  const manifestKeys = [
    'calibrationEndExclusive', 'calibrationStartInclusive', 'exportedEventCount', 'formatVersion',
    'holdoutEndExclusive', 'holdoutStartInclusive', 'sourceDescription', 'timezone',
  ];
  if (Object.keys(manifestInput).sort().join(',') !== [...manifestKeys].sort().join(',')) {
    throw new Error('Manifest must contain exactly the documented version 1 fields.');
  }
  const manifest = manifestInput as unknown as OfflineReplayManifest;
  if (manifest.formatVersion !== 1 || manifest.timezone !== 'UTC' ||
      !Number.isSafeInteger(manifest.exportedEventCount) || manifest.exportedEventCount !== events.length ||
      !['separate_test_database', 'approved_anonymized_export'].includes(manifest.sourceDescription)) {
    throw new Error('Manifest version, timezone, source, or exported event count is invalid.');
  }
  const calibrationStart = utcMillis(manifest.calibrationStartInclusive, 'Calibration start');
  const calibrationEnd = utcMillis(manifest.calibrationEndExclusive, 'Calibration end');
  const holdoutStart = utcMillis(manifest.holdoutStartInclusive, 'Holdout start');
  const holdoutEnd = utcMillis(manifest.holdoutEndExclusive, 'Holdout end');
  if (calibrationStart >= calibrationEnd || calibrationEnd > holdoutStart || holdoutStart >= holdoutEnd) {
    throw new Error('Calibration and holdout periods must be ordered, positive-duration, and non-overlapping.');
  }

  events.sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at));
  return { events, manifest, exactDuplicateRows };
}

function summarizeDistribution(values: number[]) {
  if (!values.length) return { count: 0, minimum: null, maximum: null, mean: null, p95: null, p99: null };
  const sorted = [...values].sort((left, right) => left - right);
  const percentile = (q: number) => sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)];
  return {
    count: sorted.length,
    minimum: sorted[0],
    maximum: sorted[sorted.length - 1],
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    p95: percentile(0.95),
    p99: percentile(0.99),
  };
}

function windowCounts(selection: PeriodSelection) {
  return {
    total: selection.points.length,
    sufficient: selection.points.filter((point) => point.status === 'sufficient_data').length,
    insufficient: selection.points.filter((point) => point.status === 'insufficient_data').length,
    excluded_outside_period: selection.excludedOutsidePeriod,
    excluded_incomplete_baseline: selection.excludedIncompleteBaseline,
    excluded_overlapping_window: selection.excludedOverlappingWindow,
    excluded_shared_boundary_event: selection.excludedSharedBoundaryEvent,
  };
}

function summarizeWindows(points: JeffreysReplayPoint[], subjectRefs: ReadonlyMap<number, string>) {
  return points.map((point) => ({
    subject_ref: subjectRefs.get(point.user_id) ?? 'unknown',
    evaluated_at: point.evaluated_at,
    baseline_start: point.baseline_start,
    baseline_end: point.baseline_end,
    current_start: point.current_start,
    current_end: point.current_end,
    baseline_observations: point.baselineObservations,
    current_observations: point.currentObservations,
    status: point.status,
    divergence: point.status === 'sufficient_data' ? point.divergence : null,
    baseline_distribution: point.status === 'sufficient_data' ? point.smoothedBaseline : null,
    current_distribution: point.status === 'sufficient_data' ? point.smoothedCurrent : null,
    category_contributions: point.status === 'sufficient_data' ? point.categoryContributions : null,
  }));
}

function eventTimesByUser(events: PseudonymizedAuditEvent[]): Map<number, ReadonlySet<number>> {
  const result = new Map<number, Set<number>>();
  for (const event of events) {
    if (event.user_id === null) continue;
    const times = result.get(event.user_id) ?? new Set<number>();
    times.add(Date.parse(event.created_at));
    result.set(event.user_id, times);
  }
  return result;
}

export function buildOfflineReplayReport(
  eventsInput: unknown,
  manifestInput: unknown,
  config: OfflineReplayConfig = DEFAULT_OFFLINE_REPLAY_CONFIG,
) {
  validateConfig(config);
  const validated = validateOfflineReplayInput(eventsInput, manifestInput);
  const { events, manifest } = validated;
  const replayEvents: ReplayAuditEvent[] = events.map(({ user_id, action, created_at }) => ({ user_id, action, created_at }));
  const replayPoints = [...replayJeffreysEvents(replayEvents, [config], { calculateInsufficientDataScores: false })];
  const firstEventMs = Date.parse(events[0].created_at);
  const lastEventMs = Date.parse(events[events.length - 1].created_at);
  const firstEventUtc = new Date(firstEventMs).toISOString();
  const lastEventUtc = new Date(lastEventMs).toISOString();
  const boundaries: ReplayPeriod[] = [
    { startInclusive: manifest.calibrationStartInclusive, endExclusive: manifest.calibrationEndExclusive },
    { startInclusive: manifest.holdoutStartInclusive, endExclusive: manifest.holdoutEndExclusive },
  ];
  const distinctUsers = [...new Set(events.flatMap((event) => event.user_id === null ? [] : [event.user_id]))].sort((a, b) => a - b);
  const subjectRefs = new Map(distinctUsers.map((userId, index) => [userId, `S${index + 1}`]));
  const times = eventTimesByUser(events);
  const calibration = selectNonOverlappingReplayPoints(replayPoints, boundaries[0], firstEventUtc, times);
  const holdout = selectNonOverlappingReplayPoints(replayPoints, boundaries[1], firstEventUtc, times);
  const sufficientScores = (selection: PeriodSelection) => selection.points.flatMap((point) =>
    point.status === 'sufficient_data' && point.divergence !== null ? [point.divergence] : []);
  const calibrationCandidates: CalibrationThresholdCandidate[] = compareCalibrationWithHoldout(
    calibration.points, holdout.points, config.thresholdQuantiles,
  );
  const calendarStart = Date.parse(`${firstEventUtc.slice(0, 10)}T00:00:00.000Z`);
  const calendarEnd = Date.parse(`${lastEventUtc.slice(0, 10)}T00:00:00.000Z`);
  const activeDays = new Set(events.map((event) => event.created_at.slice(0, 10))).size;
  const calendarDays = Math.floor((calendarEnd - calendarStart) / (24 * 60 * 60 * 1_000)) + 1;
  const categoryNames: readonly ActionCategory[] = ACTION_CATEGORIES;

  return {
    report_type: 'JEFFREYS_OFFLINE_REPLAY',
    generated_at: new Date().toISOString(),
    data_period: { first_event_utc: firstEventUtc, last_event_utc: lastEventUtc },
    input_quality: {
      event_count: events.length,
      identified_event_count: events.filter((event) => event.user_id !== null).length,
      events_without_user_id: events.filter((event) => event.user_id === null).length,
      pseudonymous_user_count: distinctUsers.length,
      active_utc_days: activeDays,
      calendar_utc_days: calendarDays,
      utc_days_without_events: calendarDays - activeDays,
      exact_duplicate_rows: validated.exactDuplicateRows,
      categories: categoryNames,
    },
    configuration: {
      baseline_days: config.baselineDays,
      current_window_hours: config.currentWindowHours,
      evaluation_step_hours: config.evaluationStepHours,
      alpha: config.alpha,
      minimum_baseline_observations: config.minimumBaselineObservations,
      minimum_current_observations: config.minimumCurrentObservations,
      threshold_quantiles: [...config.thresholdQuantiles],
    },
    periods: {
      calibration: boundaries[0],
      holdout: boundaries[1],
      chronological_non_overlapping_current_windows: true,
      thresholds_derived_only_from_calibration: true,
    },
    calibration: {
      windows: windowCounts(calibration),
      divergence_distribution: summarizeDistribution(sufficientScores(calibration)),
      window_results: summarizeWindows(calibration.points, subjectRefs),
      threshold_candidates: calibrationCandidates.map((candidate) => ({
        quantile: candidate.quantile,
        threshold_from_calibration: candidate.threshold,
        calibration_scored_window_count: candidate.calibrationWindowCount,
      })),
    },
    holdout: {
      windows: windowCounts(holdout),
      divergence_distribution: summarizeDistribution(sufficientScores(holdout)),
      window_results: summarizeWindows(holdout.points, subjectRefs),
      calibration_threshold_comparison: calibrationCandidates.map((candidate) => ({
        quantile: candidate.quantile,
        threshold_from_calibration: candidate.threshold,
        holdout_scored_window_count: candidate.holdoutWindowCount,
        above_calibration_threshold_count: candidate.holdoutExceedances,
        above_calibration_threshold_rate: candidate.holdoutExceedanceRate,
        interpretation: 'Descriptive exceedance only; not a false-positive or detection rate without ground-truth labels.',
      })),
    },
    classification_metrics: null,
    classification_metrics_note: 'The accepted input format has no ground-truth labels; false-positive, detection, precision, and recall metrics are not calculated.',
    limitations: [
      'This runner reads only a local pseudonymized JSON event array and manifest; it never connects to a database.',
      'Export completeness cannot be established from the event file alone.',
      'Pseudonymized timestamps and actions remain behavioral data and the report should be kept outside Git.',
      'Holdout threshold exceedances are descriptive and are not attack evidence or a false-positive rate.',
      'Windows from one subject can remain correlated even when current windows do not overlap.',
    ],
  };
}
