import express, { type ErrorRequestHandler } from 'express';
import type { Pool, PoolClient } from 'pg';
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { checkDatabase } from './db.js';

const scrypt = promisify(scryptCallback);
const COOKIE = 'marketkz_session';
type UserRow = { user_id: number; name: string; email: string; phone: string; address: string | null; role: 'user' | 'admin' };
const publicUser = (row: UserRow) => ({ user_id: row.user_id, name: row.name, email: row.email, phone: row.phone, address: row.address, role: row.role });
const validEmail = (value: unknown): value is string => typeof value === 'string' && value.length <= 150 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const passwordHash = async (password: string) => {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64) as Buffer;
  return `${salt.toString('hex')}:${key.toString('hex')}`;
};
const verifyPassword = async (password: string, encoded: string) => {
  const [saltHex, keyHex] = encoded.split(':');
  if (!/^[\da-f]{32}$/.test(saltHex ?? '') || !/^[\da-f]{128}$/.test(keyHex ?? '')) return false;
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), 64) as Buffer;
  return timingSafeEqual(actual, Buffer.from(keyHex, 'hex'));
};
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
const cookieOptions = (secure: boolean, maxAge = 60 * 60 * 24 * 14) => `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
function cookieValue(header: string | undefined, name: string) {
  return header?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}
class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
type CheckoutLine = { product_id: number; quantity: number };
const PAYMENT_METHODS: Record<string, string> = { card: 'Bank Card', kaspi: 'Kaspi Pay', cash: 'Cash on delivery' };
type ProductInput = { name: string; description: string | null; price: number; stock_quantity: number; category_id: number };

function validateProduct(input: unknown): ProductInput | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as Record<string, unknown>;
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  const description = value.description === null || value.description === undefined ? null : value.description;
  const price = typeof value.price === 'string' || typeof value.price === 'number' ? Number(value.price) : NaN;
  const stock = typeof value.stock_quantity === 'string' || typeof value.stock_quantity === 'number' ? Number(value.stock_quantity) : NaN;
  const categoryId = typeof value.category_id === 'string' || typeof value.category_id === 'number' ? Number(value.category_id) : NaN;
  if (!name || name.length > 150 || (description !== null && (typeof description !== 'string' || description.length > 10_000)) ||
      !Number.isFinite(price) || price <= 0 || price > 99_999_999.99 || Math.abs(Math.round(price * 100) - price * 100) > 1e-7 ||
      !Number.isSafeInteger(stock) || stock < 0 || stock > 2_147_483_647 ||
      !Number.isSafeInteger(categoryId) || categoryId < 1 || categoryId > 2_147_483_647) return null;
  return { name, description: typeof description === 'string' ? description : null, price, stock_quantity: stock, category_id: categoryId };
}

const SORT_COLUMNS = { price: 'p.price', name: 'p.name' } as const;
type SortField = keyof typeof SORT_COLUMNS;
type SortDirection = 'asc' | 'desc';
const MAX_DATABASE_ID = 2_147_483_647;

function positiveInt(value: unknown, fallback: number, maximum: number): number | null {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= maximum ? parsed : null;
}

function sendDatabaseError(error: unknown, next: (error?: unknown) => void) {
  next(error);
}

export function createApp(pool: Pool, options: { secureCookies?: boolean } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  app.post('/api/v1/auth/register', async (request, response, next) => {
    const { name, email, phone, address, password } = request.body ?? {};
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 100 || !validEmail(email) ||
        typeof phone !== 'string' || !phone.trim() || phone.trim().length > 20 ||
        (address !== undefined && address !== null && (typeof address !== 'string' || address.length > 255)) ||
        typeof password !== 'string' || password.length < 8 || password.length > 200) {
      return response.status(400).json({ error: 'Проверьте данные. Пароль должен содержать не менее 8 символов.' });
    }
    try {
      const hash = await passwordHash(password);
      const { rows } = await pool.query<UserRow>(
        `INSERT INTO users (name, email, phone, address, password_hash)
         VALUES ($1, lower($2), $3, $4, $5)
         RETURNING user_id, name, email, phone, address, role`,
        [name.trim(), email.trim(), phone.trim(), typeof address === 'string' ? address.trim() || null : null, hash],
      );
      await issueSession(pool, rows[0], response, options.secureCookies ?? false);
      return response.status(201).json({ user: publicUser(rows[0]) });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') return response.status(409).json({ error: 'Пользователь с таким email или телефоном уже существует.' });
      return next(error);
    }
  });

  app.post('/api/v1/auth/login', async (request, response, next) => {
    const { email, password } = request.body ?? {};
    if (!validEmail(email) || typeof password !== 'string' || password.length > 200) return response.status(400).json({ error: 'Неверный email или пароль.' });
    try {
      const { rows } = await pool.query<UserRow & { password_hash: string | null }>(
        'SELECT user_id, name, email, phone, address, role, password_hash FROM users WHERE lower(email) = lower($1)', [email.trim()],
      );
      if (!rows[0]?.password_hash || !(await verifyPassword(password, rows[0].password_hash))) return response.status(401).json({ error: 'Неверный email или пароль.' });
      await issueSession(pool, rows[0], response, options.secureCookies ?? false);
      return response.json({ user: publicUser(rows[0]) });
    } catch (error) { return next(error); }
  });

  app.get('/api/v1/auth/me', async (request, response, next) => {
    try {
      const user = await sessionUser(pool, cookieValue(request.headers.cookie, COOKIE));
      return user ? response.json({ user: publicUser(user) }) : response.status(401).json({ error: 'Требуется вход.' });
    } catch (error) { return next(error); }
  });

  app.post('/api/v1/auth/logout', async (request, response, next) => {
    try {
      const token = cookieValue(request.headers.cookie, COOKIE);
      if (token) await pool.query('DELETE FROM user_sessions WHERE token_hash = $1', [tokenHash(token)]);
      response.setHeader('Set-Cookie', `${COOKIE}=; ${cookieOptions(options.secureCookies ?? false, 0)}`);
      return response.status(204).end();
    } catch (error) { return next(error); }
  });

  app.patch('/api/v1/profile', async (request, response, next) => {
    try {
      const current = await sessionUser(pool, cookieValue(request.headers.cookie, COOKIE));
      if (!current) return response.status(401).json({ error: 'Требуется вход.' });
      const { name, phone, address } = request.body ?? {};
      if (typeof name !== 'string' || !name.trim() || name.trim().length > 100 || typeof phone !== 'string' || !phone.trim() || phone.trim().length > 20 ||
          (address !== undefined && address !== null && (typeof address !== 'string' || address.length > 255))) return response.status(400).json({ error: 'Проверьте имя, телефон и адрес.' });
      const { rows } = await pool.query<UserRow>(
        `UPDATE users SET name=$1, phone=$2, address=$3 WHERE user_id=$4
         RETURNING user_id, name, email, phone, address, role`,
        [name.trim(), phone.trim(), typeof address === 'string' ? address.trim() || null : null, current.user_id],
      );
      return response.json({ user: publicUser(rows[0]) });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') return response.status(409).json({ error: 'Этот телефон уже используется.' });
      return next(error);
    }
  });

  app.post('/api/v1/orders', async (request, response, next) => {
    let client: PoolClient | null = null;
    let transactionOpen = false;
    try {
      const current = await sessionUser(pool, cookieValue(request.headers.cookie, COOKIE));
      if (!current) return response.status(401).json({ error: 'Требуется вход.' });
      if (current.role !== 'user') return response.status(403).json({ error: 'Оформление заказа доступно только покупателям.' });
      const { items, shipping, paymentMethod } = request.body ?? {};
      if (!Array.isArray(items) || items.length < 1 || items.length > 50 ||
          items.some((line: unknown) => !line || typeof line !== 'object' ||
            !Number.isSafeInteger((line as CheckoutLine).product_id) || (line as CheckoutLine).product_id < 1 ||
            !Number.isSafeInteger((line as CheckoutLine).quantity) || (line as CheckoutLine).quantity < 1 || (line as CheckoutLine).quantity > 99) ||
          new Set(items.map((line: CheckoutLine) => line.product_id)).size !== items.length) {
        return response.status(400).json({ error: 'Корзина содержит некорректные товары или количество.' });
      }
      if (!shipping || typeof shipping.name !== 'string' || !shipping.name.trim() || shipping.name.trim().length > 100 ||
          typeof shipping.phone !== 'string' || !shipping.phone.trim() || shipping.phone.trim().length > 20 ||
          typeof shipping.city !== 'string' || !shipping.city.trim() || shipping.city.trim().length > 100 ||
          typeof shipping.address !== 'string' || !shipping.address.trim() || shipping.address.trim().length > 255 ||
          typeof paymentMethod !== 'string' || !PAYMENT_METHODS[paymentMethod]) {
        return response.status(400).json({ error: 'Проверьте данные доставки и способ оплаты.' });
      }

      client = await pool.connect();
      await client.query('BEGIN');
      transactionOpen = true;
      const sortedItems = [...items as CheckoutLine[]].sort((a, b) => a.product_id - b.product_id);
      const products = new Map<number, { name: string; price: string; stock_quantity: number }>();
      for (const line of sortedItems) {
        const { rows } = await client.query<{ name: string; price: string; stock_quantity: number }>(
          'SELECT name, price::text AS price, stock_quantity FROM products WHERE product_id=$1 FOR UPDATE', [line.product_id],
        );
        if (!rows[0]) throw new ApiError(404, `Товар #${line.product_id} не найден.`);
        if (rows[0].stock_quantity < line.quantity) throw new ApiError(409, `Недостаточно товара «${rows[0].name}» на складе. Доступно: ${rows[0].stock_quantity}.`);
        products.set(line.product_id, rows[0]);
      }
      const totalCents = sortedItems.reduce((total, line) => total + Math.round(Number(products.get(line.product_id)!.price) * 100) * line.quantity, 0);
      if (!Number.isSafeInteger(totalCents) || totalCents < 1 || totalCents > 9_999_999_999) throw new ApiError(400, 'Сумма заказа превышает допустимое значение.');
      const total = (totalCents / 100).toFixed(2);
      const { rows: orderRows } = await client.query<{ order_id: number; user_id: number; order_date: string; status: string; total_amount: string }>(
        `INSERT INTO orders (user_id, order_date, status, total_amount, recipient_name, recipient_phone, delivery_city, delivery_address)
         VALUES ($1, NOW(), 'Processing', $2, $3, $4, $5, $6)
         RETURNING order_id, user_id, order_date, status, total_amount::text AS total_amount`,
        [current.user_id, total, shipping.name.trim(), shipping.phone.trim(), shipping.city.trim(), shipping.address.trim()],
      );
      const order = orderRows[0];
      for (const line of sortedItems) {
        const product = products.get(line.product_id)!;
        await client.query('INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES ($1, $2, $3, $4)',
          [order.order_id, line.product_id, line.quantity, Number(product.price).toFixed(2)]);
        const update = await client.query('UPDATE products SET stock_quantity=stock_quantity-$1 WHERE product_id=$2 AND stock_quantity >= $1', [line.quantity, line.product_id]);
        if (update.rowCount !== 1) throw new ApiError(409, `Недостаточно товара «${product.name}» на складе.`);
      }
      await client.query(
        `INSERT INTO payments (order_id, payment_date, amount, payment_method, status)
         VALUES ($1, NOW(), $2, $3, 'Pending')`, [order.order_id, total, PAYMENT_METHODS[paymentMethod]],
      );
      await client.query('COMMIT');
      transactionOpen = false;
      return response.status(201).json({ order: { ...order, total_amount: Number(order.total_amount) } });
    } catch (error) {
      if (client && transactionOpen) await client.query('ROLLBACK').catch(() => undefined);
      return next(error);
    } finally { client?.release(); }
  });

  app.get('/api/v1/orders', async (request, response, next) => {
    try {
      const current = await sessionUser(pool, cookieValue(request.headers.cookie, COOKIE));
      if (!current) return response.status(401).json({ error: 'Требуется вход.' });
      const { rows } = await pool.query(
        `SELECT order_id, user_id, order_date, status, total_amount::float8 AS total_amount
         FROM orders WHERE user_id=$1 ORDER BY order_date DESC, order_id DESC`, [current.user_id],
      );
      if (!rows.length) return response.json({ orders: [] });
      const orderIds = rows.map((order) => order.order_id);
      const [itemResult, paymentResult] = await Promise.all([
        pool.query(
          `SELECT i.order_item_id, i.order_id, i.product_id, i.quantity, i.unit_price::float8 AS unit_price,
                  p.name AS product_name, p.description AS product_description, p.stock_quantity, p.category_id
           FROM order_items i JOIN products p ON p.product_id=i.product_id
           WHERE i.order_id = ANY($1::int[]) ORDER BY i.order_item_id`, [orderIds],
        ),
        pool.query('SELECT payment_id, order_id, payment_date, amount::float8 AS amount, payment_method, status FROM payments WHERE order_id = ANY($1::int[])', [orderIds]),
      ]);
      const itemsByOrder = new Map<number, unknown[]>();
      for (const item of itemResult.rows) {
        const itemWithProduct = { ...item, product: { product_id: item.product_id, name: item.product_name, description: item.product_description, stock_quantity: item.stock_quantity, category_id: item.category_id } };
        itemsByOrder.set(item.order_id, [...(itemsByOrder.get(item.order_id) ?? []), itemWithProduct]);
      }
      const paymentByOrder = new Map(paymentResult.rows.map((payment) => [payment.order_id, payment]));
      return response.json({ orders: rows.map((order) => ({ ...order, items: itemsByOrder.get(order.order_id) ?? [], payment: paymentByOrder.get(order.order_id) ?? null })) });
    } catch (error) { return next(error); }
  });

  app.get('/api/v1/orders/:orderId', async (request, response, next) => {
    const orderId = positiveInt(request.params.orderId, 1, MAX_DATABASE_ID);
    if (orderId === null) return response.status(400).json({ error: 'Invalid order id' });
    try {
      const current = await sessionUser(pool, cookieValue(request.headers.cookie, COOKIE));
      if (!current) return response.status(401).json({ error: 'Требуется вход.' });
      const { rows } = await pool.query(
        `SELECT o.order_id, o.user_id, o.order_date, o.status, o.total_amount::float8 AS total_amount,
                o.recipient_name, o.recipient_phone, o.delivery_city, o.delivery_address
         FROM orders o WHERE o.order_id=$1 AND o.user_id=$2`, [orderId, current.user_id],
      );
      if (!rows[0]) return response.status(404).json({ error: 'Заказ не найден.' });
      const [itemRows, paymentRows] = await Promise.all([
        pool.query(
          `SELECT i.order_item_id, i.order_id, i.product_id, i.quantity, i.unit_price::float8 AS unit_price,
                  p.name AS product_name, p.description AS product_description, p.stock_quantity, p.category_id
           FROM order_items i JOIN products p ON p.product_id=i.product_id WHERE i.order_id=$1 ORDER BY i.order_item_id`, [orderId],
        ),
        pool.query('SELECT payment_id, order_id, payment_date, amount::float8 AS amount, payment_method, status FROM payments WHERE order_id=$1', [orderId]),
      ]);
      const order = rows[0];
      const items = itemRows.rows.map((item) => ({ ...item, product: { product_id: item.product_id, name: item.product_name, description: item.product_description, stock_quantity: item.stock_quantity, category_id: item.category_id } }));
      return response.json({
        order: { order_id: order.order_id, user_id: order.user_id, order_date: order.order_date, status: order.status, total_amount: order.total_amount },
        user: { user_id: current.user_id, name: order.recipient_name, email: current.email, phone: order.recipient_phone, address: `${order.delivery_city}, ${order.delivery_address}` },
        shipping: { name: order.recipient_name, phone: order.recipient_phone, city: order.delivery_city, address: order.delivery_address },
        items, payment: paymentRows.rows[0] ?? null,
      });
    } catch (error) { return next(error); }
  });

  app.get('/api/v1/admin/orders', async (request, response, next) => {
    try {
      const admin = await sessionUser(pool, cookieValue(request.headers.cookie, COOKIE));
      if (!admin) return response.status(401).json({ error: 'Требуется вход.' });
      if (admin.role !== 'admin') return response.status(403).json({ error: 'Недостаточно прав.' });
      const { rows } = await pool.query(
        `SELECT o.order_id, o.user_id, o.order_date, o.status, o.total_amount::float8 AS total_amount,
                o.recipient_name, o.recipient_phone, o.delivery_city, o.delivery_address,
                u.name AS customer_name, u.email AS customer_email, u.phone AS customer_phone, u.address AS customer_address,
                p.payment_id, p.payment_date, p.amount::float8 AS payment_amount, p.payment_method, p.status AS payment_status
         FROM orders o JOIN users u ON u.user_id=o.user_id LEFT JOIN payments p ON p.order_id=o.order_id
         ORDER BY o.order_date DESC, o.order_id DESC`,
      );
      if (!rows.length) return response.json({ orders: [] });
      const ids = rows.map((row) => row.order_id);
      const { rows: items } = await pool.query(
        `SELECT i.order_item_id, i.order_id, i.product_id, i.quantity, i.unit_price::float8 AS unit_price,
                p.name AS product_name, p.description AS product_description, p.stock_quantity, p.category_id
         FROM order_items i JOIN products p ON p.product_id=i.product_id
         WHERE i.order_id=ANY($1::int[]) ORDER BY i.order_item_id`, [ids],
      );
      const itemsByOrder = new Map<number, unknown[]>();
      for (const item of items) {
        const value = { ...item, product: { product_id: item.product_id, name: item.product_name, description: item.product_description, stock_quantity: item.stock_quantity, category_id: item.category_id } };
        itemsByOrder.set(item.order_id, [...(itemsByOrder.get(item.order_id) ?? []), value]);
      }
      return response.json({ orders: rows.map((row) => ({
        order: { order_id: row.order_id, user_id: row.user_id, order_date: row.order_date, status: row.status, total_amount: row.total_amount },
        user: { user_id: row.user_id, name: row.recipient_name ?? row.customer_name, email: row.customer_email, phone: row.recipient_phone ?? row.customer_phone, address: row.delivery_city ? `${row.delivery_city}, ${row.delivery_address}` : row.customer_address },
        payment: row.payment_id ? { payment_id: row.payment_id, order_id: row.order_id, payment_date: row.payment_date, amount: row.payment_amount, payment_method: row.payment_method, status: row.payment_status } : null,
        items: itemsByOrder.get(row.order_id) ?? [],
      })) });
    } catch (error) { return next(error); }
  });

  app.get('/api/v1/admin/products', async (request, response, next) => {
    try {
      const admin = await sessionUser(pool, cookieValue(request.headers.cookie, COOKIE));
      if (!admin) return response.status(401).json({ error: 'Требуется вход.' });
      if (admin.role !== 'admin') return response.status(403).json({ error: 'Недостаточно прав.' });
      const { rows } = await pool.query(
        `SELECT p.product_id, p.name, p.description, p.price::float8 AS price, p.stock_quantity, p.category_id
         FROM products p ORDER BY p.product_id`,
      );
      return response.json({ products: rows });
    } catch (error) { return next(error); }
  });

  app.post('/api/v1/admin/products', async (request, response, next) => {
    try {
      const admin = await sessionUser(pool, cookieValue(request.headers.cookie, COOKIE));
      if (!admin) return response.status(401).json({ error: 'Требуется вход.' });
      if (admin.role !== 'admin') return response.status(403).json({ error: 'Недостаточно прав.' });
      const product = validateProduct(request.body);
      if (!product) return response.status(400).json({ error: 'Проверьте название, описание, цену, остаток и категорию.' });
      const { rows } = await pool.query(
        `INSERT INTO products (name, description, price, stock_quantity, category_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING product_id, name, description, price::float8 AS price, stock_quantity, category_id`,
        [product.name, product.description, product.price.toFixed(2), product.stock_quantity, product.category_id],
      );
      return response.status(201).json({ product: rows[0] });
    } catch (error) {
      if ((error as { code?: string }).code === '23503') return response.status(400).json({ error: 'Выбранная категория не существует.' });
      return next(error);
    }
  });

  app.patch('/api/v1/admin/products/:productId', async (request, response, next) => {
    const productId = positiveInt(request.params.productId, 1, MAX_DATABASE_ID);
    if (productId === null) return response.status(400).json({ error: 'Invalid product id' });
    try {
      const admin = await sessionUser(pool, cookieValue(request.headers.cookie, COOKIE));
      if (!admin) return response.status(401).json({ error: 'Требуется вход.' });
      if (admin.role !== 'admin') return response.status(403).json({ error: 'Недостаточно прав.' });
      const product = validateProduct(request.body);
      if (!product) return response.status(400).json({ error: 'Проверьте название, описание, цену, остаток и категорию.' });
      const { rows } = await pool.query(
        `UPDATE products SET name=$1, description=$2, price=$3, stock_quantity=$4, category_id=$5
         WHERE product_id=$6
         RETURNING product_id, name, description, price::float8 AS price, stock_quantity, category_id`,
        [product.name, product.description, product.price.toFixed(2), product.stock_quantity, product.category_id, productId],
      );
      if (!rows[0]) return response.status(404).json({ error: 'Товар не найден.' });
      return response.json({ product: rows[0] });
    } catch (error) {
      if ((error as { code?: string }).code === '23503') return response.status(400).json({ error: 'Выбранная категория не существует.' });
      return next(error);
    }
  });

  app.delete('/api/v1/admin/products/:productId', async (request, response, next) => {
    const productId = positiveInt(request.params.productId, 1, MAX_DATABASE_ID);
    if (productId === null) return response.status(400).json({ error: 'Invalid product id' });
    try {
      const admin = await sessionUser(pool, cookieValue(request.headers.cookie, COOKIE));
      if (!admin) return response.status(401).json({ error: 'Требуется вход.' });
      if (admin.role !== 'admin') return response.status(403).json({ error: 'Недостаточно прав.' });
      const { rows } = await pool.query('DELETE FROM products WHERE product_id=$1 RETURNING product_id', [productId]);
      if (!rows[0]) return response.status(404).json({ error: 'Товар не найден.' });
      return response.status(204).end();
    } catch (error) {
      if ((error as { code?: string }).code === '23503') return response.status(409).json({ error: 'Нельзя удалить товар: на него ссылаются заказы или отзывы.' });
      return next(error);
    }
  });

  app.get('/api/health', async (_request, response, next) => {
    try {
      await checkDatabase(pool);
      response.status(200).json({ status: 'ok', database: 'connected' });
    } catch (error) {
      console.error('Database health check failed:', error instanceof Error ? error.message : 'Unknown error');
      response.status(503).json({ error: 'Service temporarily unavailable' });
    }
  });

  app.get('/api/v1/categories', (_request, response, next) => {
    void pool.query(
      `SELECT c.category_id, c.category_name, COUNT(p.product_id)::int AS count
       FROM categories c LEFT JOIN products p ON p.category_id = c.category_id
       GROUP BY c.category_id ORDER BY c.category_id`,
    ).then(({ rows }) => response.json(rows)).catch(next);
  });

  app.get('/api/v1/categories/:categoryId', async (request, response, next) => {
    const categoryId = positiveInt(request.params.categoryId, 1, MAX_DATABASE_ID);
    if (categoryId === null) return response.status(400).json({ error: 'Invalid category id' });
    try {
      const { rows } = await pool.query(
        `SELECT c.category_id, c.category_name, COUNT(p.product_id)::int AS count
         FROM categories c LEFT JOIN products p ON p.category_id = c.category_id
         WHERE c.category_id = $1 GROUP BY c.category_id`, [categoryId],
      );
      if (!rows[0]) return response.status(404).json({ error: 'Category not found' });
      return response.json(rows[0]);
    } catch (error) { return sendDatabaseError(error, next); }
  });

  app.get('/api/v1/categories/:categoryId/products', async (request, response, next) => {
    const categoryId = positiveInt(request.params.categoryId, 1, MAX_DATABASE_ID);
    if (categoryId === null) return response.status(400).json({ error: 'Invalid category id' });
    request.query.categoryId = String(categoryId);
    return listProducts(request, response, next, pool);
  });

  app.get('/api/v1/products', (request, response, next) => listProducts(request, response, next, pool));

  app.get('/api/v1/products/:productId', async (request, response, next) => {
    const productId = positiveInt(request.params.productId, 1, MAX_DATABASE_ID);
    if (productId === null) return response.status(400).json({ error: 'Invalid product id' });
    try {
      const { rows } = await pool.query(
        `SELECT p.product_id, p.name, p.description, p.price::float8 AS price, p.stock_quantity, p.category_id,
                COALESCE(AVG(r.rating), 0)::float AS rating, COUNT(r.review_id)::int AS reviews
         FROM products p LEFT JOIN reviews r ON r.product_id = p.product_id
         WHERE p.product_id = $1
         GROUP BY p.product_id`, [productId],
      );
      if (!rows[0]) return response.status(404).json({ error: 'Product not found' });
      return response.json(rows[0]);
    } catch (error) { return sendDatabaseError(error, next); }
  });

  app.use((_request, response) => {
    response.status(404).json({ error: 'Not found' });
  });

  const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
    // Do not expose connection strings, SQL, or driver details to clients.
    if (error instanceof ApiError) return response.status(error.status).json({ error: error.message });
    if ((error as { code?: string }).code === '23503') return response.status(404).json({ error: 'Связанный товар не найден.' });
    console.error('Backend request failed:', error instanceof Error ? error.message : 'Unknown error');
    return response.status(500).json({ error: 'Internal server error' });
  };
  app.use(errorHandler);
  return app;
}

