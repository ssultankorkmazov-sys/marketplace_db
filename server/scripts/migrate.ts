import dotenv from 'dotenv';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPool } from '../src/db.js';
import { loadConfig } from '../src/config.js';

dotenv.config({ path: resolve(process.cwd(), '../.env') });
const pool = createPool(loadConfig());
try {
  const migrations = ['001_auth.sql', '002_order_delivery.sql'];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const migration of migrations) await client.query(await readFile(resolve(process.cwd(), `../db/migrations/${migration}`), 'utf8'));
    await client.query('COMMIT');
    console.log('Pending additive migrations applied. Existing data was preserved.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
} finally { await pool.end(); }
