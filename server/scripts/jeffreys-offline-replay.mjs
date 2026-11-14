import { readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function parseArgs(args) {
  if (args.length === 1 && args[0] === '--help') return { help: true };
  const allowed = new Set([
    '--input', '--manifest', '--output', '--baseline-days', '--current-window-hours',
    '--evaluation-step-hours', '--alpha', '--minimum-baseline', '--minimum-current', '--quantiles',
  ]);
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!allowed.has(key) || !value || value.startsWith('--') || values.has(key)) {
      throw new Error('Invalid or duplicate command-line option. Run with --help for usage.');
    }
    values.set(key, value);
  }
  for (const key of ['--input', '--manifest', '--output']) {
    if (!values.has(key)) throw new Error(`Missing required option ${key}.`);
  }
  const positiveInt = (key, fallback) => {
    const raw = values.get(key);
    if (raw === undefined) return fallback;
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < 1) {
      throw new Error(`${key} must be a positive integer.`);
    }
    return Number(raw);
  };
  const alphaRaw = values.get('--alpha');
  const alpha = alphaRaw === undefined ? 0.5 : Number(alphaRaw);
  if (!Number.isFinite(alpha) || alpha <= 0) throw new Error('--alpha must be a finite positive number.');
  const quantileRaw = values.get('--quantiles') ?? '0.95,0.99';
  const quantiles = quantileRaw.split(',').map((value) => Number(value));
  if (!quantiles.length || quantiles.some((value) => !Number.isFinite(value) || value <= 0 || value > 1)) {
    throw new Error('--quantiles must be comma-separated values greater than 0 and at most 1.');
  }
  return {
    input: resolve(values.get('--input')),
    manifest: resolve(values.get('--manifest')),
    output: resolve(values.get('--output')),
    config: {
      baselineDays: positiveInt('--baseline-days', 30),
      currentWindowHours: positiveInt('--current-window-hours', 24),
      evaluationStepHours: positiveInt('--evaluation-step-hours', 24),
      alpha,
      minimumBaselineObservations: positiveInt('--minimum-baseline', 50),
      minimumCurrentObservations: positiveInt('--minimum-current', 20),
      thresholdQuantiles: quantiles,
    },
  };
}

function isInsideRepository(path) {
  const rel = relative(repositoryRoot, path);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

function usage() {
  return [
    'Usage: node server/scripts/jeffreys-offline-replay.mjs --input <pseudonymized.json> --manifest <manifest.json> --output <report.json> [options]',
    'Options: --baseline-days 30 --current-window-hours 24 --evaluation-step-hours 24 --alpha 0.5',
    '         --minimum-baseline 50 --minimum-current 20 --quantiles 0.95,0.99',
    'Input and report paths must be outside the repository; existing output files are never overwritten.',
  ].join('\n');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { console.log(usage()); return; }
  if (isInsideRepository(options.input) || isInsideRepository(options.output)) {
    throw new Error('Pseudonymized input and report output must be outside the repository.');
  }
  if (options.input === options.output || options.manifest === options.output) {
    throw new Error('The output report must be a separate file.');
  }

  const [{ buildOfflineReplayReport }] = await Promise.all([import('../dist/jeffreysOffline.js')]);
  const [events, manifest] = await Promise.all([
    readFile(options.input, 'utf8').then((text) => JSON.parse(text)),
    readFile(options.manifest, 'utf8').then((text) => JSON.parse(text)),
  ]);
  const report = buildOfflineReplayReport(events, manifest, options.config);
  await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  console.log(JSON.stringify({
    reportWritten: true,
    eventCount: report.input_quality.event_count,
    pseudonymousUsers: report.input_quality.pseudonymous_user_count,
    calibrationSufficientWindows: report.calibration.windows.sufficient,
    calibrationInsufficientWindows: report.calibration.windows.insufficient,
    holdoutSufficientWindows: report.holdout.windows.sufficient,
    holdoutInsufficientWindows: report.holdout.windows.insufficient,
    reportPath: options.output,
    databaseAccessed: false,
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Offline replay failed.');
    process.exitCode = 1;
  });
}