async function issueSession(pool: Pool, user: UserRow, response: express.Response, secure: boolean) {
  const token = randomBytes(32).toString('base64url');
  await pool.query('INSERT INTO user_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL \'14 days\')', [user.user_id, tokenHash(token)]);
  response.setHeader('Set-Cookie', `${COOKIE}=${token}; ${cookieOptions(secure)}`);
}

async function sessionUser(pool: Pool, token: string | undefined): Promise<UserRow | null> {
  if (!token || !/^[A-Za-z\d_-]{40,50}$/.test(token)) return null;
  const { rows } = await pool.query<UserRow>(
    `SELECT u.user_id, u.name, u.email, u.phone, u.address, u.role
     FROM user_sessions s JOIN users u ON u.user_id=s.user_id
     WHERE s.token_hash=$1 AND s.expires_at > NOW()`, [tokenHash(token)],
  );
  return rows[0] ?? null;
}

async function listProducts(
  request: express.Request,
  response: express.Response,
  next: express.NextFunction,
  pool: Pool,
) {
  const page = positiveInt(request.query.page, 1, 1_000_000);
  const pageSize = positiveInt(request.query.pageSize, 20, 100);
  const categoryId = positiveInt(request.query.categoryId, 1, MAX_DATABASE_ID);
  const q = request.query.q;
  const sortBy = request.query.sortBy ?? 'id';
  const sortOrder = request.query.sortOrder ?? 'asc';
  if (page === null || pageSize === null || (request.query.categoryId !== undefined && categoryId === null)) {
    return response.status(400).json({ error: 'Invalid pagination or category parameter' });
  }
  if (q !== undefined && (typeof q !== 'string' || q.length > 200)) {
    return response.status(400).json({ error: 'q must be a string of at most 200 characters' });
  }
  if (typeof sortBy !== 'string' || !['id', 'price', 'name'].includes(sortBy)) {
    return response.status(400).json({ error: 'sortBy must be id, price, or name' });
  }
  if (typeof sortOrder !== 'string' || !['asc', 'desc'].includes(sortOrder)) {
    return response.status(400).json({ error: 'sortOrder must be asc or desc' });
  }

  const conditions: string[] = [];
  const values: unknown[] = [];
  if (request.query.categoryId !== undefined) {
    values.push(categoryId);
    conditions.push(`p.category_id = $${values.length}`);
  }
  if (q) {
    values.push(`%${q}%`);
    conditions.push(`(p.name ILIKE $${values.length} OR COALESCE(p.description, '') ILIKE $${values.length})`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const column = sortBy === 'id' ? 'p.product_id' : SORT_COLUMNS[sortBy as SortField];
  const direction = (sortOrder as SortDirection).toUpperCase();
  const offset = (page - 1) * pageSize;
  try {
    const countValues = [...values];
    const [countResult, productsResult] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total FROM products p ${where}`, countValues),
      pool.query(
        `SELECT p.product_id, p.name, p.description, p.price::float8 AS price, p.stock_quantity, p.category_id,
                COALESCE(AVG(r.rating), 0)::float AS rating, COUNT(r.review_id)::int AS reviews
         FROM products p LEFT JOIN reviews r ON r.product_id = p.product_id ${where}
         GROUP BY p.product_id ORDER BY ${column} ${direction}, p.product_id ASC
         LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, pageSize, offset],
      ),
    ]);
    return response.json({
      items: productsResult.rows,
      page,
      pageSize,
      total: countResult.rows[0].total,
      totalPages: Math.ceil(countResult.rows[0].total / pageSize),
    });
  } catch (error) { return sendDatabaseError(error, next); }
}
