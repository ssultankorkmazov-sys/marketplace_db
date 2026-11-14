import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const SEEDS = [4319, 7919, 12077, 20261114];
const INTENSITIES = [0.65, 1, 1.5];
const USER_COUNT = 120;
const HISTORY_DAYS = 120;
const BASELINE_DAYS = [30, 60];
const CURRENT_HOURS = [6, 12, 24];
const MINIMUMS = [{ baseline: 30, current: 10 }, { baseline: 50, current: 20 }, { baseline: 100, current: 40 }];
const ALPHA = 0.5;
const P95 = 0.95;
const P99 = 0.99;
const REPORT_PATH = 'server/reports/jeffreys-independent-validation-results.json';
const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;

function quantile(values, probability) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(probability * sorted.length) - 1)];
}

function metrics(matrix) {
  const precision = matrix.tp + matrix.fp ? matrix.tp / (matrix.tp + matrix.fp) : null;
  const recall = matrix.tp + matrix.fn ? matrix.tp / (matrix.tp + matrix.fn) : null;
  return {
    ...matrix,
    precision,
    recall,
    f1: precision === null || recall === null || precision + recall === 0 ? null : 2 * precision * recall / (precision + recall),
    falsePositiveRate: matrix.fp + matrix.tn ? matrix.fp / (matrix.fp + matrix.tn) : null,
  };
}

function addPrediction(matrix, positive, predicted) {
  if (positive) matrix[predicted ? 'tp' : 'fn'] += 1;
  else matrix[predicted ? 'fp' : 'tn'] += 1;
}

function lowerBound(values, target) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle] < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function upperBound(values, target) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle] <= target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function buildPrefixIndex(events) {
  const byUser = new Map();
  for (const event of events) {
    const list = byUser.get(event.user_id) ?? [];
    list.push({ time: Date.parse(event.created_at), action: event.action });
    byUser.set(event.user_id, list);
  }
  const index = new Map();
  for (const [userId, rows] of byUser) {
    const times = rows.map((row) => row.time);
    const actions = [...new Set(rows.map((row) => row.action))];
    const prefix = Object.fromEntries(actions.map((action) => [action, new Uint32Array(rows.length + 1)]));
    for (let i = 0; i < rows.length; i += 1) {
      for (const action of actions) prefix[action][i + 1] = prefix[action][i];
      prefix[rows[i].action][i + 1] += 1;
    }
    index.set(userId, { times, prefix });
  }
  return index;
}

function actionCountsInRange(prefixIndex, point) {
  const user = prefixIndex.get(point.user_id);
  if (!user) return { baseline: {}, current: {} };
  const baselineStart = lowerBound(user.times, Date.parse(point.baseline_start));
  const baselineEnd = lowerBound(user.times, Date.parse(point.baseline_end));
  const currentStart = lowerBound(user.times, Date.parse(point.current_start));
  const currentEnd = upperBound(user.times, Date.parse(point.current_end));
  const baseline = {};
  const current = {};
  for (const action of Object.keys(user.prefix)) {
    baseline[action] = user.prefix[action][baselineEnd] - user.prefix[action][baselineStart];
    current[action] = user.prefix[action][currentEnd] - user.prefix[action][currentStart];
  }
  return { baseline, current };
}

function eventTimesByUser(events) {
  const byUser = new Map();
  for (const event of events) {
    const values = byUser.get(event.user_id) ?? new Set();
    values.add(Date.parse(event.created_at));
    byUser.set(event.user_id, values);
  }
  return byUser;
}

function labelPoint(point, episodes, profileByUser) {
  const start = Date.parse(point.current_start);
  const end = Date.parse(point.current_end);
  const episode = episodes.find((item) => item.user_id === point.user_id && item.label === 'ANOMALOUS');
  if (episode) {
    const episodeStart = Date.parse(episode.start);
    const episodeEnd = Date.parse(episode.end);
    if (start >= episodeStart && end <= episodeEnd) return { label: 'positive', scenario: episode.scenario };
    if (start < episodeEnd && end > episodeStart) return { label: 'transition', scenario: episode.scenario };
  }
  const benign = episodes.find((item) => item.user_id === point.user_id && item.label === 'BENIGN_TRANSIENT' && start < Date.parse(item.end) && end > Date.parse(item.start));
  return { label: 'negative', scenario: benign?.scenario ?? null, profile: profileByUser.get(point.user_id) };
}

