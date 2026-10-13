import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Pool } from 'pg';
import { createApp } from '../src/app.js';

const token = Buffer.from('a'.repeat(32)).toString('base64url');
const cookie = `marketkz_session=${token}`;
const admin = { user_id: 1, name: 'Admin', email: 'admin@example.kz', phone: '+77000000001', address: null, role: 'admin' };
const ordinaryUser = { ...admin, user_id: 2, role: 'user' };
const product = { product_id: 8, name: 'Camera', description: 'Digital camera', price: 120000, stock_quantity: 4, category_id: 6 };
const productInput = { name: product.name, description: product.description, price: product.price, stock_quantity: product.stock_quantity, category_id: product.category_id };

function appFor(role: 'admin'|'user'|null = 'admin') {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('FROM user_sessions')) return { rows: role ? [role === 'admin' ? admin : ordinaryUser] : [] };
    if (sql.includes('SELECT p.product_id')) return { rows: [product] };
    if (sql.includes('INSERT INTO products')) return { rows: [product] };
    if (sql.includes('UPDATE products')) return { rows: [product] };
    if (sql.includes('DELETE FROM products')) return { rows: [{ product_id: product.product_id }] };
    if (sql.includes('FROM orders o JOIN users')) return { rows: [{ order_id: 4, user_id: 3, order_date: '2026-10-13', status: 'Processing', total_amount: 120000, recipient_name: 'Buyer', recipient_phone: '+77000000003', delivery_city: 'Almaty', delivery_address: 'Abay 1', customer_name: 'Buyer', customer_email: 'buyer@example.kz', customer_phone: '+77000000003', customer_address: 'Abay 1', payment_id: null }] };
    if (sql.includes('FROM order_items i JOIN products')) return { rows: [] };
    return { rows: [] };
  });
  return { app: createApp({ query } as unknown as Pool), query };
}

describe('admin API', () => {
  it('lets an administrator view orders and manage products', async () => {
    const { app, query } = appFor();
    const orders = await request(app).get('/api/v1/admin/orders').set('Cookie', cookie);
    expect(orders.status).toBe(200);
    expect(orders.body.orders[0]).toMatchObject({ order: { order_id: 4 }, user: { name: 'Buyer' }, items: [] });
    expect((await request(app).get('/api/v1/admin/products').set('Cookie', cookie)).body.products).toEqual([product]);
    expect((await request(app).post('/api/v1/admin/products').set('Cookie', cookie).send(productInput)).status).toBe(201);
    expect((await request(app).patch('/api/v1/admin/products/8').set('Cookie', cookie).send({ ...productInput, price: 125000 })).status).toBe(200);
    expect((await request(app).delete('/api/v1/admin/products/8').set('Cookie', cookie)).status).toBe(204);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO products'))).toBe(true);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('UPDATE products'))).toBe(true);
  });

  it('denies every admin operation to an unauthenticated request', async () => {
    const { app, query } = appFor(null);
    const responses = await Promise.all([
      request(app).get('/api/v1/admin/orders'), request(app).get('/api/v1/admin/products'),
      request(app).post('/api/v1/admin/products').send(productInput), request(app).patch('/api/v1/admin/products/8').send(productInput),
      request(app).delete('/api/v1/admin/products/8'),
    ]);
    expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 401, 401]);
    expect(query.mock.calls.every(([sql]) => String(sql).includes('FROM user_sessions'))).toBe(true);
  });

  it('denies every admin operation to an ordinary signed-in user', async () => {
    const { app, query } = appFor('user');
    const responses = await Promise.all([
      request(app).get('/api/v1/admin/orders').set('Cookie', cookie), request(app).get('/api/v1/admin/products').set('Cookie', cookie),
      request(app).post('/api/v1/admin/products').set('Cookie', cookie).send(productInput), request(app).patch('/api/v1/admin/products/8').set('Cookie', cookie).send(productInput),
      request(app).delete('/api/v1/admin/products/8').set('Cookie', cookie),
    ]);
    expect(responses.map((response) => response.status)).toEqual([403, 403, 403, 403, 403]);
    expect(query.mock.calls.every(([sql]) => String(sql).includes('FROM user_sessions'))).toBe(true);
  });

  it('refuses to delete a product linked to an order or review', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM user_sessions')) return { rows: [admin] };
      if (sql.includes('DELETE FROM products')) throw Object.assign(new Error('foreign key violation'), { code: '23503' });
      return { rows: [] };
    });
    const response = await request(createApp({ query } as unknown as Pool)).delete('/api/v1/admin/products/8').set('Cookie', cookie);
    expect(response.status).toBe(409);
    expect(response.body.error).toContain('заказы или отзывы');
  });
});
