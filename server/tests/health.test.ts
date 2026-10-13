import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

describe('GET /api/health', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns healthy when PostgreSQL responds', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }) } as never;
    const response = await request(createApp(pool)).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', database: 'connected' });
    expect(pool.query).toHaveBeenCalledWith('SELECT 1');
  });

  it('returns a safe error when PostgreSQL is unavailable', async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error('private connection detail')) } as never;
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await request(createApp(pool)).get('/api/health');
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: 'Service temporarily unavailable' });
    expect(response.text).not.toContain('private connection detail');
    expect(log).toHaveBeenCalled();
  });
});