function scoreRows(rows, threshold) {
  const matrix = { tp: 0, fp: 0, tn: 0, fn: 0 };
  for (const row of rows) addPrediction(matrix, row.label === 'positive', row.divergence > threshold);
  return metrics(matrix);
}

function scenarioMetrics(rows, threshold) {
  const result = {};
  for (const row of rows) {
    if (!row.scenario) continue;
    const record = result[row.scenario] ?? { positiveWindows: 0, detected: 0, missed: 0, benignWindows: 0, falseSignals: 0 };
    if (row.label === 'positive') {
      record.positiveWindows += 1;
      if (row.divergence > threshold) record.detected += 1;
      else record.missed += 1;
    } else {
      record.benignWindows += 1;
      if (row.divergence > threshold) record.falseSignals += 1;
    }
    result[row.scenario] = record;
  }
  for (const record of Object.values(result)) {
    record.recall = record.positiveWindows ? record.detected / record.positiveWindows : null;
    record.falseSignalRate = record.benignWindows ? record.falseSignals / record.benignWindows : null;
  }
  return result;
}

function normalProfileMetrics(rows, threshold) {
  const result = {};
  for (const row of rows) {
    if (row.label !== 'negative' || !row.profile) continue;
    const record = result[row.profile] ?? { windows: 0, falseSignals: 0 };
    record.windows += 1;
    if (row.divergence > threshold) record.falseSignals += 1;
    result[row.profile] = record;
  }
  for (const record of Object.values(result)) record.falseSignalRate = record.windows ? record.falseSignals / record.windows : null;
  return result;
}

