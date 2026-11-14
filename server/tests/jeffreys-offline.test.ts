import { describe, expect, it } from 'vitest';
import { buildOfflineReplayReport, validateOfflineReplayInput, type OfflineReplayConfig } from '../src/jeffreysOffline.js';

const manifest = {
  formatVersion: 1 as const,
  timezone: 'UTC' as const,
  calibrationStartInclusive: '2025-01-02T00:00:00.000Z',
  calibrationEndExclusive: '2025-01-04T00:00:00.000Z',
  holdoutStartInclusive: '2025-01-04T00:00:00.000Z',
  holdoutEndExclusive: '2025-01-09T00:00:00.000Z',
  exportedEventCount: 16,
  sourceDescription: 'approved_anonymized_export' as const,
};

const config: OfflineReplayConfig = {
  baselineDays: 1,
  currentWindowHours: 24,
  evaluationStepHours: 24,
  alpha: 0.5,
  minimumBaselineObservations: 2,
  minimumCurrentObservations: 2,
  thresholdQuantiles: [0.5, 0.95],
};

function events() {
  return Array.from({ length: 8 }, (_, day) => [1, 2].map((hour) => ({
    user_id: 2_147_483_648,
    action: day < 4 ? 'LOGIN_SUCCESS' : 'ORDER_CREATED',
    created_at: new Date(Date.UTC(2025, 0, day + 1, hour)).toISOString(),
    status: 'SUCCESS' as const,
  }))).flat();
}

describe('offline Jeffreys replay pipeline', () => {
  it('rejects empty and malformed pseudonymized event inputs', () => {
    expect(() => validateOfflineReplayInput([], { ...manifest, exportedEventCount: 0 })).toThrow(/non-empty/);
    expect(() => validateOfflineReplayInput([{ ...events()[0], ip_address: '127.0.0.1' }], { ...manifest, exportedEventCount: 1 }))
      .toThrow(/only user_id, action, created_at, and status/);
    expect(() => validateOfflineReplayInput([{ ...events()[0], user_id: 42 }], { ...manifest, exportedEventCount: 1 }))
      .toThrow(/pseudonymized user ID/);
    expect(() => validateOfflineReplayInput([{ ...events()[0], action: 'UNREDACTED_UNKNOWN_ACTION' }], { ...manifest, exportedEventCount: 1 }))
      .toThrow(/invalid audit action/);
  });

  it('rejects manifest count mismatches and overlapping chronological periods', () => {
    expect(() => validateOfflineReplayInput(events(), { ...manifest, exportedEventCount: 15 })).toThrow(/event count is invalid/);
    expect(() => validateOfflineReplayInput(events(), { ...manifest, holdoutStartInclusive: '2025-01-03T00:00:00.000Z' }))
      .toThrow(/ordered, positive-duration, and non-overlapping/);
  });

  it('sorts events chronologically and records sufficient and insufficient windows explicitly', () => {
    const report = buildOfflineReplayReport([...events()].reverse(), manifest, config);
    expect(report.data_period.first_event_utc).toBe('2025-01-01T01:00:00.000Z');
    expect(report.data_period.last_event_utc).toBe('2025-01-08T02:00:00.000Z');
    expect(report.input_quality.event_count).toBe(16);
    expect(report.input_quality.pseudonymous_user_count).toBe(1);
    expect(report.calibration.windows.sufficient).toBeGreaterThan(0);
    expect(report.holdout.windows.sufficient).toBeGreaterThan(0);
    expect(report.calibration.window_results.every((window) => window.status === 'sufficient_data' || window.divergence === null)).toBe(true);
    expect(report.classification_metrics).toBeNull();
  });

  it('does not expose or score divergence for windows below configured minimums', () => {
    const report = buildOfflineReplayReport(events(), manifest, {
      ...config, minimumBaselineObservations: 100, minimumCurrentObservations: 50,
    });
    expect(report.calibration.windows.insufficient).toBeGreaterThan(0);
    expect(report.holdout.windows.insufficient).toBeGreaterThan(0);
    expect(report.calibration.window_results.filter((window) => window.status === 'insufficient_data')
      .every((window) => window.divergence === null && window.baseline_distribution === null && window.current_distribution === null)).toBe(true);
  });

  it('derives threshold candidates from calibration only, regardless of holdout changes', () => {
    const baselineReport = buildOfflineReplayReport(events(), manifest, config);
    const changedHoldout = events().map((event) => Date.parse(event.created_at) >= Date.parse(manifest.holdoutStartInclusive)
      ? { ...event, action: 'LOGIN_FAILED', status: 'FAILURE' as const }
      : event);
    const changedReport = buildOfflineReplayReport(changedHoldout, manifest, config);

    expect(changedReport.calibration.divergence_distribution).toEqual(baselineReport.calibration.divergence_distribution);
    expect(changedReport.calibration.threshold_candidates).toEqual(baselineReport.calibration.threshold_candidates);
    expect(changedReport.holdout.divergence_distribution).not.toEqual(baselineReport.holdout.divergence_distribution);
    expect(changedReport.classification_metrics_note).toContain('no ground-truth labels');
  });
});
