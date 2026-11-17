import { describe, expect, it, vi } from 'vitest';
import { createValidatedMigrationMainPool, validateMigrationMainDatabaseUrl } from '../src/migrationMainConfig.js';

const validUrl = 'postgresql://main_user:main_password@127.0.0.1:5432/market_db';

describe('primary-local migration runner target guard', () => {
  it('accepts only the dedicated market_db URL before calling the pool factory', () => {
    const factory = vi.fn((connectionString: string) => ({ connectionString }));
    expect(validateMigrationMainDatabaseUrl(validUrl)).toMatchObject({
      host: '127.0.0.1', port: 5432, database: 'market_db',
    });
    expect(createValidatedMigrationMainPool({ MAIN_MIGRATION_DATABASE_URL: validUrl }, factory))
      .toEqual({ connectionString: validUrl });
    expect(factory).toHaveBeenCalledOnce();
  });

  it.each([
    ['the restored migration copy', 'postgresql://u:p@127.0.0.1:5432/market_db_migration_test'],
    ['the integration-test database', 'postgresql://u:p@127.0.0.1:5432/market_db_test'],
    ['localhost hostname', 'postgresql://u:p@localhost:5432/market_db'],
    ['IPv6 loopback', 'postgresql://u:p@[::1]:5432/market_db'],
    ['remote hostname', 'postgresql://u:p@db.example.invalid:5432/market_db'],
    ['wrong IPv4 address', 'postgresql://u:p@127.0.0.2:5432/market_db'],
    ['wrong port', 'postgresql://u:p@127.0.0.1:5433/market_db'],
    ['missing explicit port', 'postgresql://u:p@127.0.0.1/market_db'],
    ['malformed URL', 'not-a-postgres-url'],
  ])('rejects %s before constructing a pool', (_label, value) => {
    const factory = vi.fn(() => ({}));
    expect(() => createValidatedMigrationMainPool({ MAIN_MIGRATION_DATABASE_URL: value }, factory)).toThrow();
    expect(factory).not.toHaveBeenCalled();
  });

  it('requires MAIN_MIGRATION_DATABASE_URL and never falls back to other URLs', () => {
    const factory = vi.fn(() => ({}));
    expect(() => createValidatedMigrationMainPool({
      DATABASE_URL: validUrl,
      TEST_DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/market_db_test',
      MIGRATION_COPY_DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/market_db_migration_test',
    }, factory)).toThrow('MAIN_MIGRATION_DATABASE_URL is required');
    expect(factory).not.toHaveBeenCalled();
  });

  it('rejects missing credentials without exposing the URL', () => {
    const factory = vi.fn(() => ({}));
    expect(() => createValidatedMigrationMainPool({
      MAIN_MIGRATION_DATABASE_URL: 'postgresql://@127.0.0.1:5432/market_db',
    }, factory)).toThrow('MAIN_MIGRATION_DATABASE_URL must include credentials');
    expect(factory).not.toHaveBeenCalled();
  });
});