async function main() {
  const [generator, variation, replay, calibration, grouping, formula] = await Promise.all([
    import('../dist/jeffreysSynthetic.js'),
    import('../dist/jeffreysIndependentValidation.js'),
    import('../dist/jeffreysReplay.js'),
    import('../dist/jeffreysCalibration.js'),
    import('../dist/jeffreysGroupingStudy.js'),
    import('../dist/jeffreys.js'),
  ]);
  const specs = [
    { key: 'A_CURRENT', variant: 'A_CURRENT', spec: grouping.createGroupingSpec('A_CURRENT') },
    { key: 'B_DETAILED_AUTH', variant: 'B_DETAILED_AUTH', spec: grouping.createGroupingSpec('B_DETAILED_AUTH') },
  ];
  const baseDatasets = SEEDS.map((seed) => generator.generateJeffreysSyntheticStudy({ seed, userCount: USER_COUNT, historyDays: HISTORY_DAYS }));
  const rowsByIntensity = new Map(INTENSITIES.map((intensity) => [intensity, new Map()]));
  const generationSummary = [];

  for (const base of baseDatasets) {
    for (const intensity of INTENSITIES) {
      const scaled = variation.scaleNormalSyntheticActivity(base, intensity);
      const dataset = variation.addRareAndUnseenSyntheticActivity(scaled);
      generationSummary.push({ seed: base.seed, intensity, eventCount: dataset.events.length });
      const profileByUser = new Map(dataset.profiles.map((entry) => [entry.user_id, entry.profile]));
      const timesByUser = eventTimesByUser(dataset.events);
      const prefixes = buildPrefixIndex(dataset.events);

      for (const baselineDays of BASELINE_DAYS) {
        for (const currentWindowHours of CURRENT_HOURS) {
          const evaluationStepHours = currentWindowHours;
          const minOne = { baselineDays, currentWindowHours, evaluationStepHours, alpha: ALPHA, minimumBaselineObservations: 1, minimumCurrentObservations: 1 };
          const timeline = [...replay.replayJeffreysEvents(dataset.events, [minOne])];
          const calibrationStart = new Date(Date.parse(dataset.startAt) + baselineDays * DAY_MS).toISOString();
          const calibrationSelection = Date.parse(calibrationStart) < Date.parse(dataset.splitAt)
            ? calibration.selectNonOverlappingReplayPoints(timeline, { startInclusive: calibrationStart, endExclusive: dataset.splitAt }, dataset.startAt, timesByUser)
            : { points: [], excludedOverlappingWindow: 0, excludedSharedBoundaryEvent: 0 };
          const holdoutSelection = calibration.selectNonOverlappingReplayPoints(timeline, { startInclusive: dataset.splitAt, endExclusive: dataset.endAt }, dataset.startAt, timesByUser);

          for (const definition of specs) {
            const scoreByWindow = new Map();
            for (const point of timeline) {
              const counts = actionCountsInRange(prefixes, point);
              const result = grouping.calculateGroupedJeffreysDivergence(counts.baseline, counts.current, definition.spec, ALPHA);
              scoreByWindow.set(`${point.user_id}|${point.current_start}|${point.current_end}`, result);
            }
            for (const minimum of MINIMUMS) {
              const key = `${baselineDays}|${currentWindowHours}|${minimum.baseline}|${minimum.current}`;
              const variantRows = rowsByIntensity.get(intensity);
              const variantKey = definition.key;
              const config = variantRows.get(`${variantKey}|${key}`) ?? {
                variant: variantKey,
                baselineDays,
                currentWindowHours,
                evaluationStepHours,
                minimumBaselineObservations: minimum.baseline,
                minimumCurrentObservations: minimum.current,
                calibrationRows: [],
                holdoutRows: [],
                insufficientCalibrationWindows: 0,
                insufficientHoldoutWindows: 0,
                transitionWindowsExcluded: 0,
                overlappingCalibrationWindowsExcluded: 0,
                overlappingHoldoutWindowsExcluded: 0,
              };
              const keyFor = (point) => `${point.user_id}|${point.current_start}|${point.current_end}`;
              const calibrationScored = calibrationSelection.points.map((point) => ({ point, score: scoreByWindow.get(keyFor(point)) }));
              const calibrationSufficient = calibrationScored.filter(({ score }) => score.baselineObservations >= minimum.baseline && score.currentObservations >= minimum.current);
              config.insufficientCalibrationWindows += calibrationScored.length - calibrationSufficient.length;
              config.overlappingCalibrationWindowsExcluded += calibrationSelection.excludedOverlappingWindow + calibrationSelection.excludedSharedBoundaryEvent;
              for (const { score } of calibrationSufficient) config.calibrationRows.push({ seed: base.seed, divergence: score.divergence });

              const holdoutScored = holdoutSelection.points.map((point) => ({ point, score: scoreByWindow.get(keyFor(point)) }));
              const holdoutSufficient = holdoutScored.filter(({ score }) => score.baselineObservations >= minimum.baseline && score.currentObservations >= minimum.current);
              config.insufficientHoldoutWindows += holdoutScored.length - holdoutSufficient.length;
              config.overlappingHoldoutWindowsExcluded += holdoutSelection.excludedOverlappingWindow + holdoutSelection.excludedSharedBoundaryEvent;
              for (const { point, score } of holdoutSufficient) {
                const truth = labelPoint(point, dataset.episodes, profileByUser);
                if (truth.label === 'transition') {
                  config.transitionWindowsExcluded += 1;
                  continue;
                }
                config.holdoutRows.push({ seed: base.seed, ...truth, divergence: score.divergence });
              }
              variantRows.set(`${variantKey}|${key}`, config);
            }
          }
        }
      }
    }
  }

  const intensityResults = [];
  for (const intensity of INTENSITIES) {
    const variants = [];
    for (const definition of specs) {
      const configurations = [];
      for (const config of rowsByIntensity.get(intensity).values()) {
        if (config.variant !== definition.key) continue;
        const p95 = quantile(config.calibrationRows.map((row) => row.divergence), P95);
        const p99 = quantile(config.calibrationRows.map((row) => row.divergence), P99);
        const bySeed = SEEDS.map((seed) => {
          const scores = config.calibrationRows.filter((row) => row.seed === seed).map((row) => row.divergence);
          return { seed, sufficientCalibrationWindows: scores.length, p95: quantile(scores, P95), p99: quantile(scores, P99) };
        });
        const holdout = config.holdoutRows;
        const { calibrationRows, holdoutRows, ...metadata } = config;
        const evaluation = p95 === null ? null : scoreRows(holdout, p95);
        configurations.push({
          ...metadata,
          calibration: {
            selectedQuantile: P95,
            thresholdP95: p95,
            comparisonP99: p99,
            sufficientWindows: calibrationRows.length,
            bySeed,
            thresholdSpreadP95: bySeed.every((entry) => entry.p95 !== null)
              ? {
                min: Math.min(...bySeed.map((entry) => entry.p95)),
                max: Math.max(...bySeed.map((entry) => entry.p95)),
                range: Math.max(...bySeed.map((entry) => entry.p95)) - Math.min(...bySeed.map((entry) => entry.p95)),
              } : null,
          },
          holdout: {
            evaluationStatus: p95 === null ? 'NOT_EVALUABLE_NO_CALIBRATION_THRESHOLD' : 'EVALUATED',
            sufficientWindows: holdout.length,
            exceedancesAboveP95: p95 === null ? null : holdout.filter((row) => row.divergence > p95).length,
            exceedanceRate: p95 === null || holdout.length === 0 ? null : holdout.filter((row) => row.divergence > p95).length / holdout.length,
            overall: evaluation,
            byScenario: p95 === null ? null : scenarioMetrics(holdout, p95),
            normalProfileFalseSignals: p95 === null ? null : normalProfileMetrics(holdout, p95),
            perSeed: p95 === null ? null : Object.fromEntries(SEEDS.map((seed) => [seed, scoreRows(holdout.filter((row) => row.seed === seed), p95)])),
          },
        });
      }
      variants.push({
        key: definition.key,
        purpose: definition.key === 'A_CURRENT' ? 'PRIMARY_CANDIDATE_ALL_SCENARIOS' : 'SECONDARY_COMPARISON_FOCUS_LOGIN_FAILED',
        categories: definition.spec.categories,
        configurations,
      });
    }
    intensityResults.push({ intensity, generatedEventCounts: generationSummary.filter((row) => row.intensity === intensity), variants });
  }

  const output = {
    source: 'SYNTHETIC',
    generatedAt: new Date().toISOString(),
    noDatabaseAccess: true,
    noProductionData: true,
    noIncidentCreation: true,
    independence: {
      seeds: SEEDS,
      seedsNotPresentInPreviousJeffreysExperiments: true,
      priorStudySeedsAudited: [117, 239, 587, 503, 504, 505, 507, 508, 781, 782, 19, 47, 83],
      sameGeneratorAcrossIntensityFactors: true,
      priorReportsUnmodified: true,
    },
    generation: {
      usersPerSeed: USER_COUNT,
      historyDays: HISTORY_DAYS,
      chronologicalSplit: '84 calibration days / 36 holdout days (70% / 30%).',
      routineIntensityFactors: INTENSITIES,
      intensityMethod: 'Deterministically thin routine non-injected events below 1.0 or add deterministic same-action copies above 1.0; all injected ground-truth events and labels remain unchanged.',
      addedRareUnseenProbe: 'In holdout, six actual rare action ANOMALY_STATUS_CHANGED events plus six SYNTHETIC_PREVIOUSLY_UNSEEN_ACTION events over two hours, labeled benign.',
      eventCountsBySeedAndIntensity: generationSummary,
      scenarioDefinitions: [
        { name: 'AUTH_TO_ORDER_SHIFT', truth: 'ANOMALOUS', definition: 'Existing generator: four bursts/day for eight days, each 8 ORDER and 2 AUTH actions.' },
        { name: 'LOGIN_FAILED_SPIKE', truth: 'ANOMALOUS', definition: 'Existing generator: 16 LOGIN_FAILED actions/day for eight days.' },
        { name: 'ADMIN_DENIED_SPIKE', truth: 'ANOMALOUS', definition: 'Existing generator: 12 admin-denied actions/day for eight days.' },
        { name: 'UNUSUAL_ACTION_MIX', truth: 'ANOMALOUS', definition: 'Existing generator: 20 unknown-action events/day for eight days.' },
        { name: 'TRANSIENT_BURST_BENIGN', truth: 'BENIGN', definition: 'Existing generator: 12 LOGIN_SUCCESS actions within about 20 minutes.' },
        { name: 'NATURAL_GRADUAL_CHANGE', truth: 'BENIGN_PROFILE', definition: 'Existing gradual AUTH-to-ORDER profile; not an injected anomaly episode.' },
        { name: 'BENIGN_RARE_AND_UNSEEN_ACTIONS', truth: 'BENIGN', definition: 'Additional six known rare action and six unseen-action events over two hours in holdout.' },
        { name: 'NORMAL_ACTIVITY', truth: 'BENIGN', definition: 'Unmodified existing regular, rarely-active, active-buyer, irregular and admin-operator profiles.' },
      ],
    },
    grouping: {
      A_CURRENT: { categories: ['AUTH', 'ORDER', 'ADMIN_DENIED', 'PRODUCT_ADMIN', 'OTHER'], role: 'Primary candidate across all scenarios.' },
      B_DETAILED_AUTH: { categories: ['USER_REGISTERED', 'LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGOUT', 'ORDER', 'ADMIN_DENIED', 'PRODUCT_ADMIN', 'OTHER'], role: 'Secondary comparison; interpret primarily for LOGIN_FAILED.' },
      C_DETAILED_ACTIONS: 'Not evaluated in this independent validation.',
    },
    methodology: {
      formula: 'J(P,Q) = sum_i (p_i-q_i) * ln(p_i/q_i); unchanged.',
      alpha: ALPHA,
      baselineDays: BASELINE_DAYS,
      currentWindowHours: CURRENT_HOURS,
      minimums: MINIMUMS.map(({ baseline, current }) => `${baseline}/${current}`),
      thresholdSelection: 'P95 of sufficient calibration-only windows pooled across new seeds, separately by intensity, grouping and configuration; P99 recorded for comparison.',
      noFutureLeakage: 'Replay computes each baseline before its current window. Calibration current windows end before the 70/30 split; holdout windows start at/after the split. No holdout scores determine thresholds.',
      overlapHandling: 'Current windows are stepped by their own duration and passed through non-overlap selection per user; shared-boundary events are not double-counted.',
      insufficientWindows: 'Counted separately for calibration and holdout; excluded from thresholds and confusion metrics.',
      overallAndScenarioMetricsSeparated: true,
      holdoutExceedanceRateNote: 'Includes known positive synthetic episodes; FPR uses benign-labeled holdout windows only.',
      intensityGroundTruth: 'Only routine activity is scaled. Injected episodes, episode times and labels are preserved; the rare/unseen benign probe is identical at each intensity.',
    },
    intensityResults,
    limits: [
      'Every event and metric is synthetic; this report does not establish production detection quality.',
      'Four new seeds improve coverage but remain samples from one deterministic generator design.',
      'Routine activity scaling is a controlled thinning/copying experiment, not a model of every real traffic increase.',
      'Non-overlapping windows from the same user can remain statistically correlated.',
      'No real historical data, database, worker, incidents, rules, risk score or severity were accessed or changed.',
    ],
  };

  await writeFile(resolve(REPORT_PATH), `${JSON.stringify(output, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  console.log(JSON.stringify({ reportPath: resolve(REPORT_PATH), source: output.source, seeds: SEEDS, intensities: INTENSITIES, eventSets: generationSummary.length }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Independent Jeffreys validation failed.');
  process.exitCode = 1;
});
