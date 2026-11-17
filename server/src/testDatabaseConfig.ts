export interface VerifiedTestDatabaseConfig {
  connectionString: string;
  host: 'localhost' | '127.0.0.1';
  port: 5432;
  database: 'market_db_test';
}

/** Validates a local test database URL without opening a network connection. */
export function validateTestDatabaseUrl(value: string | undefined): VerifiedTestDatabaseConfig {
  if (value === undefined || value.trim() === '') {
    throw new Error('TEST_DATABASE_URL is required; refusing to connect.');
  }
  if (value !== value.trim()) throw new Error('TEST_DATABASE_URL has invalid surrounding whitespace; refusing to connect.');

  let parsed: URL;
  try { parsed = new URL(value); }
  catch { throw new Error('TEST_DATABASE_URL is malformed; refusing to connect.'); }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('TEST_DATABASE_URL must use the PostgreSQL protocol; refusing to connect.');
  }
  if (parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
    throw new Error('TEST_DATABASE_URL must use localhost or 127.0.0.1; refusing to connect.');
  }
  if (parsed.port !== '5432') {
    throw new Error('TEST_DATABASE_URL must explicitly use local port 5432; refusing to connect.');
  }
  let databaseName: string;
  try { databaseName = decodeURIComponent(parsed.pathname.slice(1)); }
  catch { throw new Error('TEST_DATABASE_URL database path is malformed; refusing to connect.'); }
  if (databaseName !== 'market_db_test') {
    throw new Error('TEST_DATABASE_URL must target market_db_test; refusing to connect.');
  }
  if (!parsed.username || !parsed.password) {
    throw new Error('TEST_DATABASE_URL must include test database credentials; refusing to connect.');
  }
  try {
    if (!decodeURIComponent(parsed.username).trim() || !decodeURIComponent(parsed.password).trim()) {
      throw new Error('empty credentials');
    }
  } catch {
    throw new Error('TEST_DATABASE_URL credentials are malformed; refusing to connect.');
  }
  if (parsed.hash || ['host', 'hostaddr', 'port', 'service', 'servicefile', 'user', 'password'].some((key) => parsed.searchParams.has(key))) {
    throw new Error('TEST_DATABASE_URL contains unsupported connection overrides; refusing to connect.');
  }

  return { connectionString: value, host: parsed.hostname, port: 5432, database: 'market_db_test' };
}

/** Calls the pool factory only after the URL has passed every local-target check. */
export function createValidatedTestPool<T>(
  value: string | undefined,
  createPool: (connectionString: string) => T,
): T {
  const verified = validateTestDatabaseUrl(value);
  return createPool(verified.connectionString);
}
