import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createPool } from '../src/db.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
let pool: ReturnType<typeof createPool>;

integration('PostgreSQL catalog integration (TEST_DATABASE_URL only)', () => {
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname)) throw new Error('TEST_DATABASE_URL must point to a local PostgreSQL server.');
    const dbName = decodeURIComponent(url.pathname.slice(1));
    if (!dbName.endsWith('_test')) throw new Error('TEST_DATABASE_URL must target a database whose name ends with _test.');
    pool = createPool({ databaseUrl: databaseUrl! });
    await pool.query('SELECT 1 FROM categories LIMIT 1');
  });
  afterAll(async () => { await pool?.end(); });

  it('executes real SQL and returns the imported catalog', async () => {
    const response = await request(createApp(pool)).get('/api/v1/products?page=1&pageSize=5&sortBy=price');
    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(5);
    expect(response.body.total).toBe(50);
    expect(response.body.items[0].price).toBeLessThanOrEqual(response.body.items[4].price);
  });
});

type Agent = ReturnType<typeof request.agent>;
type TestAccount = { agent: Agent; userId: number; email: string };

integration('PostgreSQL auth, orders, transactions and admin integration (TEST_DATABASE_URL only)', () => {
  let buyer: TestAccount;
  let otherBuyer: TestAccount;
  let administrator: TestAccount;
  let productId: number;
  let orderIds: number[] = [];
  let adminProductId: number | undefined;
  const app = () => createApp(pool);
  const unique = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  let phoneCounter = 0;

  async function register(label: string): Promise<TestAccount> {
    const email = `marketkz_${label}_${unique}@example.test`;
    const agent = request.agent(app());
    const response = await agent.post('/api/v1/auth/register').send({
      name: `Integration ${label}`, email, phone: `+770${String(Date.now()).slice(-7)}${String(++phoneCounter).padStart(2, '0')}`,
      address: 'Test address', password: 'integration-password-123',
    });
    expect(response.status).toBe(201);
    return { agent, userId: response.body.user.user_id, email };
  }

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname)) throw new Error('TEST_DATABASE_URL must point to a local PostgreSQL server.');
    if (!decodeURIComponent(url.pathname.slice(1)).endsWith('_test')) throw new Error('TEST_DATABASE_URL must target a database whose name ends with _test.');
    pool = createPool({ databaseUrl: databaseUrl! });
    await pool.query('SELECT 1 FROM categories LIMIT 1');
    await pool.query('SELECT password_hash, role FROM users LIMIT 1');
    const products = await pool.query<{ product_id: number }>(
      `INSERT INTO products (name, description, price, stock_quantity, category_id)
       VALUES ($1, 'Integration test product', 17.25, 2, 1) RETURNING product_id`,
      [`Integration product ${unique}`],
    );
    productId = products.rows[0].product_id;
    buyer = await register('buyer');
    otherBuyer = await register('other');
    administrator = await register('admin');
    await pool.query('UPDATE users SET role=$1 WHERE user_id=$2', ['admin', administrator.userId]);
  });

  afterAll(async () => {
    if (pool) {
      if (orderIds.length) {
        await pool.query('DELETE FROM payments WHERE order_id = ANY($1::int[])', [orderIds]);
        await pool.query('DELETE FROM order_items WHERE order_id = ANY($1::int[])', [orderIds]);
        await pool.query('DELETE FROM orders WHERE order_id = ANY($1::int[])', [orderIds]);
      }
      if (adminProductId) await pool.query('DELETE FROM products WHERE product_id=$1', [adminProductId]);
      if (productId) await pool.query('DELETE FROM products WHERE product_id=$1', [productId]);
      for (const account of [buyer, otherBuyer, administrator]) {
        if (account?.userId) await pool.query('DELETE FROM users WHERE user_id=$1', [account.userId]);
      }
      await pool.end();
    }
  });

  it('requires sessions, recalculates order prices, writes atomically, and scopes order access to its owner', async () => {
    expect((await request(app()).get('/api/v1/orders')).status).toBe(401);
    const created = await buyer.agent.post('/api/v1/orders').send({
      items: [{ product_id: productId, quantity: 1, unit_price: 0 }], total_amount: 0,
      shipping: { name: 'Integration Buyer', phone: '+77000000001', city: 'Almaty', address: 'Test 1' }, paymentMethod: 'kaspi',
    });
    expect(created.status).toBe(201);
    expect(created.body.order).toMatchObject({ total_amount: 17.25, status: 'Processing' });
    const orderId = created.body.order.order_id as number;
    orderIds.push(orderId);
    const dbOrder = await pool.query('SELECT total_amount::float8 AS total, status FROM orders WHERE order_id=$1', [orderId]);
    expect(dbOrder.rows[0]).toMatchObject({ total: 17.25, status: 'Processing' });
    expect((await pool.query('SELECT stock_quantity FROM products WHERE product_id=$1', [productId])).rows[0].stock_quantity).toBe(1);
    const history = await buyer.agent.get('/api/v1/orders');
    expect(history.status).toBe(200);
    expect(history.body.orders.some((order: { order_id: number }) => order.order_id === orderId)).toBe(true);
    expect((await otherBuyer.agent.get(`/api/v1/orders/${orderId}`)).status).toBe(404);
    expect((await buyer.agent.get(`/api/v1/orders/${orderId}`)).status).toBe(200);
  });

  it('rejects insufficient stock and invalid quantities without persisting an order or changing stock', async () => {
    const before = await pool.query('SELECT stock_quantity FROM products WHERE product_id=$1', [productId]);
    const payload = { items: [{ product_id: productId, quantity: 2 }], shipping: { name: 'Buyer', phone: '+77000000001', city: 'Almaty', address: 'Test 1' }, paymentMethod: 'cash' };
    const shortage = await buyer.agent.post('/api/v1/orders').send(payload);
    expect(shortage.status).toBe(409);
    const invalid = await buyer.agent.post('/api/v1/orders').send({ ...payload, items: [{ product_id: productId, quantity: 0 }] });
    expect(invalid.status).toBe(400);
    expect((await pool.query('SELECT stock_quantity FROM products WHERE product_id=$1', [productId])).rows[0].stock_quantity).toBe(before.rows[0].stock_quantity);
    const leaked = await pool.query('SELECT COUNT(*)::int AS count FROM orders WHERE user_id=$1 AND order_date > NOW() - INTERVAL \'2 minutes\'', [buyer.userId]);
    expect(leaked.rows[0].count).toBe(orderIds.length);
  });

  it('denies admin endpoints to guests and ordinary users, while an administrator can manage products and view orders', async () => {
    expect((await request(app()).get('/api/v1/admin/orders')).status).toBe(401);
    expect((await buyer.agent.get('/api/v1/admin/products')).status).toBe(403);
    expect((await administrator.agent.get('/api/v1/admin/orders')).status).toBe(200);
    const created = await administrator.agent.post('/api/v1/admin/products').send({ name: `Admin product ${unique}`, description: 'Test', price: 22.5, stock_quantity: 3, category_id: 1 });
    expect(created.status).toBe(201);
    adminProductId = created.body.product.product_id;
    const updated = await administrator.agent.patch(`/api/v1/admin/products/${adminProductId}`).send({ name: `Updated admin product ${unique}`, description: 'Updated', price: 24.5, stock_quantity: 4, category_id: 1 });
    expect(updated.status).toBe(200);
    expect(updated.body.product.price).toBe(24.5);
    expect((await administrator.agent.delete(`/api/v1/admin/products/${adminProductId}`)).status).toBe(204);
    adminProductId = undefined;
  });
});
