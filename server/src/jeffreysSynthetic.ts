const DAY_MS = 24 * 60 * 60 * 1_000;
const HOUR_MS = 60 * 60 * 1_000;

export const SYNTHETIC_PROFILE_NAMES = [
  'regular', 'rarely_active', 'active_buyer', 'irregular', 'gradual_change', 'admin_operator',
] as const;
export type SyntheticProfile = typeof SYNTHETIC_PROFILE_NAMES[number];

export const SYNTHETIC_SCENARIO_NAMES = [
  'AUTH_TO_ORDER_SHIFT', 'LOGIN_FAILED_SPIKE', 'ADMIN_DENIED_SPIKE',
  'UNUSUAL_ACTION_MIX', 'TRANSIENT_BURST_BENIGN', 'BENIGN_RARE_AND_UNSEEN_ACTIONS',
] as const;
export type SyntheticScenarioName = typeof SYNTHETIC_SCENARIO_NAMES[number];

export interface SyntheticStudyOptions {
  seed: number;
  userCount?: number;
  historyDays?: number;
  startAt?: string;
}

export interface SyntheticAuditEvent {
  user_id: number;
  action: string;
  created_at: string;
  status: 'SUCCESS' | 'FAILURE';
  source: 'SYNTHETIC';
  injectedScenario?: SyntheticScenarioName;
}

export interface SyntheticEpisode {
  scenario: SyntheticScenarioName;
  user_id: number;
  start: string;
  end: string;
  label: 'ANOMALOUS' | 'BENIGN_TRANSIENT';
}

export interface SyntheticStudyDataset {
  source: 'SYNTHETIC';
  seed: number;
  userCount: number;
  historyDays: number;
  calibrationDays: number;
  splitAt: string;
  startAt: string;
  endAt: string;
  profiles: Array<{ user_id: number; profile: SyntheticProfile }>;
  events: SyntheticAuditEvent[];
  episodes: SyntheticEpisode[];
}

const ACTIONS = {
  AUTH: ['LOGIN_SUCCESS', 'LOGOUT', 'LOGIN_FAILED', 'USER_REGISTERED'],
  ORDER: ['ORDER_CREATED', 'ORDER_CREATE_FAILED', 'ORDER_STATUS_CHANGED'],
  ADMIN_DENIED: ['ADMIN_LOGS_ACCESS_DENIED', 'ADMIN_ORDERS_ACCESS_DENIED', 'ADMIN_ANOMALIES_ACCESS_DENIED', 'PRODUCTS_ACCESS_DENIED'],
  PRODUCT_ADMIN: ['PRODUCT_CREATED', 'PRODUCT_UPDATED', 'PRODUCT_DELETED'],
  OTHER: ['ANOMALY_STATUS_CHANGED', 'SYNTHETIC_UNKNOWN_ACTION'],
} as const;

class SeededRandom {
  private state: number;
  constructor(seed: number) { this.state = seed >>> 0; }
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  }
  int(maxExclusive: number): number { return Math.floor(this.next() * maxExclusive); }
  chance(probability: number): boolean { return this.next() < probability; }
  pick<T>(values: readonly T[]): T { return values[this.int(values.length)]; }
}

function profileAssignments(userCount: number): SyntheticProfile[] {
  const shares: Array<[SyntheticProfile, number]> = [
    ['regular', 0.35], ['rarely_active', 0.20], ['active_buyer', 0.20],
    ['irregular', 0.15], ['gradual_change', 0.067], ['admin_operator', 0.033],
  ];
  const assignments: SyntheticProfile[] = [];
  for (const [profile, share] of shares) {
    const count = Math.floor(userCount * share);
    for (let index = 0; index < count; index += 1) assignments.push(profile);
  }
  while (assignments.length < userCount) assignments.push('regular');
  return assignments;
}

function statusForAction(action: string): 'SUCCESS' | 'FAILURE' {
  return action === 'LOGIN_FAILED' || action === 'ORDER_CREATE_FAILED' || action.endsWith('_ACCESS_DENIED')
    ? 'FAILURE' : 'SUCCESS';
}

