import { describe, expect, it } from 'vitest';
import {
  ACTION_CATEGORIES, ACTION_CATEGORY_MAP, calculateJeffreysDivergence, DEFAULT_JEFFREYS_CONFIG,
} from '../src/jeffreys.js';

describe('Jeffreys divergence module', () => {
  it('returns divergence near zero for identical action distributions', () => {
    const result = calculateJeffreysDivergence(
      { LOGIN_SUCCESS: 40, ORDER_CREATED: 10 },
      { LOGIN_FAILED: 40, ORDER_STATUS_CHANGED: 10 },
    );

    expect(result.divergence).toBeCloseTo(0, 12);
    expect(result.status).toBe('sufficient_data');
    expect(result.baselineObservations).toBe(50);
    expect(result.currentObservations).toBe(50);
  });

  it('returns a positive divergence for substantially different distributions', () => {
    const result = calculateJeffreysDivergence(
      { LOGIN_SUCCESS: 80, ORDER_CREATED: 20 },
      { LOGIN_SUCCESS: 20, ORDER_CREATED: 80 },
    );

    expect(result.divergence).toBeGreaterThan(1);
    expect(result.status).toBe('sufficient_data');
  });

  it('smooths zero-count categories so every probability is positive and finite', () => {
    const result = calculateJeffreysDivergence(
      { LOGIN_SUCCESS: 50 },
      { ORDER_CREATED: 20 },
    );

    for (const category of ACTION_CATEGORIES) {
      expect(result.smoothedBaseline[category]).toBeGreaterThan(0);
      expect(result.smoothedCurrent[category]).toBeGreaterThan(0);
      expect(Number.isFinite(result.smoothedBaseline[category])).toBe(true);
      expect(Number.isFinite(result.smoothedCurrent[category])).toBe(true);
      expect(Number.isFinite(result.categoryContributions[category])).toBe(true);
    }
    expect(Object.values(result.smoothedBaseline).reduce((sum, p) => sum + p, 0)).toBeCloseTo(1, 12);
    expect(Object.values(result.smoothedCurrent).reduce((sum, p) => sum + p, 0)).toBeCloseTo(1, 12);
  });

  it('maps unknown audit actions to OTHER without dropping their counts', () => {
    const result = calculateJeffreysDivergence(
      { UNKNOWN_FUTURE_ACTION: 50 },
      { ANOTHER_UNKNOWN_ACTION: 20 },
    );

    expect(result.baselineObservations).toBe(50);
    expect(result.currentObservations).toBe(20);
    expect(result.smoothedBaseline.OTHER).toBeGreaterThan(result.smoothedBaseline.AUTH);
    expect(result.smoothedCurrent.OTHER).toBeGreaterThan(result.smoothedCurrent.AUTH);
    expect(ACTION_CATEGORY_MAP.UNKNOWN_FUTURE_ACTION).toBeUndefined();
  });

  it('keeps zero-event categories finite and never returns NaN or Infinity', () => {
    const result = calculateJeffreysDivergence({}, { LOGIN_FAILED: 0, ORDER_CREATED: 0 });

    expect(result.divergence).toBe(0);
    expect(result.status).toBe('insufficient_data');
    expect(Number.isFinite(result.divergence)).toBe(true);
    expect(Object.values(result.categoryContributions).every(Number.isFinite)).toBe(true);
  });

  it('reports insufficient_data below either configured minimum', () => {
    const result = calculateJeffreysDivergence(
      { LOGIN_SUCCESS: 49 },
      { ORDER_CREATED: 19 },
    );

    expect(result.status).toBe('insufficient_data');
    expect(result.baselineObservations).toBe(49);
    expect(result.currentObservations).toBe(19);
    expect(result.divergence).toBeGreaterThanOrEqual(0);
  });

  it('is deterministic and reports the same score for the same inputs', () => {
    const baseline = { LOGIN_SUCCESS: 45, ORDER_CREATED: 5 };
    const current = { LOGIN_SUCCESS: 20, ORDER_CREATED: 30 };

    expect(calculateJeffreysDivergence(baseline, current)).toEqual(calculateJeffreysDivergence(baseline, current));
  });

  it('sums per-category contributions to the full divergence', () => {
    const result = calculateJeffreysDivergence(
      { LOGIN_SUCCESS: 40, ORDER_CREATED: 10, PRODUCT_UPDATED: 5 },
      { LOGIN_FAILED: 20, ORDER_CREATE_FAILED: 25, PRODUCT_DELETED: 5 },
    );

    expect(Object.values(result.categoryContributions).reduce((sum, part) => sum + part, 0))
      .toBeCloseTo(result.divergence, 12);
  });

  it('keeps initial smoothing and observation thresholds separately configurable', () => {
    expect(DEFAULT_JEFFREYS_CONFIG).toEqual({
      alpha: 0.5,
      minimumBaselineObservations: 50,
      minimumCurrentObservations: 20,
    });
    const result = calculateJeffreysDivergence({ LOGIN_SUCCESS: 3 }, { ORDER_CREATED: 2 }, {
      alpha: 0.25, minimumBaselineObservations: 3, minimumCurrentObservations: 2,
    });
    expect(result.status).toBe('sufficient_data');
  });

  it('rejects invalid counts and invalid configuration', () => {
    expect(() => calculateJeffreysDivergence({ LOGIN_SUCCESS: -1 }, {})).toThrow(/non-negative safe integer/);
    expect(() => calculateJeffreysDivergence({ LOGIN_SUCCESS: 1.5 }, {})).toThrow(/non-negative safe integer/);
    expect(() => calculateJeffreysDivergence({}, {}, { ...DEFAULT_JEFFREYS_CONFIG, alpha: 0 })).toThrow(/alpha/);
  });
});
