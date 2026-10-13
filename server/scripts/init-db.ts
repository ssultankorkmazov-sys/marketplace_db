import dotenv from 'dotenv';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';

dotenv.config({ path: resolve(process.cwd(), '../.env') });

const { Client, Pool } = pg;
const confirmation = 'marketkz-local-dev';
const tableNames = ['users', 'categories', 'products', 'orders', 'order_items', 'payments', 'reviews'];
const serialColumns = [
  ['users', 'user_id'], ['categories', 'category_id'], ['products', 'product_id'],
  ['orders', 'order_id'], ['order_items', 'order_item_id'], ['payments', 'payment_id'], ['reviews', 'review_id'],
] as const;

function databaseUrl(): URL {
  if (process.env.ALLOW_DB_INIT !== confirmation) {
    throw new Error(`Set ALLOW_DB_INIT=${confirmation} to explicitly authorize local development database initialization.`);
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const url = new URL(process.env.DATABASE_URL);
  if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
    throw new Error('Database initialization is restricted to a PostgreSQL server on this computer.');
  }
  const name = decodeURIComponent(url.pathname.slice(1));
  if (!/^[a-z][a-z0-9_]{0,62}$/i.test(name)) throw new Error('DATABASE_URL must name a standard PostgreSQL database.');
  if (name !== 'marketplace_db' && !name.endsWith('_test')) {
    throw new Error('Initialization is restricted to marketplace_db or a database name ending in _test.');
  }
  return url;
}

async function main() {
  const targetUrl = databaseUrl();
  const targetName = decodeURIComponent(targetUrl.pathname.slice(1));
  const adminUrl = new URL(targetUrl);
  adminUrl.pathname = '/postgres';

  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [targetName]);
    if (exists.rowCount === 0) {
      await admin.query(`CREATE DATABASE "${targetName}"`);
      console.log(`Created empty development database ${targetName}.`);
    } else {
      const checkPool = new Pool({ connectionString: targetUrl.toString() });
      try {
        const tables = await checkPool.query(
          `SELECT table_name FROM information_schema.tables
           WHERE table_schema NOT IN ('pg_catalog', 'information_schema') LIMIT 1`,
        );
        if (tables.rowCount) {
          throw new Error(`Database ${targetName} already contains tables; refusing to import into a non-empty database.`);
        }
      } finally { await checkPool.end(); }
    }
  } finally { await admin.end(); }

  const sqlPath = resolve(process.cwd(), '../db/marketplace_db.sql');
  const sourceSql = await readFile(sqlPath, 'utf8');
  const importSql = sourceSql.replace(/^\s*CREATE\s+DATABASE\s+marketplace_db\s*;\s*/i, '');
  if (importSql === sourceSql) throw new Error('Expected leading CREATE DATABASE marketplace_db statement was not found.');
  if (/\b(DROP|TRUNCATE|DELETE)\b/i.test(importSql)) throw new Error('Refusing to run destructive SQL from the source file.');

  const pool = new Pool({ connectionString: targetUrl.toString() });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(importSql);
    for (const [table, column] of serialColumns) {
      const seq = await client.query<{ sequence_name: string | null }>(
        'SELECT pg_get_serial_sequence($1, $2) AS sequence_name', [`public.${table}`, column],
      );
      const sequence = seq.rows[0]?.sequence_name;
      if (!sequence) throw new Error(`SERIAL sequence missing for ${table}.${column}`);
      await client.query('SELECT setval($1::regclass, (SELECT COALESCE(MAX(' + column + '), 1) FROM ' + table + '), true)', [sequence]);
    }

    const actualTables = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
    );
    if (actualTables.rows.length !== tableNames.length || tableNames.some(name => !actualTables.rows.some(row => row.table_name === name))) {
      throw new Error('Imported table set did not match the expected seven tables.');
    }
    let total = 0;
    for (const table of tableNames) {
      const count = await client.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM ${table}`);
      if (count.rows[0].count !== 50) throw new Error(`Expected 50 rows in ${table}; got ${count.rows[0].count}.`);
      total += count.rows[0].count;
    }
    if (total !== 350) throw new Error(`Expected 350 records total; got ${total}.`);

    const fkCount = await client.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace`,
    );
    if (fkCount.rows[0].count !== 7) throw new Error(`Expected 7 foreign keys; got ${fkCount.rows[0].count}.`);
    for (const [table, column] of serialColumns) {
      const seq = await client.query<{ sequence_name: string | null }>(
        'SELECT pg_get_serial_sequence($1, $2) AS sequence_name', [`public.${table}`, column],
      );
      const sequence = seq.rows[0].sequence_name;
      const value = await client.query<{ last_value: string | null }>(
        `SELECT last_value::text AS last_value FROM pg_sequences
         WHERE schemaname = 'public' AND sequencename = split_part($1, '.', 2)`, [sequence],
      );
      const max = await client.query<{ max_id: number }>(`SELECT MAX(${column})::int AS max_id FROM ${table}`);
      if (Number(value.rows[0]?.last_value) !== max.rows[0].max_id) throw new Error(`Sequence for ${table}.${column} is out of sync.`);
    }
    await client.query('COMMIT');
    console.log('Import verified: 7 tables, 50 rows each (350 total), 7 foreign keys, SERIAL sequences synchronized.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(error => {
  console.error('Database initialization failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
