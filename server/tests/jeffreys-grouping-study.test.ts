import { describe, expect, it } from 'vitest';
import { calculateJeffreysDivergence } from '../src/jeffreys.js';
import {
  calculateGroupedJeffreysDivergence, calibrationActionCounts, categoryForAction, createGroupingSpec,
} from '../src/jeffreysGroupingStudy.js';

describe('research-only Jeffreys grouping variants', () => {
  it('keeps variant A numerically equivalent to the current fixed-category implementation', () => {
    const baseline = { LOGIN_SUCCESS: 40, LOGIN_FAILED: 3, ORDER_CREATED: 10, PRODUCT_UPDATED: 2 };
    const current = { LOGIN_SUCCESS: 15, ORDER_CREATED: 30, ADMIN_LOGS_ACCESS_DENIED: 5 };
    const currentResult = calculateJeffreysDivergence(baseline, current, {
      alpha: 0.5, minimumBaselineObservations: 1, minimumCurrentObservations: 1,
    });
    const grouped = calculateGroupedJeffreysDivergence(baseline, current, createGroupingSpec('A_CURRENT'));

    expect(grouped.divergence).toBeCloseTo(currentResult.divergence, 12);
    expect(grouped.baselineDistribution).toEqual(currentResult.smoothedBaseline);
    expect(grouped.currentDistribution).toEqual(currentResult.smoothedCurrent);
  });

  it('splits each AUTH action in variant B and retains OTHER fallback', () => {
    const grouping = createGroupingSpec('B_DETAILED_AUTH');
    expect(grouping.categories).toEqual([
      'USER_REGISTERED', 'LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGOUT',
      'ORDER', 'ADMIN_DENIED', 'PRODUCT_ADMIN', 'OTHER',
    ]);
    expect(categoryForAction('LOGIN_FAILED', grouping)).toBe('LOGIN_FAILED');
    expect(categoryForAction('SYNTHETIC_UNKNOWN_ACTION', grouping)).toBe('OTHER');
    expect(categoryForAction('ANOMALY_STATUS_CHANGED', createGroupingSpec('A_CURRENT'))).toBe('OTHER');
  });

  it('builds variant C categories only from calibration frequency and merges rare or unknown actions into OTHER', () => {
    const events = [
      { action: 'LOGIN_FAILED', created_at: '2025-01-01T00:00:00.000Z' },
      { action: 'LOGIN_FAILED', created_at: '2025-01-01T01:00:00.000Z' },
      { action: 'ORDER_CREATED', created_at: '2025-01-01T02:00:00.000Z' },
      { action: 'ANOMALY_STATUS_CHANGED', created_at: '2025-01-01T03:00:00.000Z' },
      { action: 'ANOMALY_STATUS_CHANGED', created_at: '2025-01-01T04:00:00.000Z' },
      { action: 'SYNTHETIC_UNKNOWN_ACTION', created_at: '2025-01-02T00:00:00.000Z' },
    ];
    const counts = calibrationActionCounts(events, '2025-01-02T00:00:00.000Z');
    const grouping = createGroupingSpec('C_DETAILED_ACTIONS', counts, 2);

    expect(counts).toEqual({ LOGIN_FAILED: 2, ORDER_CREATED: 1, ANOMALY_STATUS_CHANGED: 2 });
    expect(grouping.categories).toEqual(['ANOMALY_STATUS_CHANGED', 'LOGIN_FAILED', 'OTHER']);
    expect(categoryForAction('LOGIN_FAILED', grouping)).toBe('LOGIN_FAILED');
    expect(categoryForAction('ANOMALY_STATUS_CHANGED', grouping)).toBe('ANOMALY_STATUS_CHANGED');
    expect(categoryForAction('ORDER_CREATED', grouping)).toBe('OTHER');
    expect(categoryForAction('SYNTHETIC_UNKNOWN_ACTION', grouping)).toBe('OTHER');
  });

  it('preserves finite smoothed distributions for empty categories', () => {
    const grouping = createGroupingSpec('B_DETAILED_AUTH');
    const result = calculateGroupedJeffreysDivergence({ LOGIN_SUCCESS: 5 }, { LOGIN_FAILED: 5 }, grouping);
    expect(Number.isFinite(result.divergence)).toBe(true);
    expect(Object.values(result.baselineDistribution).every(Number.isFinite)).toBe(true);
    expect(Object.values(result.currentDistribution).every(Number.isFinite)).toBe(true);
  });
});
