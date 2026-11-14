import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const SEEDS = [117, 239, 587];
const USER_COUNT = 120;
const HISTORY_DAYS = 120;
const BASELINE_DAYS = [30, 60, 90];
const CURRENT_HOURS = [6, 12, 24];
const MINIMUMS = [
  { baseline: 30, current: 10 },
  { baseline: 50, current: 20 },
  { baseline: 100, current: 40 },
];
const ACTION_FREQUENCY_THRESHOLDS = [10, 25, 50];
const ALPHA = 0.5;
const REPORT_PATH = 'server/reports/jeffreys-grouping-comparison-results-v3.json';
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

function countsInRange(prefixIndex, point) {
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
  const anomaly = episodes.find((episode) => episode.label === 'ANOMALOUS' && episode.user_id === point.user_id);
  if (anomaly) {
    const anomalyStart = Date.parse(anomaly.start);
    const anomalyEnd = Date.parse(anomaly.end);
    if (start >= anomalyStart && end <= anomalyEnd) return { label: 'positive', scenario: anomaly.scenario };
    if (start < anomalyEnd && end > anomalyStart) return { label: 'transition', scenario: anomaly.scenario };
  }
  const benign = episodes.find((episode) => episode.label === 'BENIGN_TRANSIENT' && episode.user_id === point.user_id && start < Date.parse(episode.end) && end > Date.parse(episode.start));
  return { label: 'negative', scenario: benign?.scenario ?? null, profile: profileByUser.get(point.user_id) };
}

function confusion(rows, threshold) {
  const result = { tp: 0, fp: 0, tn: 0, fn: 0 };
  for (const row of rows) addPrediction(result, row.label === 'positive', row.divergence > threshold);
  return metrics(result);
}

function summarizeScenarios(rows, threshold) {
  const result = {};
  for (const row of rows) {
    if (!row.scenario) continue;
    const entry = result[row.scenario] ?? { positiveWindows: 0, detected: 0, missed: 0, benignWindows: 0, falseSignals: 0 };
    const predicted = row.divergence > threshold;
    if (row.label === 'positive') {
      entry.positiveWindows += 1;
      if (predicted) entry.detected += 1;
      else entry.missed += 1;
    } else {
      entry.benignWindows += 1;
      if (predicted) entry.falseSignals += 1;
    }
    result[row.scenario] = entry;
  }
  for (const entry of Object.values(result)) {
    entry.recall = entry.positiveWindows ? entry.detected / entry.positiveWindows : null;
    entry.falseSignalRate = entry.benignWindows ? entry.falseSignals / entry.benignWindows : null;
  }
  return result;
}

function summarizeNormalProfiles(rows, threshold) {
  const result = {};
  for (const row of rows) {
    if (row.label !== 'negative' || !row.profile) continue;
    const entry = result[row.profile] ?? { windows: 0, falseSignals: 0 };
    entry.windows += 1;
    if (row.divergence > threshold) entry.falseSignals += 1;
    result[row.profile] = entry;
  }
  for (const entry of Object.values(result)) entry.falseSignalRate = entry.windows ? entry.falseSignals / entry.windows : null;
  return result;
}

