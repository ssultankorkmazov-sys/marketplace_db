import { describe, expect, it } from 'vitest';
import { replayJeffreysEvents, type ReplayAuditEvent, type ReplayWindowConfig } from '../src/jeffreysReplay.js';

const config: ReplayWindowConfig = {
  baselineDays: 1,
  currentWindowHours: 6,
  evaluationStepHours: 6,
  alpha: 0.5,
  minimumBaselineObservations: 1,
  minimumCurrentObservations: 1,
};

const events: ReplayAuditEvent[] = [
  { user_id: 7, action: 'LOGIN_SUCCESS', created_at: '2025-01-01T00:00:00.000Z' },
  { user_id: 7, action: 'ORDER_CREATED', created_at: '2025-01-01T18:00:00.000Z' },
  { user_id: 7, action: 'LOGIN_SUCCESS', created_at: '2025-01-02T00:00:00.000Z' },
  { user_id: 7, action: 'ORDER_CREATED', created_at: '2025-01-02T06:00:00.000Z' },
  { user_id: 7, action: 'LOGIN_FAILED', created_at: '2025-01-02T12:00:00.000Z' },
  { user_id: 7, action: 'PRODUCT_UPDATED', created_at: '2025-01-03T08:00:00.000Z' },
];

describe('Jeffreys chronological replay', () => {
  it('sorts prepared events and keeps baseline/current windows disjoint', () => {
    const point = [...replayJeffreysEvents([...events].reverse(), [config])]
      .find((row) => row.evaluated_at === '2025-01-02T12:00:00.000Z')!;

    expect(point.status).toBe('sufficient_data');
    expect(point.baseline_start).toBe('2025-01-01T06:00:00.000Z');
    expect(point.baseline_end).toBe('2025-01-02T06:00:00.000Z');
    expect(point.current_start).toBe(point.baseline_end);
    expect(point.current_end).toBe(point.evaluated_at);
    expect(point.baselineObservations).toBe(2);
    expect(point.currentObservations).toBe(2);
  });

  it('does not use events later than the evaluation timestamp', () => {
    const snapshot = (data: ReplayAuditEvent[]) => [...replayJeffreysEvents(data, [config])]
      .find((row) => row.evaluated_at === '2025-01-02T12:00:00.000Z');
    const before = snapshot(events)!;
    const after = snapshot([...events, { user_id: 7, action: 'ADMIN_LOGS_ACCESS_DENIED', created_at: '2025-01-02T12:01:00.000Z' }])!;

    expect(after).toEqual(before);
  });

  it('marks early windows insufficient and ignores anonymous events for user baselines', () => {
    const data: ReplayAuditEvent[] = [
      { user_id: null, action: 'LOGIN_FAILED', created_at: '2025-01-01T00:00:00.000Z' },
      { user_id: 7, action: 'LOGIN_SUCCESS', created_at: '2025-01-01T00:00:00.000Z' },
      { user_id: 7, action: 'ORDER_CREATED', created_at: '2025-01-01T01:00:00.000Z' },
    ];
    const points = [...replayJeffreysEvents(data, [{ ...config, minimumBaselineObservations: 5, minimumCurrentObservations: 3 }])];

    expect(points.every((point) => point.status === 'insufficient_data')).toBe(true);
    expect(points.every((point) => point.user_id === 7)).toBe(true);
  });

  it('can skip divergence calculation for insufficient windows without changing the default study behavior', () => {
    const minimums = { ...config, minimumBaselineObservations: 5, minimumCurrentObservations: 3 };
    const defaultPoints = [...replayJeffreysEvents(events, [minimums])];
    const offlinePoints = [...replayJeffreysEvents(events, [minimums], { calculateInsufficientDataScores: false })];
    const defaultInsufficient = defaultPoints.find((point) => point.status === 'insufficient_data')!;
    const offlineInsufficient = offlinePoints.find((point) => point.status === 'insufficient_data')!;

    expect(defaultInsufficient.divergence).not.toBeNull();
    expect(offlineInsufficient.divergence).toBeNull();
    expect(offlineInsufficient.smoothedBaseline).toBeNull();
    expect(offlineInsufficient.smoothedCurrent).toBeNull();
    expect(offlineInsufficient.status).toBe('insufficient_data');
  });

  it('emits chronological evaluation points for each requested window', () => {
    const points = [...replayJeffreysEvents(events, [config, { ...config, currentWindowHours: 12 }])];
    const sixHourPoints = points.filter((point) => point.current_window_hours === 6);
    const twelveHourPoints = points.filter((point) => point.current_window_hours === 12);

    expect(sixHourPoints.length).toBeGreaterThan(1);
    expect(twelveHourPoints.length).toBeGreaterThan(1);
    expect(sixHourPoints.map((point) => point.evaluated_at)).toEqual([...sixHourPoints.map((point) => point.evaluated_at)].sort());
  });
});