export function generateJeffreysSyntheticStudy(options: SyntheticStudyOptions): SyntheticStudyDataset {
  const userCount = options.userCount ?? 120;
  const historyDays = options.historyDays ?? 120;
  if (!Number.isSafeInteger(options.seed) || options.seed < 1 || options.seed > 0xffff_ffff) {
    throw new Error('Synthetic seed must be a positive 32-bit integer.');
  }
  if (!Number.isSafeInteger(userCount) || userCount < 100 || userCount > 200) {
    throw new Error('Synthetic userCount must be between 100 and 200.');
  }
  if (!Number.isSafeInteger(historyDays) || historyDays < 90 || historyDays > 120) {
    throw new Error('Synthetic historyDays must be between 90 and 120.');
  }
  const start = Date.parse(options.startAt ?? '2025-01-01T00:00:00.000Z');
  if (!Number.isFinite(start)) throw new Error('Synthetic startAt must be a valid timestamp.');
  const random = new SeededRandom(options.seed);
  const calibrationDays = Math.floor(historyDays * 0.7);
  const profiles = profileAssignments(userCount).map((profile, index) => ({
    user_id: 10_000_000_000 + options.seed * 1_000 + index + 1,
    profile,
  }));
  const byId = new Map(profiles.map((profile) => [profile.user_id, profile.profile]));
  const events: SyntheticAuditEvent[] = [];
  const episodes: SyntheticEpisode[] = [];
  const makeTime = (day: number, minute: number, withinMinuteMs = random.int(60_000)) =>
    new Date(start + day * DAY_MS + minute * 60_000 + withinMinuteMs).toISOString();
  const addAction = (userId: number, day: number, action: string, minute?: number, injectedScenario?: SyntheticScenarioName) => {
    const eventMinute = minute ?? random.int(24 * 60);
    events.push({
      user_id: userId,
      action,
      status: statusForAction(action),
      created_at: makeTime(day, eventMinute),
      source: 'SYNTHETIC',
      ...(injectedScenario ? { injectedScenario } : {}),
    });
  };
  const emitCategory = (userId: number, day: number, category: keyof typeof ACTIONS) => {
    addAction(userId, day, random.pick(ACTIONS[category]));
  };
  const emitSession = (userId: number, day: number, count: number, weights: { AUTH: number; ORDER: number; ADMIN_DENIED: number; PRODUCT_ADMIN: number; OTHER: number }, burst = false) => {
    const sessionStart = random.int(24 * 60 - 90);
    for (let eventIndex = 0; eventIndex < count; eventIndex += 1) {
      const sample = random.next();
      const category = sample < weights.AUTH ? 'AUTH'
        : sample < weights.AUTH + weights.ORDER ? 'ORDER'
          : sample < weights.AUTH + weights.ORDER + weights.ADMIN_DENIED ? 'ADMIN_DENIED'
            : sample < weights.AUTH + weights.ORDER + weights.ADMIN_DENIED + weights.PRODUCT_ADMIN ? 'PRODUCT_ADMIN'
              : 'OTHER';
      const minute = burst ? sessionStart + random.int(60) : random.int(24 * 60);
      emitCategory(userId, day, category);
      // Keep all events in a burst within one short session; ordinary actions
      // retain their independent daily timestamps.
      const emitted = events[events.length - 1];
      emitted.created_at = makeTime(day, minute);
    }
  };

  for (let index = 0; index < profiles.length; index += 1) {
    const { user_id: userId, profile } = profiles[index];
    const weeklyOffset = random.int(7);
    for (let day = 0; day < historyDays; day += 1) {
      if (profile === 'regular') {
        if (random.chance(0.9)) {
          const count = 1 + random.int(3);
          for (let event = 0; event < count; event += 1) emitCategory(userId, day, 'AUTH');
          if (random.chance(0.12)) emitCategory(userId, day, 'ORDER');
          if (random.chance(0.005)) emitCategory(userId, day, 'ADMIN_DENIED');
        }
      } else if (profile === 'rarely_active') {
        if (random.chance(0.18)) emitSession(userId, day, 1 + random.int(3), { AUTH: 0.8, ORDER: 0.14, ADMIN_DENIED: 0, PRODUCT_ADMIN: 0, OTHER: 0.06 });
      } else if (profile === 'active_buyer') {
        if (random.chance(0.82)) {
          const authCount = 1 + random.int(2);
          for (let event = 0; event < authCount; event += 1) emitCategory(userId, day, 'AUTH');
          const orderCount = random.chance(0.72) ? 1 + random.int(2) : 0;
          for (let event = 0; event < orderCount; event += 1) emitCategory(userId, day, 'ORDER');
        }
      } else if (profile === 'irregular') {
        if ((day + weeklyOffset) % 7 === 0 && random.chance(0.82)) {
          emitSession(userId, day, 8 + random.int(11), { AUTH: 0.65, ORDER: 0.29, ADMIN_DENIED: 0.03, PRODUCT_ADMIN: 0, OTHER: 0.03 }, true);
        }
      } else if (profile === 'gradual_change') {
        if (random.chance(0.82)) {
          const progress = Math.max(0, Math.min(1, (day - historyDays * 0.25) / (historyDays * 0.65)));
          const weights = { AUTH: 0.82 - 0.4 * progress, ORDER: 0.15 + 0.4 * progress, ADMIN_DENIED: 0.02, PRODUCT_ADMIN: 0, OTHER: 0.01 };
          // Enough daily volume for the minimum 30/10 configuration to score
          // 24-hour windows while preserving a gradual, non-injected mix shift.
          emitSession(userId, day, 8 + random.int(9), weights);
        }
      } else if (profile === 'admin_operator') {
        if (random.chance(0.9)) {
          emitCategory(userId, day, 'AUTH');
          if (random.chance(0.55)) emitCategory(userId, day, 'PRODUCT_ADMIN');
          if (random.chance(0.04)) emitCategory(userId, day, 'ADMIN_DENIED');
          if (day % 10 === 0 && random.chance(0.6)) emitCategory(userId, day, 'OTHER');
        }
      }
    }
  }

  const holdoutDays = historyDays - calibrationDays;
  const episodeStartDay = calibrationDays + Math.max(2, Math.floor(holdoutDays * 0.17));
  const episodeEndDay = Math.min(historyDays - 2, episodeStartDay + 8);
  const regularUsers = profiles.filter((item) => item.profile === 'regular');
  const targets = [
    { scenario: 'AUTH_TO_ORDER_SHIFT' as const, user: regularUsers[0] },
    { scenario: 'LOGIN_FAILED_SPIKE' as const, user: regularUsers[1] },
    { scenario: 'ADMIN_DENIED_SPIKE' as const, user: regularUsers[2] },
    { scenario: 'UNUSUAL_ACTION_MIX' as const, user: regularUsers[3] },
  ];

  for (const { scenario, user } of targets) {
    const userId = user.user_id;
    const startAt = start + episodeStartDay * DAY_MS;
    const endAt = start + episodeEndDay * DAY_MS;
    episodes.push({ scenario, user_id: userId, start: new Date(startAt).toISOString(), end: new Date(endAt).toISOString(), label: 'ANOMALOUS' });
    for (let day = episodeStartDay; day < episodeEndDay; day += 1) {
      if (scenario === 'AUTH_TO_ORDER_SHIFT') {
        // Four short sessions/day, with a sustained change in the AUTH/ORDER mix.
        for (let block = 0; block < 4; block += 1) {
          const blockStart = block * 360;
          for (let index = 0; index < 10; index += 1) {
            addAction(userId, day, index < 8 ? random.pick(ACTIONS.ORDER) : random.pick(ACTIONS.AUTH), blockStart + random.int(8), scenario);
          }
        }
      } else if (scenario === 'LOGIN_FAILED_SPIKE') {
        for (let index = 0; index < 16; index += 1) addAction(userId, day, 'LOGIN_FAILED', random.int(60), scenario);
      } else if (scenario === 'ADMIN_DENIED_SPIKE') {
        for (let index = 0; index < 12; index += 1) addAction(userId, day, random.pick(ACTIONS.ADMIN_DENIED), random.int(60), scenario);
      } else {
        // A borderline shift into OTHER; the event is retained and categorized by
        // the existing unknown-action fallback rather than dropped.
        for (let index = 0; index < 10; index += 1) addAction(userId, day, 'SYNTHETIC_UNKNOWN_ACTION', random.int(8), scenario);
        for (let index = 0; index < 10; index += 1) addAction(userId, day, 'SYNTHETIC_UNKNOWN_ACTION', 360 + random.int(8), scenario);
      }
    }
  }

  const transientUser = regularUsers[4];
  const transientDay = Math.min(historyDays - 2, calibrationDays + Math.floor(holdoutDays * 0.62));
  const transientStart = start + transientDay * DAY_MS;
  episodes.push({
    scenario: 'TRANSIENT_BURST_BENIGN',
    user_id: transientUser.user_id,
    start: new Date(transientStart).toISOString(),
    end: new Date(transientStart + 6 * HOUR_MS).toISOString(),
    label: 'BENIGN_TRANSIENT',
  });
  for (let index = 0; index < 12; index += 1) addAction(transientUser.user_id, transientDay, 'LOGIN_SUCCESS', random.int(20), 'TRANSIENT_BURST_BENIGN');

  events.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.user_id - b.user_id || a.action.localeCompare(b.action));
  const startAt = new Date(start).toISOString();
  const endAt = new Date(start + historyDays * DAY_MS).toISOString();
  return {
    source: 'SYNTHETIC',
    seed: options.seed,
    userCount,
    historyDays,
    calibrationDays,
    splitAt: new Date(start + calibrationDays * DAY_MS).toISOString(),
    startAt,
    endAt,
    profiles,
    events,
    episodes,
  };
}