async function main() {
  const [syntheticModule, replayModule, calibrationModule, groupingModule] = await Promise.all([
    import('../dist/jeffreysSynthetic.js'),
    import('../dist/jeffreysReplay.js'),
    import('../dist/jeffreysCalibration.js'),
    import('../dist/jeffreysGroupingStudy.js'),
  ]);
  const datasets = SEEDS.map((seed) => syntheticModule.generateJeffreysSyntheticStudy({ seed, userCount: USER_COUNT, historyDays: HISTORY_DAYS }));
  const variantDefinitionsBySeed = new Map();
  for (const dataset of datasets) {
    const calibrationActions = groupingModule.calibrationActionCounts(dataset.events, dataset.splitAt);
    const definitions = [
      { key: 'A_CURRENT', frequencyThreshold: null, grouping: groupingModule.createGroupingSpec('A_CURRENT') },
      { key: 'B_DETAILED_AUTH', frequencyThreshold: null, grouping: groupingModule.createGroupingSpec('B_DETAILED_AUTH') },
      ...ACTION_FREQUENCY_THRESHOLDS.map((threshold) => ({
        key: `C_DETAILED_ACTIONS_${threshold}`,
        frequencyThreshold: threshold,
        grouping: groupingModule.createGroupingSpec('C_DETAILED_ACTIONS', calibrationActions, threshold),
      })),
    ];
    variantDefinitionsBySeed.set(dataset.seed, definitions.map(({ key, frequencyThreshold, grouping }) => ({
      key,
      variant: grouping.variant,
      frequencyThreshold,
      categories: grouping.categories,
      grouping,
      calibrationActions,
      prefixIndex: buildPrefixIndex(dataset.events),
    })));
  }

  const results = [];
  for (const baselineDays of BASELINE_DAYS) {
    for (const currentWindowHours of CURRENT_HOURS) {
      const evaluationStepHours = currentWindowHours;
      const perVariant = new Map();
      for (const dataset of datasets) {
        const minOne = {
          baselineDays,
          currentWindowHours,
          evaluationStepHours,
          alpha: ALPHA,
          minimumBaselineObservations: 1,
          minimumCurrentObservations: 1,
        };
        const timelinePoints = [...replayModule.replayJeffreysEvents(dataset.events, [minOne])];
        const timesByUser = eventTimesByUser(dataset.events);
        const calibrationStart = new Date(Date.parse(dataset.startAt) + baselineDays * DAY_MS).toISOString();
        const calibrationSelection = Date.parse(calibrationStart) < Date.parse(dataset.splitAt)
          ? calibrationModule.selectNonOverlappingReplayPoints(timelinePoints, {
            startInclusive: calibrationStart,
            endExclusive: dataset.splitAt,
          }, dataset.startAt, timesByUser)
          : { points: [], excludedOverlappingWindow: 0, excludedSharedBoundaryEvent: 0 };
        const holdoutSelection = calibrationModule.selectNonOverlappingReplayPoints(timelinePoints, {
          startInclusive: dataset.splitAt,
          endExclusive: dataset.endAt,
        }, dataset.startAt, timesByUser);
        const profileByUser = new Map(dataset.profiles.map((entry) => [entry.user_id, entry.profile]));

        for (const definition of variantDefinitionsBySeed.get(dataset.seed)) {
          const scored = new Map();
          for (const point of timelinePoints) {
            const { baseline, current } = countsInRange(definition.prefixIndex, point);
            const result = groupingModule.calculateGroupedJeffreysDivergence(baseline, current, definition.grouping, ALPHA);
            scored.set(`${point.user_id}|${point.current_start}|${point.current_end}`, {
              divergence: result.divergence,
              baselineObservations: result.baselineObservations,
              currentObservations: result.currentObservations,
              baselineDistribution: result.baselineDistribution,
              currentDistribution: result.currentDistribution,
            });
          }
          const variantResult = perVariant.get(definition.key) ?? {
            key: definition.key,
            variant: definition.variant,
            frequencyThreshold: definition.frequencyThreshold,
            categoriesBySeed: [],
            configurations: new Map(),
          };
          variantResult.categoriesBySeed.push({ seed: dataset.seed, categoryCount: definition.categories.length, categories: definition.categories });
          for (const minimum of MINIMUMS) {
            const key = `${baselineDays}/${currentWindowHours}/${minimum.baseline}/${minimum.current}`;
            const row = variantResult.configurations.get(key) ?? {
              baselineDays,
              currentWindowHours,
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
            const pointScore = (point) => scored.get(`${point.user_id}|${point.current_start}|${point.current_end}`);
            const calibrationScored = calibrationSelection.points.map((point) => ({ point, score: pointScore(point) }));
            const calibrationSufficient = calibrationScored.filter(({ score }) => score.baselineObservations >= minimum.baseline && score.currentObservations >= minimum.current);
            row.insufficientCalibrationWindows += calibrationScored.length - calibrationSufficient.length;
            row.overlappingCalibrationWindowsExcluded += calibrationSelection.excludedOverlappingWindow + calibrationSelection.excludedSharedBoundaryEvent;
            for (const { point, score } of calibrationSufficient) row.calibrationRows.push({ seed: dataset.seed, divergence: score.divergence });

            const holdoutScored = holdoutSelection.points.map((point) => ({ point, score: pointScore(point) }));
            const holdoutSufficient = holdoutScored.filter(({ score }) => score.baselineObservations >= minimum.baseline && score.currentObservations >= minimum.current);
            row.insufficientHoldoutWindows += holdoutScored.length - holdoutSufficient.length;
            row.overlappingHoldoutWindowsExcluded += holdoutSelection.excludedOverlappingWindow + holdoutSelection.excludedSharedBoundaryEvent;
            for (const { point, score } of holdoutSufficient) {
              const truth = labelPoint(point, dataset.episodes, profileByUser);
              if (truth.label === 'transition') {
                row.transitionWindowsExcluded += 1;
                continue;
              }
              row.holdoutRows.push({ seed: dataset.seed, ...truth, divergence: score.divergence });
            }
            variantResult.configurations.set(key, row);
          }
          perVariant.set(definition.key, variantResult);
        }
      }

      for (const variant of perVariant.values()) {
        for (const row of variant.configurations.values()) {
          const p95 = quantile(row.calibrationRows.map((item) => item.divergence), 0.95);
          const p99 = quantile(row.calibrationRows.map((item) => item.divergence), 0.99);
          const thresholdsBySeed = SEEDS.map((seed) => {
            const values = row.calibrationRows.filter((item) => item.seed === seed).map((item) => item.divergence);
            return { seed, sufficientCalibrationWindows: values.length, p95: quantile(values, 0.95), p99: quantile(values, 0.99) };
          });
          const { calibrationRows, holdoutRows, ...rowSummary } = row;
          const scored = holdoutRows.length;
          const confusionMatrix = p95 === null ? null : confusion(holdoutRows, p95);
          const holdoutExceedances = p95 === null ? null : holdoutRows.filter((item) => item.divergence > p95).length;
          row.result = {
            ...rowSummary,
            calibrationThresholds: {
              selection: 'P95/P99 empirical quantiles of calibration-only sufficient synthetic windows.',
              p95,
              p99,
              bySeed: thresholdsBySeed,
              p95Spread: thresholdsBySeed.every((entry) => entry.p95 !== null)
                ? {
                  min: Math.min(...thresholdsBySeed.map((entry) => entry.p95)),
                  max: Math.max(...thresholdsBySeed.map((entry) => entry.p95)),
                  range: Math.max(...thresholdsBySeed.map((entry) => entry.p95)) - Math.min(...thresholdsBySeed.map((entry) => entry.p95)),
                } : null,
            },
            holdout: {
              evaluationStatus: p95 === null ? 'NOT_EVALUABLE_NO_CALIBRATION_THRESHOLD' : 'EVALUATED',
              sufficientWindowsUsed: scored,
              exceedancesAboveP95: holdoutExceedances,
              exceedanceRate: p95 === null || scored === 0 ? null : holdoutExceedances / scored,
              confusionMatrix,
              byScenario: p95 === null ? null : summarizeScenarios(holdoutRows, p95),
              normalProfileFalseSignals: p95 === null ? null : summarizeNormalProfiles(holdoutRows, p95),
              perSeed: p95 === null ? null : Object.fromEntries(SEEDS.map((seed) => [seed, confusion(holdoutRows.filter((entry) => entry.seed === seed), p95)])),
            },
          };
        }
        variant.configurations = [...variant.configurations.values()].map((row) => row.result);
      }
      results.push({
        baselineDays,
        currentWindowHours,
        evaluationStepHours,
        minimumsEvaluated: MINIMUMS.map(({ baseline, current }) => `${baseline}/${current}`),
        variants: [...perVariant.values()].map((variant) => ({
          key: variant.key,
          variant: variant.variant,
          frequencyThreshold: variant.frequencyThreshold,
          categoriesBySeed: variant.categoriesBySeed,
          configurations: variant.configurations,
        })),
      });
    }
  }

  const output = {
    source: 'SYNTHETIC',
    generatedAt: new Date().toISOString(),
    noDatabaseAccess: true,
    noProductionData: true,
    noIncidentCreation: true,
    generation: {
      seeds: SEEDS,
      userCountPerSeed: USER_COUNT,
      historyDaysPerSeed: HISTORY_DAYS,
      totalEventsAcrossSeeds: datasets.reduce((sum, dataset) => sum + dataset.events.length, 0),
      identicalEventsAcrossGroupingVariants: true,
      profileCountsPerSeed: Object.fromEntries(datasets[0].profiles.reduce((counts, entry) => counts.set(entry.profile, (counts.get(entry.profile) ?? 0) + 1), new Map())),
      scenarioLabels: 'Existing generator ground truth reused unchanged; all injected episodes start in holdout.',
    },
    groupings: {
      A_CURRENT: { description: 'AUTH, ORDER, ADMIN_DENIED, PRODUCT_ADMIN, OTHER.', frequencySource: 'fixed existing ACTION_CATEGORY_MAP' },
      B_DETAILED_AUTH: { description: 'USER_REGISTERED, LOGIN_SUCCESS, LOGIN_FAILED, LOGOUT plus ORDER, ADMIN_DENIED, PRODUCT_ADMIN, OTHER.' },
      C_DETAILED_ACTIONS: {
        description: 'One category per mapped action meeting the per-seed calibration frequency threshold; rare and unknown actions map to OTHER.',
        thresholds: ACTION_FREQUENCY_THRESHOLDS,
        thresholdUnit: 'Occurrences of the audit action across all users in that seed’s calibration period.',
        noHoldoutFrequencyUsedToChooseCategories: true,
      },
    },
    methodology: {
      formulaUnchanged: 'J(P,Q) = sum_i (p_i-q_i) * ln(p_i/q_i)',
      alpha: ALPHA,
      chronologicalSplit: '70% calibration / 30% holdout; 120 days => 84 / 36 days.',
      calibrationOnlyThresholdSelection: true,
      thresholds: [0.95, 0.99],
      thresholdsAreSyntheticOnly: true,
      currentWindowsNonOverlappingPerUser: true,
      noFutureLeakage: 'Baseline precedes each current window; group C action eligibility is computed from calibration actions only; injected episodes begin in holdout.',
      scoring: 'A window is scored only when raw baseline/current event counts satisfy the configured minimums; insufficient windows are counted but excluded from confusion metrics.',
      holdoutExceedanceRateCaveat: 'Exceedance rate includes known positive synthetic episodes; false positive rate is computed only against benign-labeled holdout windows.',
      correlationCaveat: 'Non-overlap removes window overlap, but windows from the same synthetic user remain correlated; descriptive metrics are not confidence intervals.',
    },
    configurations: results,
    limits: [
      'All results are SYNTHETIC and do not establish production detection performance.',
      'Current rules, worker, incidents, database, risk score and severity were not changed or used.',
      'The detailed-action model may increase divergence for sparse categories; alpha smoothing is unchanged, but operational threshold calibration needs real chronological data.',
      'Three seeds and one deterministic generator describe only this synthetic design.',
    ],
  };

  await writeFile(resolve(REPORT_PATH), `${JSON.stringify(output, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  console.log(JSON.stringify({ reportPath: resolve(REPORT_PATH), source: output.source, seeds: SEEDS.length, configurations: results.length, totalEvents: output.generation.totalEventsAcrossSeeds }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Jeffreys grouping comparison failed.');
  process.exitCode = 1;
});
