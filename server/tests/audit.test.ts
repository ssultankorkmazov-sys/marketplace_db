import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Pool } from 'pg';
import { createApp } from '../src/app.js';
import { recordAuditLog, type AuditLog } from '../src/audit.js';

const token = Buffer.from('a'.repeat(32)).toString('base64url');
const cookie = `marketkz_session=${token}`;
const admin = { user_id: 8, name: 'Admin', email: 'admin@example.kz', phone: '+77000000008', address: null, role: 'admin' };
const user = { user_id: 9, name: 'Buyer', email: 'buyer@example.kz', phone: '+77000000009', address: null, role: 'user' };
const sample: AuditLog = { log_id: '44', user_id: 8, action: 'PRODUCT_UPDATED', entity_type: 'product', entity_id: 18, status: 'SUCCESS', details: { fields: ['price'] }, ip_address: null, created_at: '2026-10-20T10:00:00.000Z' };

describe('audit log service and admin API', () => {
  it('writes backend-created audit metadata and publishes the saved event', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [sample] });
    const publisher = { publish: vi.fn() };
    const log = await recordAuditLog({ query } as unknown as Pool, {
      userId: admin.user_id, action: 'PRODUCT_UPDATED', entityType: 'product', entityId: 18,
      status: 'SUCCESS', details: { fields: ['price'] },
    }, publisher);

    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO audit_logs'), [8, 'PRODUCT_UPDATED', 'product', 18, 'SUCCESS', '{"fields":["price"]}', null]);
    expect(log).toEqual(sample);
    expect(publisher.publish).toHaveBeenCalledWith(sample);
  });

  it('allows admins to page and filter logs using bound query parameters', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM user_sessions')) return { rows: [admin] };
      if (sql.includes('COUNT(*) FILTER')) return { rows: [{ total: 1, successful: 0, failed: 1 }] };
      if (sql.includes('SELECT log_id')) return { rows: [sample] };
      return { rows: [] };
    });
    const response = await request(createApp({ query } as unknown as Pool))
      .get('/api/v1/admin/logs?page=2&pageSize=10&action=PRODUCT_UPDATED&status=SUCCESS&userId=8&from=2026-10-01&to=2026-10-31&q=18')
      .set('Cookie', cookie);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ logs: [sample], page: 2, pageSize: 10, total: 1, successful: 0, failed: 1 });
    const listCall = query.mock.calls.find(([sql]) => String(sql).includes('SELECT log_id'))!;
    expect(listCall[1]).toEqual(['PRODUCT_UPDATED', 'SUCCESS', 8, '2026-10-01', '2026-10-31', '%18%', 10, 10]);
    expect(String(listCall[0])).toContain('ORDER BY created_at DESC, log_id DESC');
  });

  it('returns a single log record only to an administrator', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM user_sessions')) return { rows: [admin] };
      if (sql.includes('SELECT log_id') && sql.includes('WHERE log_id')) return { rows: [sample] };
      return { rows: [] };
    });
    const response = await request(createApp({ query } as unknown as Pool)).get('/api/v1/admin/logs/44').set('Cookie', cookie);
    expect(response.status).toBe(200);
    expect(response.body.log).toEqual(sample);
  });

  it('denies non-admin and unauthenticated access and rejects invalid filters', async () => {
    const query = vi.fn(async (sql: string) => sql.includes('FROM user_sessions') ? { rows: [user] } : sql.includes('INSERT INTO audit_logs') ? { rows: [sample] } : { rows: [] });
    const app = createApp({ query } as unknown as Pool);
    expect((await request(app).get('/api/v1/admin/logs')).status).toBe(401);
    expect((await request(app).get('/api/v1/admin/logs').set('Cookie', cookie)).status).toBe(403);
    expect((await request(app).get('/api/v1/admin/logs?status=OTHER').set('Cookie', cookie)).status).toBe(403);
  });

  it('rejects invalid filter parameters after administrator authorization', async () => {
    const query = vi.fn(async (sql: string) => sql.includes('FROM user_sessions') ? { rows: [admin] } : { rows: [] });
    const response = await request(createApp({ query } as unknown as Pool)).get('/api/v1/admin/logs?status=OTHER').set('Cookie', cookie);
    expect(response.status).toBe(400);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('FROM audit_logs WHERE'))).toBe(false);
  });

  it.each([
    '/api/v1/admin/logs?status=SUCCESS&status=FAILURE',
    '/api/v1/admin/logs?from=2026-02-31',
    '/api/v1/admin/logs?unknown=value',
  ])('rejects malformed, repeated, or unsupported query parameters: %s', async (path) => {
    const query = vi.fn(async (sql: string) => sql.includes('FROM user_sessions') ? { rows: [admin] } : { rows: [] });
    const response = await request(createApp({ query } as unknown as Pool)).get(path).set('Cookie', cookie);
    expect(response.status).toBe(400);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('SELECT log_id'))).toBe(false);
  });

  it('records successful and failed login attempts without credentials in event details', async () => {
    let storedHash = '';
    const records: unknown[][] = [];
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes('INSERT INTO users')) return { rows: [user] };
      if (sql.includes('INSERT INTO user_sessions')) return { rows: [] };
      if (sql.includes('INSERT INTO audit_logs')) {
        records.push(values ?? []);
        return { rows: [{ ...sample, user_id: values?.[0] ?? null, action: values?.[1], status: values?.[4], details: JSON.parse(String(values?.[5])) }] };
      }
      if (sql.includes('password_hash FROM users')) return { rows: [{ ...user, password_hash: storedHash }] };
      return { rows: [] };
    });
    const app = createApp({ query } as unknown as Pool);
    const register = await request(app).post('/api/v1/auth/register').send({ name: user.name, email: user.email, phone: user.phone, password: 'long-test-password' });
    expect(register.status).toBe(201);
    storedHash = String(query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO users'))?.[1]?.[4]);
    expect((await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'long-test-password' })).status).toBe(200);
    expect((await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'incorrect-password' })).status).toBe(401);

    expect(records.map((values) => values[1])).toEqual(['USER_REGISTERED', 'LOGIN_SUCCESS', 'LOGIN_FAILED']);
    expect(records[2][5]).toBe('{"reason":"invalid_credentials"}');
    expect(records.every((values) => !JSON.stringify(values).includes('long-test-password') && !JSON.stringify(values).includes(storedHash))).toBe(true);
  });

  it('records product administration events without logging product content', async () => {
    const calls: { sql: string; values?: unknown[] }[] = [];
    const product = { product_id: 18, name: 'Camera', description: 'Sensitive free text is omitted from logs', price: 100, stock_quantity: 2, category_id: 3 };
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      if (sql.includes('FROM user_sessions')) return { rows: [admin] };
      if (sql.includes('INSERT INTO products')) return { rows: [product] };
      if (sql.includes('INSERT INTO audit_logs')) return { rows: [{ ...sample, action: values?.[1], entity_id: values?.[3], details: JSON.parse(String(values?.[5])) }] };
      return { rows: [] };
    });
    const pool = { query, connect: vi.fn().mockResolvedValue({ query, release: vi.fn() }) };
    const response = await request(createApp(pool as unknown as Pool)).post('/api/v1/admin/products').set('Cookie', cookie).send({ name: product.name, description: product.description, price: 100, stock_quantity: 2, category_id: 3 });
    expect(response.status).toBe(201);
    const event = calls.find((call) => call.sql.includes('INSERT INTO audit_logs'))!;
    expect(event.values?.slice(0, 5)).toEqual([8, 'PRODUCT_CREATED', 'product', 18, 'SUCCESS']);
    expect(event.values?.[5]).toBe('{}');
  });

  it('updates order status and inserts its audit event in the same transaction', async () => {
    const clientCalls: { sql: string; values?: unknown[] }[] = [];
    const clientQuery = vi.fn(async (sql: string, values?: unknown[]) => {
      clientCalls.push({ sql, values });
      if (sql.includes('SELECT status FROM orders')) return { rows: [{ status: 'Processing' }] };
      if (sql.includes('UPDATE orders')) return { rows: [{ order_id: 11, status: 'Shipped' }] };
      if (sql.includes('INSERT INTO audit_logs')) return { rows: [{ ...sample, action: values?.[1], entity_id: values?.[3], details: JSON.parse(String(values?.[5])) }] };
      return { rows: [] };
    });
    const query = vi.fn(async (sql: string) => sql.includes('FROM user_sessions') ? { rows: [admin] } : { rows: [] });
    const publisher = { publish: vi.fn() };
    const pool = { query, connect: vi.fn().mockResolvedValue({ query: clientQuery, release: vi.fn() }) };
    const response = await request(createApp(pool as unknown as Pool, { auditPublisher: publisher })).patch('/api/v1/admin/orders/11/status').set('Cookie', cookie).send({ status: 'Shipped' });
    expect(response.status).toBe(200);
    expect(clientCalls[0].sql).toBe('BEGIN');
    expect(clientCalls.at(-1)?.sql).toBe('COMMIT');
    const event = clientCalls.find((call) => call.sql.includes('INSERT INTO audit_logs'))!;
    expect(event.values?.[1]).toBe('ORDER_STATUS_CHANGED');
    expect(event.values?.[5]).toBe('{"from":"Processing","to":"Shipped"}');
    expect(publisher.publish).toHaveBeenCalledOnce();
  });
});
