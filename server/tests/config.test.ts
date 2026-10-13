import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('backend configuration', () => {
  it('loads PostgreSQL URL and defaults', () => {
    expect(loadConfig({ DATABASE_URL: 'postgres://local/db' })).toEqual({
      databaseUrl: 'postgres://local/db', port: 3001, nodeEnv: 'development',
    });
  });

  it('accepts explicit valid port and environment', () => {
    expect(loadConfig({ DATABASE_URL: 'postgresql://local/db', PORT: '8080', NODE_ENV: 'test' }))
      .toMatchObject({ port: 8080, nodeEnv: 'test' });
  });

  it.each([
    [{}, 'DATABASE_URL is required'],
    [{ DATABASE_URL: 'http://localhost/db' }, 'DATABASE_URL must use postgres:// or postgresql://'],
    [{ DATABASE_URL: 'postgres://localhost/db', PORT: '0' }, 'PORT must be an integer between 1 and 65535'],
  ])('rejects invalid environment', (env, message) => {
    expect(() => loadConfig(env)).toThrow(message);
  });
});
