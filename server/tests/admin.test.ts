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
const category = { category_id: 6, category_name: 'Cameras', count: 2 };
const safeUser = { user_id: 7, name: 'Buyer', email: 'buyer@example.kz', phone: '+77000000007', address: null, order_count: 2, review_count: 1 };
const review = { review_id: 3, user_id: 7, product_id: 8, rating: 5, comment: 'Great', review_date: '2026-10-13', user: { user_id: 7, name: 'Buyer' }, product: { product_id: 8, name: 'Camera' } };

function appFor(role: 'admin'|'user'|null = 'admin') {
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql.includes('FROM user_sessions')) return { rows: role ? [role === 'admin' ? admin : ordinaryUser] : [] };
    if (sql.includes('FROM public.categories c LEFT JOIN public.products')) return { rows: [category] };
    if (sql.includes('INSERT INTO public.categories')) return { rows: [{ category_id: 9, category_name: values?.[0] }] };
    if (sql.includes('UPDATE public.categories')) return { rows: [{ category_id: Number(values?.[1]), category_name: values?.[0], count: 2 }] };
    if (sql.includes('DELETE FROM public.categories')) return { rows: [{ category_id: Number(values?.[0]) }] };
    if (sql.includes('FROM public.users u')) return { rows: [safeUser] };
    if (sql.includes('FROM public.reviews r')) return { rows: [review] };
    if (sql.includes('DELETE FROM public.reviews')) return { rows: [{ review_id: Number(values?.[0]) }] };
    if (sql.includes('INSERT INTO audit_logs')) return { rows: [{ log_id: 1, user_id: values?.[0] ?? null, action: values?.[1], entity_type: values?.[2] ?? null, entity_id: values?.[3] ?? null, status: values?.[4], details: JSON.parse(String(values?.[5] ?? '{}')), ip_address: null, created_at: '2026-10-13T12:00:00Z' }] };
    if (sql.includes('SELECT p.product_id')) return { rows: [product] };
    if (sql.includes('INSERT INTO products')) return { rows: [product] };
    if (sql.includes('UPDATE products')) return { rows: [product] };
    if (sql.includes('DELETE FROM products')) return { rows: [{ product_id: product.product_id }] };
    if (sql.includes('FROM orders o JOIN users')) return { rows: [{ order_id: 4, user_id: 3, order_date: '2026-10-13', status: 'Processing', total_amount: 120000, recipient_name: 'Buyer', recipient_phone: '+77000000003', delivery_city: 'Almaty', delivery_address: 'Abay 1', customer_name: 'Buyer', customer_email: 'buyer@example.kz', customer_phone: '+77000000003', customer_address: 'Abay 1', payment_id: null }] };
    if (sql.includes('FROM order_items i JOIN products')) return { rows: [] };
    return { rows: [] };
  });
  return { app: createApp({ query, connect: vi.fn().mockResolvedValue({ query, release: vi.fn() }) } as unknown as Pool), query };
}

