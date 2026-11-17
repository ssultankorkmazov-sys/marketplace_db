import { afterEach, describe, expect, it, vi } from 'vitest';
import { createValidatedTestPool, validateTestDatabaseUrl } from '../src/testDatabaseConfig.js';

const validUrl = 'postgresql://test_user:test_password@localhost:5432/market_db_test';

afterEach(() => vi.unstubAllEnvs());

describe('pre-connection test database guard', () => {
  it('rejects a missing TEST_DATABASE_URL before invoking the pool factory', () => {
    const factory = vi.fn(() => ({}));
    expect(() => createValidatedTestPool(undefined, factory)).toThrow('TEST_DATABASE_URL is required');
    expect(factory).not.toHaveBeenCalled();
  });

  it('never treats DATABASE_URL alone as a test database URL', () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://not-used:not-used@db.example.invalid:5432/market_db');
    const factory = vi.fn(() => ({}));
    expect(() => createValidatedTestPool(undefined, factory)).toThrow('TEST_DATABASE_URL is required');
    expect(factory).not.toHaveBeenCalled();
  });

  it.each([
    ['remote hostname', 'postgresql://test_user:test_password@db.example.invalid:5432/market_db_test'],
    ['wrong database', 'postgresql://test_user:test_password@localhost:5432/market_db'],
    ['wrong port', 'postgresql://test_user:test_password@localhost:5433/market_db_test'],
    ['missing port', 'postgresql://test_user:test_password@localhost/market_db_test'],
    ['missing username', 'postgresql://:test_password@localhost:5432/market_db_test'],
    ['missing password', 'postgresql://test_user@localhost:5432/market_db_test'],
    ['host override', 'postgresql://test_user:test_password@localhost:5432/market_db_test?host=db.example.invalid'],
    ['malformed database path escape', 'postgresql://test_user:test_password@localhost:5432/%E0%A4%A'],
  ])('rejects %s before constructing a pool', (_case, value) => {
    const factory = vi.fn(() => ({}));
    expect(() => createValidatedTestPool(value, factory)).toThrow();
    expect(factory).not.toHaveBeenCalled();
  });

  it('rejects a malformed URL before constructing a pool', () => {
    const factory = vi.fn(() => ({}));
    expect(() => createValidatedTestPool('not-a-postgres-url', factory)).toThrow('TEST_DATABASE_URL is malformed');
    expect(factory).not.toHaveBeenCalled();
  });

  it('accepts only the exact local test target and then calls the pool factory', () => {
    const parsed = validateTestDatabaseUrl(validUrl);
    expect(parsed).toMatchObject({ host: 'localhost', port: 5432, database: 'market_db_test' });
    const factory = vi.fn((connectionString: string) => ({ configured: connectionString === validUrl }));
    expect(createValidatedTestPool(validUrl, factory)).toEqual({ configured: true });
    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledWith(validUrl);
  });

  it('supports the explicit IPv4 loopback hostname but not other local aliases', () => {
    expect(validateTestDatabaseUrl('postgres://test_user:test_password@127.0.0.1:5432/market_db_test').host).toBe('127.0.0.1');
    expect(() => validateTestDatabaseUrl('postgres://test_user:test_password@[::1]:5432/market_db_test')).toThrow();
  });
});
