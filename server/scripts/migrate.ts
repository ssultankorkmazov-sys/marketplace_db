import dotenv from 'dotenv';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPool } from '../src/db.js';
import { loadConfig } from '../src/config.js';
import { applyMigrations, assertMigrationTargetDatabase } from '../src/migrations.js';

dotenv.config({ path: resolve(process.cwd(), '../.env') });
const pool = createPool(loadConfig());
try {
  const names = ['001_auth.sql', '002_order_delivery.sql', '003_audit_logs.sql', '004_anomaly_incidents.sql', '005_anomaly_queue_dead_letter.sql'];
  const migrations = await Promise.all(names.map(async (name) => ({
    name,
    sql: await readFile(resolve(process.cwd(), `../db/migrations/${name}`), 'utf8'),
  })));
  const client = await pool.connect();
  try {
    await assertMigrationTargetDatabase(client);
    const applied = await applyMigrations(client, migrations);
    if (applied.length) console.log(`Applied/recognized migrations: ${applied.join(', ')}`);
    else console.log('No pending migrations.');
  } finally { client.release(); }
} finally { await pool.end(); }
