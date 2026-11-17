import { describe, expect, it, vi } from 'vitest';
import { createValidatedMigrationCopyPool, validateMigrationCopyDatabaseUrl } from '../src/migrationCopyConfig.js';

const validUrl = 'postgresql://copy_user:copy_password@localhost:5432/market_db_migration_test';

describe('restored migration-copy target guard', () => {
  it('accepts only the dedicated restored copy before calling the pool factory', () => {
    const factory = vi.fn((connectionString: string) => ({ connectionString }));
    expect(validateMigrationCopyDatabaseUrl(validUrl)).toMatchObject({
      host: 'localhost', port: 5432, database: 'market_db_migration_test',
    });
    expect(createValidatedMigrationCopyPool({ MIGRATION_COPY_DATABASE_URL: validUrl }, factory))
      .toEqual({ connectionString: validUrl });
    expect(factory).toHaveBeenCalledOnce();
  });

  it.each([
    ['the primary database', 'postgresql://copy_user:copy_password@localhost:5432/market_db'],
    ['the integration-test database', 'postgresql://copy_user:copy_password@localhost:5432/market_db_test'],
    ['a remote hostname', 'postgresql://copy_user:copy_password@db.example.invalid:5432/market_db_migration_test'],
    ['a nonstandard port', 'postgresql://copy_user:copy_password@localhost:5433/market_db_migration_test'],
    ['a missing port', 'postgresql://copy_user:copy_password@localhost/market_db_migration_test'],
    ['a malformed URL', 'not-a-postgres-url'],
    ['a host override', 'postgresql://copy_user:copy_password@localhost:5432/market_db_migration_test?host=remote.invalid'],
  ])('rejects %s before constructing a pool', (_label, value) => {
    const factory = vi.fn(() => ({}));
    expect(() => createValidatedMigrationCopyPool({ MIGRATION_COPY_DATABASE_URL: value }, factory)).toThrow();
    expect(factory).not.toHaveBeenCalled();
  });

  it('never falls back to DATABASE_URL or TEST_DATABASE_URL', () => {
    const factory = vi.fn(() => ({}));
    expect(() => createValidatedMigrationCopyPool({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/market_db',
      TEST_DATABASE_URL: 'postgresql://user:pass@localhost:5432/market_db_test',
    }, factory)).toThrow('MIGRATION_COPY_DATABASE_URL is required');
    expect(factory).not.toHaveBeenCalled();
  });

  it('rejects missing credentials without exposing the connection URL', () => {
    const factory = vi.fn(() => ({}));
    const unsafe = 'postgresql://@localhost:5432/market_db_migration_test';
    expect(() => createValidatedMigrationCopyPool({ MIGRATION_COPY_DATABASE_URL: unsafe }, factory))
      .toThrow('MIGRATION_COPY_DATABASE_URL must include credentials');
    expect(factory).not.toHaveBeenCalled();
  });
});
