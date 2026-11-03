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

  it('reports ready only when catalog and anomaly schema are present', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ current_database: 'market_db_test', current_schema: 'public', current_user: 'marketkz_app', products_relation: 'public.products', anomaly_schema_ready: true, missing_anomaly_objects: [] }] })
      .mockResolvedValueOnce({ rows: [{ products_count: 50 }] });
    const response = await request(createApp({ query } as never)).get('/api/health/ready');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'ready', current_database: 'market_db_test', current_schema: 'public', current_user: 'marketkz_app',
      products_relation: 'public.products', products_count: 50, anomaly_schema_ready: true, missing_anomaly_objects: [],
    });
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][0]).toContain("to_regclass('public.anomaly_event_queue')");
    expect(query.mock.calls[0][0]).toContain('pg_trigger');
    expect(query.mock.calls[0][0]).toContain('pg_proc');
    expect(query.mock.calls[1][0]).toBe('SELECT COUNT(*)::int AS products_count FROM public.products');
    expect(response.text).not.toMatch(/DATABASE_URL|password|hostname/i);
  });

  it('returns unhealthy when migration 004 objects are missing', async () => {
    const missing = ['anomaly_event_queue', 'anomaly_event_queue_pending_idx', 'audit_logs_enqueue_anomaly_event/enqueue_anomaly_audit_event'];
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ current_database: 'market_db_test', current_schema: 'public', current_user: 'postgres', products_relation: 'products', anomaly_schema_ready: false, missing_anomaly_objects: missing }] })
      .mockResolvedValueOnce({ rows: [{ products_count: 50 }] });
    const response = await request(createApp({ query } as never)).get('/api/health/ready');
    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({ status: 'unavailable', anomaly_schema_ready: false, missing_anomaly_objects: missing, products_count: 50 });
  });

  it('reports a missing public.products relation as not ready without running a count query', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ current_database: 'market_db_test', current_schema: 'public', current_user: 'marketkz_app', products_relation: null, anomaly_schema_ready: true, missing_anomaly_objects: [] }] });
    const response = await request(createApp({ query } as never)).get('/api/health/ready');
    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      status: 'unavailable', current_database: 'market_db_test', current_schema: 'public', current_user: 'marketkz_app',
      products_relation: null, products_count: null, anomaly_schema_ready: true, missing_anomaly_objects: [],
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
