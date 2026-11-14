import { describe, expect, it } from 'vitest';
import { addRareAndUnseenSyntheticActivity, scaleNormalSyntheticActivity } from '../src/jeffreysIndependentValidation.js';
import { generateJeffreysSyntheticStudy } from '../src/jeffreysSynthetic.js';

describe('independent synthetic validation variations', () => {
  it('uses deterministic intensity scaling while preserving injected scenario events and labels', () => {
    const base = generateJeffreysSyntheticStudy({ seed: 4319, userCount: 100, historyDays: 90 });
    const lowA = scaleNormalSyntheticActivity(base, 0.65);
    const lowB = scaleNormalSyntheticActivity(base, 0.65);
    const normal = scaleNormalSyntheticActivity(base, 1);
    const high = scaleNormalSyntheticActivity(base, 1.5);
    const injected = (dataset: typeof base) => dataset.events.filter((event) => event.injectedScenario);

    expect(lowA).toEqual(lowB);
    expect(lowA.events.length).toBeLessThan(normal.events.length);
    expect(high.events.length).toBeGreaterThan(normal.events.length);
    expect(injected(lowA)).toEqual(injected(base));
    expect(injected(high)).toEqual(injected(base));
    expect(lowA.episodes).toEqual(base.episodes);
    expect(high.episodes).toEqual(base.episodes);
    expect(high.events.every((event) => event.source === 'SYNTHETIC')).toBe(true);
  });

  it('adds a benign holdout probe with a rare known and an unseen action', () => {
    const base = generateJeffreysSyntheticStudy({ seed: 7919, userCount: 100, historyDays: 90 });
    const variation = addRareAndUnseenSyntheticActivity(base);
    const scenario = variation.episodes.find((episode) => episode.scenario === 'BENIGN_RARE_AND_UNSEEN_ACTIONS');
    const events = variation.events.filter((event) => event.user_id === scenario?.user_id &&
      Date.parse(event.created_at) >= Date.parse(scenario!.start) && Date.parse(event.created_at) < Date.parse(scenario!.end) &&
      (event.action === 'ANOMALY_STATUS_CHANGED' || event.action === 'SYNTHETIC_PREVIOUSLY_UNSEEN_ACTION'));

    expect(scenario?.label).toBe('BENIGN_TRANSIENT');
    expect(Date.parse(scenario!.start)).toBeGreaterThanOrEqual(Date.parse(base.splitAt));
    expect(events.filter((event) => event.action === 'ANOMALY_STATUS_CHANGED')).toHaveLength(6);
    expect(events.filter((event) => event.action === 'SYNTHETIC_PREVIOUSLY_UNSEEN_ACTION')).toHaveLength(6);
    expect(events.every((event) => event.source === 'SYNTHETIC')).toBe(true);
  });

  it('rejects implausible intensity factors before modifying the dataset', () => {
    const dataset = generateJeffreysSyntheticStudy({ seed: 12077, userCount: 100, historyDays: 90 });
    expect(() => scaleNormalSyntheticActivity(dataset, 0.49)).toThrow(/intensity/);
    expect(() => scaleNormalSyntheticActivity(dataset, 2.01)).toThrow(/intensity/);
  });
});
