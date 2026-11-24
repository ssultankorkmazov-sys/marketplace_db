import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Pool } from 'pg';
import { createApp } from '../src/app.js';

const token = Buffer.from('p'.repeat(32)).toString('base64url');
const cookie = `marketkz_session=${token}`;
const admin = { user_id: 8, name: 'Admin', email: 'admin@example.kz', phone: '+77000000008', address: null, role: 'admin' as const };
const user = { ...admin, user_id: 9, role: 'user' as const };

afterEach(() => vi.restoreAllMocks());

function databaseRow(overrides: Record<string, unknown> = {}) {
  return {
    product_id: '42', name: 'Тестовый товар', stock_quantity: '10', available_stock: '10',
    delivered_90d: '12', open_orders: '3', sales_180d: '24',
    processing_orders: '3', forecast_30d: '4', safety_stock: '2', recommended_purchase: '0',
    procurement_status: 'STOCK SUFFICIENT', sales_history_observations: '4',
    sales_observation_days_180d: '3', history_days_available: '180', ...overrides,
  };
}

function fakePool(sessionUser: typeof admin | typeof user | null, rows: Record<string, unknown>[] = [], failure?: Error) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('FROM user_sessions')) return { rows: sessionUser ? [sessionUser] : [] };
    if (sql.includes('FROM public.procurement_forecast AS forecast')) {
      if (failure) throw failure;
      return { rows };
    }
    throw new Error('Unexpected database query.');
  });
  return { pool: { query } as unknown as Pool, query };
}

describe('admin procurement forecast API', () => {
  it('requires an authenticated administrator before reading the view', async () => {
    const anonymous = fakePool(null);
    const unauthenticated = await request(createApp(anonymous.pool)).get('/api/v1/admin/procurement/forecast');
    expect(unauthenticated.status).toBe(401);
    expect(anonymous.query).not.toHaveBeenCalled();

    const nonAdmin = fakePool(user);
    const forbidden = await request(createApp(nonAdmin.pool)).get('/api/v1/admin/procurement/forecast').set('Cookie', cookie);
    expect(forbidden.status).toBe(403);
    expect(nonAdmin.query).toHaveBeenCalledTimes(1);
  });

  it('reads the existing view, converts PostgreSQL numeric strings, and suppresses unsupported forecasts', async () => {
    const { pool, query } = fakePool(admin, [
      databaseRow(),
      databaseRow({ product_id: '43', sales_history_observations: '1', history_days_available: '70' }),
      databaseRow({ product_id: '44', sales_history_observations: '2', history_days_available: '180', sales_observation_days_180d: '1' }),
      databaseRow({ product_id: '45', sales_180d: '0', forecast_30d: '0', safety_stock: '0', recommended_purchase: '0', sales_history_observations: '5', history_days_available: '180', sales_observation_days_180d: '0' }),
      databaseRow({ product_id: '46', sales_180d: '0', forecast_30d: '0', safety_stock: '0', recommended_purchase: '0', sales_history_observations: '0', history_days_available: '0', sales_observation_days_180d: '0' }),
    ]);
    const response = await request(createApp(pool)).get('/api/v1/admin/procurement/forecast').set('Cookie', cookie);

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(5);
    expect(response.body.forecast.map((row: { data_status: string }) => row.data_status)).toEqual([
      'READY', 'INSUFFICIENT_DATA', 'INSUFFICIENT_DATA', 'NO_SALES', 'NO_HISTORY',
    ]);
    const [ready, insufficientWindow, singleSaleDay, noSales, noHistory] = response.body.forecast;
    expect(ready).toMatchObject({ product_id: 42, stock_quantity: 10, available_stock: 10, delivered_90d: 12, open_orders: 3, sales_180d: 24, processing_orders: 3, forecast_30d: 4, safety_stock: 2, recommended_purchase: 0 });
    expect(typeof ready.sales_180d).toBe('number');
    expect(insufficientWindow).toMatchObject({ stock_quantity: 10, processing_orders: 3, forecast_30d: null, safety_stock: null, recommended_purchase: null, procurement_status: null });
    expect(singleSaleDay).toMatchObject({ history_days_available: 180, sales_observation_days_180d: 1, forecast_30d: null, recommended_purchase: null, data_status: 'INSUFFICIENT_DATA' });
    expect(noSales).toMatchObject({ sales_180d: 0, forecast_30d: null, safety_stock: null, recommended_purchase: null, procurement_status: null, data_status: 'NO_SALES' });
    expect(noHistory).toMatchObject({ stock_quantity: 10, processing_orders: 3, forecast_30d: null, recommended_purchase: null, data_status: 'NO_HISTORY' });

    const forecastSql = String(query.mock.calls.find(([sql]) => sql.includes('FROM public.procurement_forecast AS forecast'))?.[0]);
    expect(forecastSql).toContain('LOWER(TRIM(order_row.status)) IN (\'delivered\', \'shipped\')');
    expect(forecastSql).toContain('CURRENT_DATE - INTERVAL \'180 days\'');
    expect(forecastSql).toContain('CURRENT_DATE + INTERVAL \'1 day\'');
  });

  it('returns an empty list when the view has no products', async () => {
    const { pool } = fakePool(admin);
    const response = await request(createApp(pool)).get('/api/v1/admin/procurement/forecast').set('Cookie', cookie);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ forecast: [], total: 0 });
  });

  it('returns a safe server error when the view query fails', async () => {
    const { pool } = fakePool(admin, [], new Error('relation details must not be exposed'));
    const response = await request(createApp(pool)).get('/api/v1/admin/procurement/forecast').set('Cookie', cookie);
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Internal server error' });
    expect(JSON.stringify(response.body)).not.toContain('relation details');
  });
});
