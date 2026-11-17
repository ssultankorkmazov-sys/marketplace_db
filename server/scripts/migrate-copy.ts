import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPool } from '../src/db.js';
import { applyMigrations, assertMigrationCopyTargetDatabase } from '../src/migrations.js';
import { createValidatedMigrationCopyPool } from '../src/migrationCopyConfig.js';

// This separate runner is limited to the restored migration-test copy. It never
// loads dotenv and never falls back to DATABASE_URL or TEST_DATABASE_URL.
const pool = createValidatedMigrationCopyPool(process.env, (databaseUrl) => createPool({ databaseUrl }));
try {
  const names = [
    '001_auth.sql',
    '002_order_delivery.sql',
    '003_audit_logs.sql',
    '004_anomaly_incidents.sql',
    '005_anomaly_queue_dead_letter.sql',
    '006_jeffreys_shadow_mode.sql',
    '007_replenishment_history.sql',
  ];
  const migrations = await Promise.all(names.map(async (name) => ({
    name,
    sql: await readFile(resolve(process.cwd(), `../db/migrations/${name}`), 'utf8'),
  })));
  const client = await pool.connect();
  try {
    await assertMigrationCopyTargetDatabase(client);
    const applied = await applyMigrations(client, migrations);
    if (applied.length) console.log(`Applied/recognized migrations: ${applied.join(', ')}`);
    else console.log('No pending migrations.');
  } finally { client.release(); }
} finally { await pool.end(); }
