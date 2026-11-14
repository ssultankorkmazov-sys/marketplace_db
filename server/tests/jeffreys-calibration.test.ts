import { describe, expect, it } from 'vitest';
import { compareCalibrationWithHoldout, selectNonOverlappingReplayPoints } from '../src/jeffreysCalibration.js';
import type { JeffreysReplayPoint } from '../src/jeffreysReplay.js';

function point(overrides: Partial<JeffreysReplayPoint> = {}): JeffreysReplayPoint {
  const currentStart = overrides.current_start ?? '2026-01-01T00:00:00.000Z';
  const currentEnd = overrides.current_end ?? '2026-01-02T00:00:00.000Z';
  return {
    user_id: 8,
    evaluated_at: currentEnd,
    baseline_start: '2025-12-25T00:00:00.000Z',
    baseline_end: currentStart,
    current_start: currentStart,
    current_end: currentEnd,
    baseline_days: 7,
    current_window_hours: 24,
    minimumBaselineObservations: 5,
    minimumCurrentObservations: 1,
    baselineObservations: 10,
    currentObservations: 2,
    status: 'sufficient_data',
    divergence: 0.2,
    smoothedBaseline: { AUTH: 1, ORDER: 0, ADMIN_DENIED: 0, PRODUCT_ADMIN: 0, OTHER: 0 },
    smoothedCurrent: { AUTH: 1, ORDER: 0, ADMIN_DENIED: 0, PRODUCT_ADMIN: 0, OTHER: 0 },
    categoryContributions: { AUTH: 0, ORDER: 0, ADMIN_DENIED: 0, PRODUCT_ADMIN: 0, OTHER: 0 },
    ...overrides,
  };
}

describe('Jeffreys chronological calibration helpers', () => {
  it('keeps calibration and holdout windows inside their own periods with complete baselines', () => {
    const rows = [
      point({ current_start: '2026-01-01T00:00:00.000Z', current_end: '2026-01-02T00:00:00.000Z', baseline_start: '2025-12-25T00:00:00.000Z' }),
      point({ current_start: '2026-01-02T00:00:00.000Z', current_end: '2026-01-03T00:00:00.000Z', baseline_start: '2025-12-26T00:00:00.000Z' }),
      point({ current_start: '2026-01-03T00:00:00.000Z', current_end: '2026-01-04T00:00:00.000Z', baseline_start: '2025-12-27T00:00:00.000Z' }),
    ];
    const selection = selectNonOverlappingReplayPoints(rows, {
      startInclusive: '2026-01-01T00:00:00.000Z', endExclusive: '2026-01-04T00:00:00.000Z',
    }, '2025-12-25T00:00:00.000Z', new Map());

    expect(selection.points).toEqual(rows.slice(0, 2));
    expect(selection.excludedOutsidePeriod).toBe(1);
    expect(selection.excludedIncompleteBaseline).toBe(0);
  });

  it('excludes overlapping windows and windows whose baseline predates observed data', () => {
    const rows = [
      point({ current_start: '2026-01-01T00:00:00.000Z', current_end: '2026-01-02T00:00:00.000Z', baseline_start: '2025-12-20T00:00:00.000Z' }),
      point({ current_start: '2026-01-02T00:00:00.000Z', current_end: '2026-01-03T00:00:00.000Z', baseline_start: '2025-12-27T00:00:00.000Z' }),
      point({ current_start: '2026-01-02T12:00:00.000Z', current_end: '2026-01-03T12:00:00.000Z', baseline_start: '2025-12-27T12:00:00.000Z' }),
    ];
    const selection = selectNonOverlappingReplayPoints(rows, {
      startInclusive: '2026-01-01T00:00:00.000Z', endExclusive: '2026-01-04T00:00:00.000Z',
    }, '2025-12-25T00:00:00.000Z', new Map());

    expect(selection.points).toEqual([rows[1]]);
    expect(selection.excludedIncompleteBaseline).toBe(1);
    expect(selection.excludedOverlappingWindow).toBe(1);
  });

  it('derives quantile thresholds from calibration only and uses holdout only for evaluation', () => {
    const calibration = [point({ divergence: 0.1 }), point({ divergence: 0.2 }), point({ divergence: 0.3 })];
    const holdout = [point({ divergence: 0.25 }), point({ divergence: 100 })];
    const result = compareCalibrationWithHoldout(calibration, holdout, [0.95]);

    expect(result[0]).toEqual({
      quantile: 0.95,
      threshold: 0.3,
      calibrationWindowCount: 3,
      holdoutWindowCount: 2,
      holdoutExceedances: 1,
      holdoutExceedanceRate: 0.5,
    });
  });

  it('does not invent a threshold when calibration has no sufficient windows', () => {
    const result = compareCalibrationWithHoldout(
      [point({ status: 'insufficient_data', divergence: 900 })],
      [point({ divergence: 0.5 })],
      [0.95],
    );
    expect(result[0].threshold).toBeNull();
    expect(result[0].holdoutExceedances).toBeNull();
  });
});
