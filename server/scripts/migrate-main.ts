import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPool } from '../src/db.js';
import { applyMigrations, assertMigrationMainTargetDatabase } from '../src/migrations.js';
import { createValidatedMigrationMainPool } from '../src/migrationMainConfig.js';

// This runner accepts only MAIN_MIGRATION_DATABASE_URL and never loads dotenv.
const pool = createValidatedMigrationMainPool(process.env, (databaseUrl) => createPool({ databaseUrl }));
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
    await assertMigrationMainTargetDatabase(client);
    const applied = await applyMigrations(client, migrations);
    if (applied.length) console.log(`Applied/recognized migrations: ${applied.join(', ')}`);
    else console.log('No pending migrations.');
  } finally { client.release(); }
} finally { await pool.end(); }
