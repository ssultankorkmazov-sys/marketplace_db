export interface VerifiedMigrationMainConfig {
  connectionString: string;
  host: '127.0.0.1';
  port: 5432;
  database: 'market_db';
}

/** Validates the dedicated primary-local-database URL without opening a connection. */
export function validateMigrationMainDatabaseUrl(value: string | undefined): VerifiedMigrationMainConfig {
  if (value === undefined || value.trim() === '') {
    throw new Error('MAIN_MIGRATION_DATABASE_URL is required; refusing to connect.');
  }
  if (value !== value.trim()) throw new Error('MAIN_MIGRATION_DATABASE_URL has invalid surrounding whitespace; refusing to connect.');

  let parsed: URL;
  try { parsed = new URL(value); }
  catch { throw new Error('MAIN_MIGRATION_DATABASE_URL is malformed; refusing to connect.'); }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('MAIN_MIGRATION_DATABASE_URL must use the PostgreSQL protocol; refusing to connect.');
  }
  if (parsed.hostname !== '127.0.0.1') {
    throw new Error('MAIN_MIGRATION_DATABASE_URL must use IPv4 127.0.0.1; refusing to connect.');
  }
  if (parsed.port !== '5432') {
    throw new Error('MAIN_MIGRATION_DATABASE_URL must explicitly use port 5432; refusing to connect.');
  }

  let databaseName: string;
  try { databaseName = decodeURIComponent(parsed.pathname.slice(1)); }
  catch { throw new Error('MAIN_MIGRATION_DATABASE_URL database path is malformed; refusing to connect.'); }
  if (databaseName !== 'market_db') {
    throw new Error('MAIN_MIGRATION_DATABASE_URL must target market_db; refusing to connect.');
  }
  if (!parsed.username || !parsed.password) {
    throw new Error('MAIN_MIGRATION_DATABASE_URL must include credentials; refusing to connect.');
  }
  try {
    if (!decodeURIComponent(parsed.username).trim() || !decodeURIComponent(parsed.password).trim()) {
      throw new Error('empty credentials');
    }
  } catch {
    throw new Error('MAIN_MIGRATION_DATABASE_URL credentials are malformed; refusing to connect.');
  }
  if (parsed.hash || parsed.search) {
    throw new Error('MAIN_MIGRATION_DATABASE_URL query options and fragments are not allowed; refusing to connect.');
  }

  return { connectionString: value, host: '127.0.0.1', port: 5432, database: 'market_db' };
}

/** Reads only the dedicated variable; no generic or test URL is accepted as a fallback. */
export function createValidatedMigrationMainPool<T>(
  env: NodeJS.ProcessEnv,
  createPool: (connectionString: string) => T,
): T {
  const verified = validateMigrationMainDatabaseUrl(env.MAIN_MIGRATION_DATABASE_URL);
  return createPool(verified.connectionString);
}
