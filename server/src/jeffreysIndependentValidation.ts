import type { SyntheticAuditEvent, SyntheticStudyDataset } from './jeffreysSynthetic.js';

const DAY_MS = 24 * 60 * 60 * 1_000;

function stableUnitValue(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 0x1_0000_0000;
}

/** Scale only routine synthetic activity; injected ground-truth events are retained unchanged. */
export function scaleNormalSyntheticActivity(
  dataset: SyntheticStudyDataset,
  intensity: number,
): SyntheticStudyDataset {
  if (!Number.isFinite(intensity) || intensity < 0.5 || intensity > 2) {
    throw new Error('Synthetic activity intensity must be between 0.5 and 2.');
  }
  const events: SyntheticAuditEvent[] = [];
  dataset.events.forEach((event, index) => {
    if (event.injectedScenario) {
      events.push(event);
      return;
    }
    const stableValue = stableUnitValue(`${dataset.seed}|${index}|${event.user_id}|${event.action}|${event.created_at}`);
    if (intensity < 1 && stableValue >= intensity) return;
    events.push(event);
    if (intensity > 1 && stableValue < intensity - 1) {
      events.push({
        user_id: event.user_id,
        action: event.action,
        created_at: new Date(Date.parse(event.created_at) + 1_000).toISOString(),
        status: event.status,
        source: 'SYNTHETIC',
      });
    }
  });
  events.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.user_id - b.user_id || a.action.localeCompare(b.action));
  return { ...dataset, events };
}

/** Adds one labeled benign holdout probe containing a rare known and an unseen synthetic action. */
export function addRareAndUnseenSyntheticActivity(dataset: SyntheticStudyDataset): SyntheticStudyDataset {
  const regularUsers = dataset.profiles.filter((item) => item.profile === 'regular');
  const target = regularUsers[5];
  if (!target) throw new Error('Synthetic dataset needs at least six regular-profile users.');
  const holdoutDays = dataset.historyDays - dataset.calibrationDays;
  const day = dataset.calibrationDays + Math.floor(holdoutDays * 0.5);
  const start = Date.parse(dataset.startAt) + day * DAY_MS;
  const end = start + 6 * 60 * 60 * 1_000;
  const probeActions = [
    ...Array.from({ length: 6 }, () => 'ANOMALY_STATUS_CHANGED'),
    ...Array.from({ length: 6 }, () => 'SYNTHETIC_PREVIOUSLY_UNSEEN_ACTION'),
  ];
  const addedEvents = probeActions.map((action, index): SyntheticAuditEvent => ({
    user_id: target.user_id,
    action,
    created_at: new Date(start + index * 20 * 60 * 1_000).toISOString(),
    status: 'SUCCESS',
    source: 'SYNTHETIC',
  }));
  const events = [...dataset.events, ...addedEvents].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.user_id - b.user_id || a.action.localeCompare(b.action));
  return {
    ...dataset,
    events,
    episodes: [...dataset.episodes, {
      scenario: 'BENIGN_RARE_AND_UNSEEN_ACTIONS',
      user_id: target.user_id,
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      label: 'BENIGN_TRANSIENT',
    }],
  };
}