describe('admin API', () => {
  it('reads and manages categories, returns safe users and manages reviews', async () => {
    const { app, query } = appFor();
    const categories = await request(app).get('/api/v1/admin/categories').set('Cookie', cookie);
    expect(categories.status).toBe(200);
    expect(categories.body.categories).toEqual([category]);

    const created = await request(app).post('/api/v1/admin/categories').set('Cookie', cookie).send({ name: ' New Category ' });
    expect(created.status).toBe(201);
    expect(created.body.category).toMatchObject({ category_id: 9, category_name: 'New Category', count: 0 });
    expect((await request(app).patch('/api/v1/admin/categories/6').set('Cookie', cookie).send({ name: 'Updated' })).body.category).toMatchObject({ category_name: 'Updated', count: 2 });
    expect((await request(app).delete('/api/v1/admin/categories/6').set('Cookie', cookie)).status).toBe(204);

    const users = await request(app).get('/api/v1/admin/users').set('Cookie', cookie);
    expect(users.status).toBe(200);
    expect(users.body.users).toEqual([safeUser]);
    expect(JSON.stringify(users.body)).not.toMatch(/password|token|role/i);
    expect((await request(app).get('/api/v1/admin/reviews').set('Cookie', cookie)).body.reviews).toEqual([review]);
    expect((await request(app).delete('/api/v1/admin/reviews/3').set('Cookie', cookie)).status).toBe(204);
    expect(query.mock.calls.some(([sql, values]) => String(sql).includes('INSERT INTO public.categories') && values?.[0] === 'New Category')).toBe(true);
  });

  it('validates category input and safely refuses category deletion while products reference it', async () => {
    const { app } = appFor();
    expect((await request(app).post('/api/v1/admin/categories').set('Cookie', cookie).send({ name: '  ' })).status).toBe(400);
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM user_sessions')) return { rows: [admin] };
      if (sql.includes('DELETE FROM public.categories')) throw Object.assign(new Error('foreign key violation'), { code: '23503' });
      return { rows: [] };
    });
    const constrainedApp = createApp({ query, connect: vi.fn() } as unknown as Pool);
    const response = await request(constrainedApp).delete('/api/v1/admin/categories/6').set('Cookie', cookie);
    expect(response.status).toBe(409);
    expect(response.body.error).toContain('есть товары');
  });

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
      request(app).get('/api/v1/admin/categories'), request(app).post('/api/v1/admin/categories').send({ name: 'New' }),
      request(app).patch('/api/v1/admin/categories/6').send({ name: 'New' }), request(app).delete('/api/v1/admin/categories/6'),
      request(app).get('/api/v1/admin/users'), request(app).get('/api/v1/admin/reviews'), request(app).delete('/api/v1/admin/reviews/3'),
    ]);
    expect(responses.map((response) => response.status)).toEqual(Array(12).fill(401));
    expect(query.mock.calls.filter(([sql]) => !String(sql).includes('INSERT INTO audit_logs')).every(([sql]) => String(sql).includes('FROM user_sessions'))).toBe(true);
  });

  it('denies every admin operation to an ordinary signed-in user', async () => {
    const { app, query } = appFor('user');
    const responses = await Promise.all([
      request(app).get('/api/v1/admin/orders').set('Cookie', cookie), request(app).get('/api/v1/admin/products').set('Cookie', cookie),
      request(app).post('/api/v1/admin/products').set('Cookie', cookie).send(productInput), request(app).patch('/api/v1/admin/products/8').set('Cookie', cookie).send(productInput),
      request(app).delete('/api/v1/admin/products/8').set('Cookie', cookie),
      request(app).get('/api/v1/admin/categories').set('Cookie', cookie), request(app).post('/api/v1/admin/categories').set('Cookie', cookie).send({ name: 'New' }),
      request(app).patch('/api/v1/admin/categories/6').set('Cookie', cookie).send({ name: 'New' }), request(app).delete('/api/v1/admin/categories/6').set('Cookie', cookie),
      request(app).get('/api/v1/admin/users').set('Cookie', cookie), request(app).get('/api/v1/admin/reviews').set('Cookie', cookie), request(app).delete('/api/v1/admin/reviews/3').set('Cookie', cookie),
    ]);
    expect(responses.map((response) => response.status)).toEqual(Array(12).fill(403));
    expect(query.mock.calls.filter(([sql]) => !String(sql).includes('INSERT INTO audit_logs')).every(([sql]) => String(sql).includes('FROM user_sessions'))).toBe(true);
  });

  it('refuses to delete a product linked to an order or review', async () => {
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes('FROM user_sessions')) return { rows: [admin] };
      if (sql.includes('DELETE FROM products')) throw Object.assign(new Error('foreign key violation'), { code: '23503' });
      if (sql.includes('INSERT INTO audit_logs')) return { rows: [{ log_id: 1, user_id: values?.[0], action: values?.[1], entity_type: values?.[2], entity_id: values?.[3], status: values?.[4], details: JSON.parse(String(values?.[5])), ip_address: null, created_at: '2026-10-13T12:00:00Z' }] };
      return { rows: [] };
    });
    const clientQuery = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes('DELETE FROM products')) throw Object.assign(new Error('foreign key violation'), { code: '23503' });
      return query(sql, values);
    });
    const pool = { query, connect: vi.fn().mockResolvedValue({ query: clientQuery, release: vi.fn() }) };
    const response = await request(createApp(pool as unknown as Pool)).delete('/api/v1/admin/products/8').set('Cookie', cookie);
    expect(response.status).toBe(409);
    expect(response.body.error).toContain('заказы или отзывы');
  });
});
