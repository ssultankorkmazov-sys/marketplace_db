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

describe('GET /api/health/ready', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reports only the database context and product relation/count from the application pool', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ current_database: 'neondb', current_schema: 'public', current_user: 'marketkz_app', products_relation: 'public.products' }] })
      .mockResolvedValueOnce({ rows: [{ products_count: 50 }] });
    const response = await request(createApp({ query } as never)).get('/api/health/ready');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      current_database: 'neondb', current_schema: 'public', current_user: 'marketkz_app',
      products_relation: 'public.products', products_count: 50,
    });
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][0]).toContain("to_regclass('public.products')");
    expect(query.mock.calls[1][0]).toBe('SELECT COUNT(*)::int AS products_count FROM public.products');
    expect(response.text).not.toMatch(/DATABASE_URL|password|hostname/i);
  });

  it('reports a missing public.products relation as not ready without running a count query', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ current_database: 'neondb', current_schema: 'public', current_user: 'marketkz_app', products_relation: null }] });
    const response = await request(createApp({ query } as never)).get('/api/health/ready');
    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      current_database: 'neondb', current_schema: 'public', current_user: 'marketkz_app',
      products_relation: null, products_count: null,
    });
    expect(query).toHaveBeenCalledOnce();
  });

  it('returns a generic error and does not expose database error details', async () => {
    const query = vi.fn().mockRejectedValue(new Error('private SQL and connection details'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await request(createApp({ query } as never)).get('/api/health/ready');
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: 'Database readiness check failed' });
    expect(response.text).not.toContain('private SQL');
    expect(log).toHaveBeenCalled();
  });
});
