import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isSyntheticReplenishmentReport } from '../dist/replenishmentDemo.js';

const sourcePath = fileURLToPath(new URL('../../ml/sales_prediction/reports/phase3ab-synthetic-replenishment.json', import.meta.url));
const outputPath = fileURLToPath(new URL('../dist/demo/phase3ab-synthetic-replenishment.json', import.meta.url));
const contents = await readFile(sourcePath, 'utf8');
let parsed;
try {
  parsed = JSON.parse(contents);
} catch {
  throw new Error('The synthetic replenishment source report is not valid JSON.');
}
if (!isSyntheticReplenishmentReport(parsed)) {
  throw new Error('The synthetic replenishment source report failed its schema or SYNTHETIC validation.');
}
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, contents, 'utf8');
console.log('Validated and packaged the authoritative synthetic replenishment report.');
