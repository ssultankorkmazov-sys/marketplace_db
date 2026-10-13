import { Pool } from 'pg';
import type { ServerConfig } from './config.js';

export function createPool(config: Pick<ServerConfig, 'databaseUrl'>): Pool {
  return new Pool({ connectionString: config.databaseUrl });
}

export async function checkDatabase(pool: Pool): Promise<void> {
  await pool.query('SELECT 1');
}

export interface DatabaseReadiness {
  current_database: string;
  current_schema: string | null;
  current_user: string;
  products_relation: string | null;
  products_count: number | null;
}

export async function checkDatabaseReadiness(pool: Pool): Promise<DatabaseReadiness> {
  const { rows } = await pool.query<DatabaseReadiness>(
    `SELECT current_database() AS current_database,
            current_schema() AS current_schema,
            current_user AS current_user,
            to_regclass('public.products')::text AS products_relation`,
  );
  const readiness = rows[0];
  if (!readiness) throw new Error('Database readiness query returned no row.');

  if (readiness.products_relation !== null) {
    const { rows: counts } = await pool.query<{ products_count: number }>(
      'SELECT COUNT(*)::int AS products_count FROM public.products',
    );
    readiness.products_count = counts[0]?.products_count ?? 0;
  } else {
    readiness.products_count = null;
  }

  return readiness;
}
