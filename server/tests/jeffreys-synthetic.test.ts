import { describe, expect, it } from 'vitest';
import { ACTION_CATEGORY_MAP, calculateJeffreysDivergence } from '../src/jeffreys.js';
import { generateJeffreysSyntheticStudy, SYNTHETIC_PROFILE_NAMES } from '../src/jeffreysSynthetic.js';

describe('Jeffreys synthetic activity generator', () => {
  it('reproduces the same event sequence and scenario labels for a fixed seed', () => {
    const options = { seed: 781, userCount: 100, historyDays: 90 };
    const first = generateJeffreysSyntheticStudy(options);
    const second = generateJeffreysSyntheticStudy(options);

    expect(first).toEqual(second);
    expect(first.source).toBe('SYNTHETIC');
    expect(first.events.every((event) => event.source === 'SYNTHETIC')).toBe(true);
  });

  it('changes generated activity across seeds while keeping the requested profile mix', () => {
    const first = generateJeffreysSyntheticStudy({ seed: 781, userCount: 100, historyDays: 90 });
    const second = generateJeffreysSyntheticStudy({ seed: 782, userCount: 100, historyDays: 90 });

    expect(first.events).not.toEqual(second.events);
    expect(first.profiles).toHaveLength(100);
    expect(new Set(first.profiles.map(({ profile }) => profile))).toEqual(new Set(SYNTHETIC_PROFILE_NAMES));
    expect(first.calibrationDays).toBe(62);
    expect(Date.parse(first.splitAt)).toBeGreaterThan(Date.parse(first.startAt));
  });

  it('keeps injected anomalies in holdout and marks the transient burst as benign', () => {
    const dataset = generateJeffreysSyntheticStudy({ seed: 19, userCount: 100, historyDays: 90 });

    expect(dataset.episodes).toHaveLength(5);
    expect(dataset.episodes.every((episode) => Date.parse(episode.start) >= Date.parse(dataset.splitAt))).toBe(true);
    expect(dataset.episodes.filter((episode) => episode.label === 'ANOMALOUS')).toHaveLength(4);
    expect(dataset.episodes.find((episode) => episode.scenario === 'TRANSIENT_BURST_BENIGN')?.label).toBe('BENIGN_TRANSIENT');
    expect(dataset.events.some((event) => event.injectedScenario === 'LOGIN_FAILED_SPIKE' && event.action === 'LOGIN_FAILED')).toBe(true);
  });

  it('generates a gradual, non-injected change with enough daily volume for 24-hour evaluation', () => {
    const dataset = generateJeffreysSyntheticStudy({ seed: 83, userCount: 120, historyDays: 120 });
    const gradualUser = dataset.profiles.find(({ profile }) => profile === 'gradual_change')?.user_id;
    expect(gradualUser).toBeDefined();
    const userEvents = dataset.events.filter((event) => event.user_id === gradualUser);
    const countOrderShare = (fromDay: number, toDay: number) => {
      const counts = { AUTH: 0, ORDER: 0 };
      for (const event of userEvents) {
        const day = Math.floor((Date.parse(event.created_at) - Date.parse(dataset.startAt)) / (24 * 60 * 60 * 1_000));
        if (day < fromDay || day >= toDay) continue;
        const category = ACTION_CATEGORY_MAP[event.action];
        if (category === 'AUTH') counts.AUTH += 1;
        if (category === 'ORDER') counts.ORDER += 1;
      }
      return counts.ORDER / (counts.AUTH + counts.ORDER);
    };
    const day110Count = userEvents.filter((event) => {
      const day = Math.floor((Date.parse(event.created_at) - Date.parse(dataset.startAt)) / (24 * 60 * 60 * 1_000));
      return day === 110;
    }).length;

    expect(countOrderShare(70, 84)).toBeGreaterThan(countOrderShare(30, 50));
    expect(day110Count).toBeGreaterThanOrEqual(8);
    expect(day110Count).toBeLessThanOrEqual(16);
    expect(userEvents.every((event) => event.injectedScenario === undefined)).toBe(true);
  });

  it('uses project audit action names and preserves unknown actions in OTHER', () => {
    const dataset = generateJeffreysSyntheticStudy({ seed: 47, userCount: 100, historyDays: 90 });
    const actions = new Set(dataset.events.map(({ action }) => action));
    expect(actions.has('LOGIN_SUCCESS')).toBe(true);
    expect(actions.has('ORDER_CREATED')).toBe(true);
    expect(actions.has('PRODUCT_UPDATED')).toBe(true);
    expect(actions.has('ADMIN_ORDERS_ACCESS_DENIED')).toBe(true);
    expect(actions.has('SYNTHETIC_UNKNOWN_ACTION')).toBe(true);

    const result = calculateJeffreysDivergence({ SYNTHETIC_UNKNOWN_ACTION: 40 }, { ANOMALY_STATUS_CHANGED: 20 }, {
      alpha: 0.5, minimumBaselineObservations: 1, minimumCurrentObservations: 1,
    });
    expect(ACTION_CATEGORY_MAP.SYNTHETIC_UNKNOWN_ACTION).toBeUndefined();
    expect(result.smoothedBaseline.OTHER).toBeGreaterThan(result.smoothedBaseline.AUTH);
    expect(result.smoothedCurrent.OTHER).toBeGreaterThan(result.smoothedCurrent.AUTH);
  });

  it('rejects sizes outside the study constraints', () => {
    expect(() => generateJeffreysSyntheticStudy({ seed: 1, userCount: 99, historyDays: 90 })).toThrow(/userCount/);
    expect(() => generateJeffreysSyntheticStudy({ seed: 1, userCount: 100, historyDays: 89 })).toThrow(/historyDays/);
  });
});
