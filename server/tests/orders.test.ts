import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Pool, PoolClient } from 'pg';
import { createApp } from '../src/app.js';

const user = { user_id: 7, name: 'Buyer', email: 'buyer@example.kz', phone: '+77001112233', address: null, role: 'user' };
const product = { name: 'Camera', price: '125.50', stock_quantity: 3 };
const cookie = 'marketkz_session=' + Buffer.from('s'.repeat(32)).toString('base64url');
const payload = { items: [{ product_id: 4, quantity: 2, unit_price: 0 }], total_amount: 0, shipping: { name: 'Buyer', phone: '+77001112233', city: 'Almaty', address: 'Abay 1' }, paymentMethod: 'kaspi' };

function setup(options: { stock?: number; missingProduct?: boolean } = {}) {
  const stock = options.stock ?? 3;
  const calls: { sql: string; values?: unknown[] }[] = [];
  const clientQuery = vi.fn(async (sql: string, values?: unknown[]) => {
    calls.push({ sql, values });
    if (sql.includes('SELECT name, price::text')) return { rows: options.missingProduct ? [] : [{ ...product, stock_quantity: stock }], rowCount: 1 };
    if (sql.includes('INSERT INTO orders')) return { rows: [{ order_id: 91, user_id: user.user_id, order_date: '2026-10-13T12:00:00Z', status: 'Processing', total_amount: values?.[1] }], rowCount: 1 };
    if (sql.includes('UPDATE products')) return { rows: [], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  });
  const client = { query: clientQuery, release: vi.fn() } as unknown as PoolClient;
  const poolQuery = vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql.includes('FROM user_sessions')) return { rows: [user], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  const pool = { query: poolQuery, connect: vi.fn().mockResolvedValue(client) } as unknown as Pool;
  return { app: createApp(pool), poolQuery, clientQuery, calls, pool };
}

describe('orders API', () => {
  it('recalculates price on the server and creates an order atomically', async () => {
    const { app, clientQuery, calls, pool } = setup();
    const response = await request(app).post('/api/v1/orders').set('Cookie', cookie).send(payload);
    expect(response.status).toBe(201);
    expect(response.body.order).toMatchObject({ order_id: 91, total_amount: 251, status: 'Processing' });
    expect(pool.connect).toHaveBeenCalledOnce();
    expect(calls[0].sql).toBe('BEGIN');
    expect(calls.at(-1)?.sql).toBe('COMMIT');
    const orderInsert = calls.find((call) => call.sql.includes('INSERT INTO orders'))!;
    expect(orderInsert.values).toEqual([7, '251.00', 'Buyer', '+77001112233', 'Almaty', 'Abay 1']);
    const itemInsert = calls.find((call) => call.sql.includes('INSERT INTO order_items'))!;
    expect(itemInsert.values).toEqual([91, 4, 2, '125.50']);
    expect(calls.find((call) => call.sql.includes('UPDATE products'))?.values).toEqual([2, 4]);
    expect(calls.find((call) => call.sql.includes('INSERT INTO payments'))?.values).toEqual([91, '251.00', 'Kaspi Pay']);
    expect(clientQuery).toHaveBeenCalled();
  });

  it('rolls the transaction back if stock is insufficient', async () => {
    const { app, calls } = setup({ stock: 1 });
    const response = await request(app).post('/api/v1/orders').set('Cookie', cookie).send(payload);
    expect(response.status).toBe(409);
    expect(response.body.error).toContain('Недостаточно товара');
    expect(calls.some((call) => call.sql === 'ROLLBACK')).toBe(true);
    expect(calls.some((call) => call.sql.includes('INSERT INTO orders'))).toBe(false);
  });

  it.each([0, -1, 1.5, '2'])('rejects invalid quantity %s before opening a transaction', async (quantity) => {
    const { app, pool } = setup();
    const response = await request(app).post('/api/v1/orders').set('Cookie', cookie).send({ ...payload, items: [{ product_id: 4, quantity }] });
    expect(response.status).toBe(400);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('returns only the signed-in user’s orders and hides another user’s order as not found', async () => {
    const ownOrder = { order_id: 12, user_id: 7, order_date: '2026-10-13T12:00:00Z', status: 'Processing', total_amount: 100 };
    const poolQuery = vi.fn(async (sql: string) => {
      if (sql.includes('FROM user_sessions')) return { rows: [user] };
      if (sql.includes('FROM orders WHERE user_id=$1')) return { rows: [ownOrder] };
      if (sql.includes('FROM orders o WHERE o.order_id=$1 AND o.user_id=$2')) return { rows: [] };
      return { rows: [] };
    });
    const app = createApp({ query: poolQuery } as unknown as Pool);
    const history = await request(app).get('/api/v1/orders').set('Cookie', cookie);
    expect(history.status).toBe(200);
    expect(history.body.orders).toHaveLength(1);
    expect(poolQuery.mock.calls.find(([sql]) => String(sql).includes('FROM orders WHERE user_id=$1'))?.[1]).toEqual([user.user_id]);
    const foreign = await request(app).get('/api/v1/orders/999').set('Cookie', cookie);
    expect(foreign.status).toBe(404);
    expect(poolQuery.mock.calls.find(([sql]) => String(sql).includes('AND o.user_id=$2'))?.[1]).toEqual([999, user.user_id]);
  });
});
