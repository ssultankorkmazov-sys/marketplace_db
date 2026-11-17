export interface VerifiedMigrationCopyConfig {
  connectionString: string;
  host: 'localhost' | '127.0.0.1';
  port: 5432;
  database: 'market_db_migration_test';
}

/** Validates the dedicated restored-copy URL without opening a database connection. */
export function validateMigrationCopyDatabaseUrl(value: string | undefined): VerifiedMigrationCopyConfig {
  if (value === undefined || value.trim() === '') {
    throw new Error('MIGRATION_COPY_DATABASE_URL is required; refusing to connect.');
  }
  if (value !== value.trim()) throw new Error('MIGRATION_COPY_DATABASE_URL has invalid surrounding whitespace; refusing to connect.');

  let parsed: URL;
  try { parsed = new URL(value); }
  catch { throw new Error('MIGRATION_COPY_DATABASE_URL is malformed; refusing to connect.'); }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('MIGRATION_COPY_DATABASE_URL must use the PostgreSQL protocol; refusing to connect.');
  }
  if (parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
    throw new Error('MIGRATION_COPY_DATABASE_URL must use localhost or 127.0.0.1; refusing to connect.');
  }
  if (parsed.port !== '5432') {
    throw new Error('MIGRATION_COPY_DATABASE_URL must explicitly use local port 5432; refusing to connect.');
  }

  let databaseName: string;
  try { databaseName = decodeURIComponent(parsed.pathname.slice(1)); }
  catch { throw new Error('MIGRATION_COPY_DATABASE_URL database path is malformed; refusing to connect.'); }
  if (databaseName !== 'market_db_migration_test') {
    throw new Error('MIGRATION_COPY_DATABASE_URL must target market_db_migration_test; refusing to connect.');
  }
  if (!parsed.username || !parsed.password) {
    throw new Error('MIGRATION_COPY_DATABASE_URL must include credentials; refusing to connect.');
  }
  try {
    if (!decodeURIComponent(parsed.username).trim() || !decodeURIComponent(parsed.password).trim()) {
      throw new Error('empty credentials');
    }
  } catch {
    throw new Error('MIGRATION_COPY_DATABASE_URL credentials are malformed; refusing to connect.');
  }
  if (parsed.hash || parsed.search) {
    throw new Error('MIGRATION_COPY_DATABASE_URL query options and fragments are not allowed; refusing to connect.');
  }

  return {
    connectionString: value,
    host: parsed.hostname,
    port: 5432,
    database: 'market_db_migration_test',
  };
}

/** Reads only the dedicated variable; generic and integration-test URLs are never fallbacks. */
export function createValidatedMigrationCopyPool<T>(
  env: NodeJS.ProcessEnv,
  createPool: (connectionString: string) => T,
): T {
  const verified = validateMigrationCopyDatabaseUrl(env.MIGRATION_COPY_DATABASE_URL);
  return createPool(verified.connectionString);
}
