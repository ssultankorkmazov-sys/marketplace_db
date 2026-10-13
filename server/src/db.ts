import { Pool } from 'pg';
import type { ServerConfig } from './config.js';

export function createPool(config: Pick<ServerConfig, 'databaseUrl'>): Pool {
  return new Pool({ connectionString: config.databaseUrl });
}

export async function checkDatabase(pool: Pool): Promise<void> {
  await pool.query('SELECT 1');
}
