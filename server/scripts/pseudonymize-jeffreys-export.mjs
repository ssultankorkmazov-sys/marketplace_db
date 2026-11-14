import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const MIN_PSEUDONYM = 2_147_483_648n;
const MAX_PSEUDONYM = BigInt(Number.MAX_SAFE_INTEGER);
const RANGE = MAX_PSEUDONYM - MIN_PSEUDONYM + 1n;
const UINT64_SPACE = 1n << 64n;
const ACCEPT_LIMIT = UINT64_SPACE - (UINT64_SPACE % RANGE);
const REQUIRED_HEADERS = ['user_id', 'action', 'created_at', 'status'];
const KNOWN_ACTIONS = new Set([
  'USER_REGISTERED', 'LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGOUT', 'ORDER_CREATED',
  'ORDER_CREATE_FAILED', 'ORDER_STATUS_CHANGED', 'ADMIN_LOGS_ACCESS_DENIED',
  'ADMIN_ORDERS_ACCESS_DENIED', 'ADMIN_ANOMALIES_ACCESS_DENIED', 'PRODUCTS_ACCESS_DENIED',
  'PRODUCT_CREATED', 'PRODUCT_UPDATED', 'PRODUCT_DELETED', 'ANOMALY_STATUS_CHANGED',
]);

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field.length === 0) quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field);
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  if (quoted) throw new Error('CSV has an unterminated quoted field.');
  if (row.length || field.length) {
    row.push(field);
    if (row.some((value) => value.length > 0)) rows.push(row);
  }
  return rows;
}

function randomPseudonym(used) {
  for (;;) {
    const bytes = randomBytes(8);
    const randomValue = bytes.readBigUInt64BE();
    if (randomValue >= ACCEPT_LIMIT) continue;
    const candidate = MIN_PSEUDONYM + (randomValue % RANGE);
    if (!used.has(candidate)) {
      used.add(candidate);
      return Number(candidate);
    }
  }
}

function parseRows(rows) {
  if (rows.length === 0) throw new Error('CSV is empty.');
  const headers = rows[0].map((value, index) => index === 0 ? value.replace(/^\uFEFF/, '').trim() : value.trim());
  if (headers.length !== REQUIRED_HEADERS.length || REQUIRED_HEADERS.some((name, index) => headers[index] !== name)) {
    throw new Error('CSV must contain exactly these columns in order: user_id, action, created_at, status.');
  }

  const events = [];
  const sourceIds = new Set();
  for (let index = 1; index < rows.length; index += 1) {
    const values = rows[index];
    if (values.length !== headers.length) throw new Error(`CSV row ${index + 1} has an unexpected number of columns.`);
    const [rawUserId, rawAction, rawTimestamp, rawStatus] = values.map((value) => value.trim());
    const userId = rawUserId === '' || rawUserId === '\\N' ? null : rawUserId;
    if (userId !== null && !/^\d+$/.test(userId)) throw new Error(`CSV row ${index + 1} has an invalid user identifier.`);
    if (userId !== null) sourceIds.add(BigInt(userId));
    if (!rawAction || rawAction.length > 64) throw new Error(`CSV row ${index + 1} has an invalid action.`);
    if (!rawTimestamp || !/(?:Z|\+00:00)$/i.test(rawTimestamp) || !Number.isFinite(Date.parse(rawTimestamp))) {
      throw new Error(`CSV row ${index + 1} must have a valid UTC timestamp.`);
    }
    if (!['SUCCESS', 'FAILURE'].includes(rawStatus)) throw new Error(`CSV row ${index + 1} has an invalid audit status.`);
    events.push({
      sourceUserId: userId,
      action: KNOWN_ACTIONS.has(rawAction) ? rawAction : '__UNKNOWN_ACTION__',
      created_at: rawTimestamp,
      status: rawStatus,
    });
  }
  return { events, sourceIds };
}

async function main() {
  const args = process.argv.slice(2);
  const inputIndex = args.indexOf('--input-csv');
  const outputIndex = args.indexOf('--output-json');
  const inputArg = inputIndex >= 0 ? args[inputIndex + 1] : null;
  const outputArg = outputIndex >= 0 ? args[outputIndex + 1] : null;
  if (!inputArg || !outputArg || args.length !== 4) {
    throw new Error('Usage: node server/scripts/pseudonymize-jeffreys-export.mjs --input-csv <local.csv> --output-json <outside-repository.json>');
  }
  const inputPath = resolve(inputArg);
  const outputPath = resolve(outputArg);
  if (inputPath === outputPath) throw new Error('Input and output paths must be different.');

  const rows = parseCsv(await readFile(inputPath, 'utf8'));
  const { events, sourceIds } = parseRows(rows);
  // PostgreSQL audit_logs.user_id is INT, so aliases above INT's full positive
  // range cannot equal a source ID. The source-to-alias map exists only in RAM.
  const usedPseudonyms = new Set(sourceIds);
  const pseudonyms = new Map();
  const output = events.map(({ sourceUserId, action, created_at, status }) => {
    let user_id = null;
    if (sourceUserId !== null) {
      if (!pseudonyms.has(sourceUserId)) pseudonyms.set(sourceUserId, randomPseudonym(usedPseudonyms));
      user_id = pseudonyms.get(sourceUserId);
    }
    return { user_id, action, created_at, status };
  });

  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  const timestamps = output.map((event) => Date.parse(event.created_at)).sort((a, b) => a - b);
  const uniquePseudonyms = pseudonyms.size;
  pseudonyms.clear();
  usedPseudonyms.clear();
  sourceIds.clear();
  console.log(JSON.stringify({
    outputWritten: true,
    eventCount: output.length,
    pseudonymousUsers: uniquePseudonyms,
    eventsWithoutUser: output.filter((event) => event.user_id === null).length,
    firstEventUtc: timestamps.length ? new Date(timestamps[0]).toISOString() : null,
    lastEventUtc: timestamps.length ? new Date(timestamps[timestamps.length - 1]).toISOString() : null,
    outputContainsSourceIdentifiers: false,
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Pseudonymization failed.');
  process.exitCode = 1;
});
