import express, { type ErrorRequestHandler } from 'express';
import type { Pool, PoolClient } from 'pg';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { basename, dirname, join } from 'node:path';
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { checkDatabase, checkDatabaseReadiness } from './db.js';
import { insertAuditLog, publishAuditLog, type AuditEventInput, type AuditPublisher } from './audit.js';
import { ANOMALY_TYPES, type AnomalyIncident, type IncidentStatus, type IncidentSeverity } from './anomalies.js';
import { createStatisticalAnomalySnapshot } from './jeffreysContract.js';
import { isSyntheticReplenishmentReport } from './replenishmentDemo.js';

const scrypt = promisify(scryptCallback);
export const SESSION_COOKIE_NAME = 'marketkz_session';
const ALLOWED_FRONTEND_ORIGINS = new Set([
  'https://ssultankorkmazov-sys.github.io',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);
export function isAllowedFrontendOrigin(origin: string | undefined, allowLocalOrigins = true): origin is string {
  return origin === 'https://ssultankorkmazov-sys.github.io' ||
    (allowLocalOrigins && origin !== undefined && ALLOWED_FRONTEND_ORIGINS.has(origin));
}
type UserRow = { user_id: number; name: string; email: string; phone: string; address: string | null; role: 'user' | 'admin' };
export type SessionUser = UserRow;
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
const cookieOptions = (secure: boolean, maxAge = 60 * 60 * 24 * 14) => `Path=/; HttpOnly; SameSite=${secure ? 'None' : 'Lax'}; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
function cookieValue(header: string | undefined, name: string) {
  return header?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}
class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
type CheckoutLine = { product_id: number; quantity: number };
const PAYMENT_METHODS: Record<string, string> = { card: 'Bank Card', kaspi: 'Kaspi Pay', cash: 'Cash on delivery' };
const ORDER_STATUSES = new Set(['Processing', 'Shipped', 'Delivered', 'Cancelled']);
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

function validateCategoryName(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const name = input.trim();
  return name.length > 0 && name.length <= 100 ? name : null;
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

function positiveBigIntId(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{1,19}$/.test(value)) return null;
  const parsed = BigInt(value);
  return parsed > 0n && parsed <= 9_223_372_036_854_775_807n ? parsed.toString() : null;
}

function sendDatabaseError(error: unknown, next: (error?: unknown) => void) {
  next(error);
}

const appModuleDirectory = dirname(fileURLToPath(import.meta.url));
const SYNTHETIC_REPLENISHMENT_REPORT_PATH = basename(appModuleDirectory) === 'src'
  ? fileURLToPath(new URL('../../ml/sales_prediction/reports/phase3ab-synthetic-replenishment.json', import.meta.url))
  : join(appModuleDirectory, 'demo', 'phase3ab-synthetic-replenishment.json');

export function createApp(pool: Pool, options: { secureCookies?: boolean; allowLocalOrigins?: boolean; auditPublisher?: AuditPublisher; jeffreysDetectorEnabled?: boolean; jeffreysShadowModeEnabled?: boolean; replenishmentDemoReportPath?: string } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use((request, response, next) => {
    const origin = request.get('Origin');
    const allowedOrigin = isAllowedFrontendOrigin(origin, options.allowLocalOrigins ?? true);
    response.vary('Origin');
    if (allowedOrigin) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Access-Control-Allow-Credentials', 'true');
    } else if (origin) {
      return response.status(403).json({ error: 'Origin not allowed.' });
    }

    if (request.method === 'OPTIONS') {
      if (allowedOrigin) {
        response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
        response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      }
      return response.status(204).end();
    }
    return next();
  });
  app.use(express.json({ limit: '100kb' }));

  const requireAdmin = async (request: express.Request, response: express.Response): Promise<UserRow | null> => {
    const user = await sessionUserFromToken(pool, cookieValue(request.headers.cookie, SESSION_COOKIE_NAME));
    if (!user) {
      response.status(401).json({ error: 'Требуется вход.' });
      return null;
    }
    if (user.role !== 'admin') {
      response.status(403).json({ error: 'Недостаточно прав.' });
      return null;
    }
    return user;
  };

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
      await auditBestEffort(pool, { userId: rows[0].user_id, action: 'USER_REGISTERED', entityType: 'user', entityId: rows[0].user_id, status: 'SUCCESS' }, request.ip, options.auditPublisher);
      return response.status(201).json({ user: publicUser(rows[0]) });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') return response.status(409).json({ error: 'Пользователь с таким email или телефоном уже существует.' });
      return next(error);
    }
  });

  app.post('/api/v1/auth/login', async (request, response, next) => {
    const { email, password } = request.body ?? {};
    if (!validEmail(email) || typeof password !== 'string' || password.length > 200) {
      await auditBestEffort(pool, { action: 'LOGIN_FAILED', status: 'FAILURE', details: { reason: 'invalid_input' } }, request.ip, options.auditPublisher);
      return response.status(400).json({ error: 'Неверный email или пароль.' });
    }
    try {
      const { rows } = await pool.query<UserRow & { password_hash: string | null }>(
        'SELECT user_id, name, email, phone, address, role, password_hash FROM users WHERE lower(email) = lower($1)', [email.trim()],
      );
      if (!rows[0]?.password_hash || !(await verifyPassword(password, rows[0].password_hash))) {
        await auditBestEffort(pool, { userId: rows[0]?.user_id ?? null, action: 'LOGIN_FAILED', entityType: 'user', entityId: rows[0]?.user_id ?? null, status: 'FAILURE', details: { reason: 'invalid_credentials' } }, request.ip, options.auditPublisher);
        return response.status(401).json({ error: 'Неверный email или пароль.' });
      }
      await issueSession(pool, rows[0], response, options.secureCookies ?? false);
      await auditBestEffort(pool, { userId: rows[0].user_id, action: 'LOGIN_SUCCESS', entityType: 'user', entityId: rows[0].user_id, status: 'SUCCESS' }, request.ip, options.auditPublisher);
      return response.json({ user: publicUser(rows[0]) });
    } catch (error) { return next(error); }
  });

  app.get('/api/v1/auth/me', async (request, response, next) => {
    try {
      const user = await sessionUserFromToken(pool, cookieValue(request.headers.cookie, SESSION_COOKIE_NAME));
      return user ? response.json({ user: publicUser(user) }) : response.status(401).json({ error: 'Требуется вход.' });
    } catch (error) { return next(error); }
  });

  app.post('/api/v1/auth/logout', async (request, response, next) => {
    try {
      const token = cookieValue(request.headers.cookie, SESSION_COOKIE_NAME);
      const user = await sessionUserFromToken(pool, token);
      if (token) await pool.query('DELETE FROM user_sessions WHERE token_hash = $1', [tokenHash(token)]);
      if (user) await auditBestEffort(pool, { userId: user.user_id, action: 'LOGOUT', entityType: 'user', entityId: user.user_id, status: 'SUCCESS' }, request.ip, options.auditPublisher);
      response.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=; ${cookieOptions(options.secureCookies ?? false, 0)}`);
      return response.status(204).end();
    } catch (error) { return next(error); }
  });

  app.patch('/api/v1/profile', async (request, response, next) => {
    try {
      const current = await sessionUserFromToken(pool, cookieValue(request.headers.cookie, SESSION_COOKIE_NAME));
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
    let orderUserId: number | null = null;
    let pendingAudit: Awaited<ReturnType<typeof insertAuditLog>> | null = null;
    try {
      const current = await sessionUserFromToken(pool, cookieValue(request.headers.cookie, SESSION_COOKIE_NAME));
      if (!current) return response.status(401).json({ error: 'Требуется вход.' });
      if (current.role !== 'user') return response.status(403).json({ error: 'Оформление заказа доступно только покупателям.' });
      orderUserId = current.user_id;
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
      pendingAudit = await insertAuditLog(client, {
        userId: current.user_id, action: 'ORDER_CREATED', entityType: 'order', entityId: order.order_id,
        status: 'SUCCESS', details: { item_count: sortedItems.length }, ipAddress: request.ip,
      });
      await client.query('COMMIT');
      transactionOpen = false;
      publishAuditLog(options.auditPublisher, pendingAudit);
      return response.status(201).json({ order: { ...order, total_amount: Number(order.total_amount) } });
    } catch (error) {
      if (client && transactionOpen) await client.query('ROLLBACK').catch(() => undefined);
      if (orderUserId !== null) await auditBestEffort(pool, {
        userId: orderUserId, action: 'ORDER_CREATE_FAILED', entityType: 'order', status: 'FAILURE',
        details: { reason: error instanceof ApiError ? `http_${error.status}` : 'request_failed' },
      }, request.ip, options.auditPublisher);
      return next(error);
    } finally { client?.release(); }
  });

  app.get('/api/v1/orders', async (request, response, next) => {
    try {
      const current = await sessionUserFromToken(pool, cookieValue(request.headers.cookie, SESSION_COOKIE_NAME));
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
      const current = await sessionUserFromToken(pool, cookieValue(request.headers.cookie, SESSION_COOKIE_NAME));
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

  app.get('/api/v1/admin/logs', async (request, response, next) => {
    try {
      const admin = await sessionUserFromToken(pool, cookieValue(request.headers.cookie, SESSION_COOKIE_NAME));
      if (!admin) {
        await auditBestEffort(pool, { action: 'ADMIN_LOGS_ACCESS_DENIED', status: 'FAILURE', details: { reason: 'unauthenticated' } }, request.ip, options.auditPublisher);
        return response.status(401).json({ error: 'Требуется вход.' });
      }
      if (admin.role !== 'admin') {
        await auditBestEffort(pool, { userId: admin.user_id, action: 'ADMIN_LOGS_ACCESS_DENIED', status: 'FAILURE', details: { reason: 'insufficient_role' } }, request.ip, options.auditPublisher);
        return response.status(403).json({ error: 'Недостаточно прав.' });
      }

      const allowedQueryKeys = new Set(['page', 'pageSize', 'action', 'status', 'userId', 'from', 'to', 'q']);
      if (Object.keys(request.query).some((key) => !allowedQueryKeys.has(key)) ||
          ['action', 'status', 'userId', 'from', 'to', 'q'].some((key) => request.query[key] !== undefined && typeof request.query[key] !== 'string')) {
        return response.status(400).json({ error: 'Некорректные параметры фильтра или пагинации.' });
      }
      const page = positiveInt(request.query.page, 1, 1_000_000);
      const pageSize = positiveInt(request.query.pageSize, 25, 100);
      const action = typeof request.query.action === 'string' ? request.query.action : undefined;
      const status = typeof request.query.status === 'string' ? request.query.status : undefined;
      const rawUserId = typeof request.query.userId === 'string' ? request.query.userId : undefined;
      const userId = rawUserId === undefined ? undefined : positiveInt(rawUserId, 1, MAX_DATABASE_ID);
      const from = typeof request.query.from === 'string' ? request.query.from : undefined;
      const to = typeof request.query.to === 'string' ? request.query.to : undefined;
      const q = typeof request.query.q === 'string' ? request.query.q.trim() : undefined;
      const validDate = (value: string | undefined) => {
        if (value === undefined) return true;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
        const date = new Date(`${value}T00:00:00Z`);
        return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
      };
      if (page === null || pageSize === null || (rawUserId !== undefined && userId === null) ||
          (action !== undefined && !/^[A-Z][A-Z0-9_]{0,63}$/.test(action)) ||
          (status !== undefined && status !== 'SUCCESS' && status !== 'FAILURE') ||
          !validDate(from) || !validDate(to) || (from && to && from > to) ||
          (request.query.q !== undefined && (q === undefined || q.length > 80))) {
        return response.status(400).json({ error: 'Некорректные параметры фильтра или пагинации.' });
      }

      const values: unknown[] = [];
      const filters: string[] = [];
      const add = (value: unknown, sql: (placeholder: string) => string) => {
        values.push(value);
        filters.push(sql(`$${values.length}`));
      };
      if (action !== undefined) add(action, (p) => `action = ${p}`);
      if (status !== undefined) add(status, (p) => `status = ${p}`);
      if (userId !== undefined) add(userId, (p) => `user_id = ${p}`);
      if (from !== undefined) add(from, (p) => `created_at >= ${p}::date`);
      if (to !== undefined) add(to, (p) => `created_at < (${p}::date + INTERVAL '1 day')`);
      if (q) {
        values.push(`%${q}%`);
        const p = `$${values.length}`;
        filters.push(`(action ILIKE ${p} OR COALESCE(entity_type, '') ILIKE ${p} OR COALESCE(user_id::text, '') ILIKE ${p} OR COALESCE(entity_id::text, '') ILIKE ${p})`);
      }
      const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
      const [counts, logs] = await Promise.all([
        pool.query(`SELECT COUNT(*)::int AS total,
                           COUNT(*) FILTER (WHERE status='SUCCESS')::int AS successful,
                           COUNT(*) FILTER (WHERE status='FAILURE')::int AS failed
                    FROM audit_logs ${where}`, values),
        pool.query(
          `SELECT log_id::text AS log_id, user_id, action, entity_type, entity_id, status, details,
                  ip_address::text AS ip_address, created_at
           FROM audit_logs ${where} ORDER BY created_at DESC, log_id DESC
           LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
          [...values, pageSize, (page - 1) * pageSize],
        ),
      ]);
      const stats = counts.rows[0] ?? { total: 0, successful: 0, failed: 0 };
      return response.json({ logs: logs.rows, page, pageSize, ...stats, totalPages: Math.ceil(stats.total / pageSize) });
    } catch (error) { return next(error); }
  });

  app.get('/api/v1/admin/logs/:logId', async (request, response, next) => {
    const logId = positiveBigIntId(request.params.logId);
    if (logId === null) return response.status(400).json({ error: 'Некорректный ID записи.' });
    try {
      const admin = await sessionUserFromToken(pool, cookieValue(request.headers.cookie, SESSION_COOKIE_NAME));
      if (!admin) {
        await auditBestEffort(pool, { action: 'ADMIN_LOGS_ACCESS_DENIED', status: 'FAILURE', details: { reason: 'unauthenticated' } }, request.ip, options.auditPublisher);
        return response.status(401).json({ error: 'Требуется вход.' });
      }
      if (admin.role !== 'admin') {
        await auditBestEffort(pool, { userId: admin.user_id, action: 'ADMIN_LOGS_ACCESS_DENIED', status: 'FAILURE', details: { reason: 'insufficient_role' } }, request.ip, options.auditPublisher);
        return response.status(403).json({ error: 'Недостаточно прав.' });
      }
      const { rows } = await pool.query(
        `SELECT log_id::text AS log_id, user_id, action, entity_type, entity_id, status, details,
                ip_address::text AS ip_address, created_at
         FROM audit_logs WHERE log_id=$1`, [logId],
      );
      return rows[0] ? response.json({ log: rows[0] }) : response.status(404).json({ error: 'Запись не найдена.' });
    } catch (error) { return next(error); }
  });

  app.get('/api/v1/admin/anomalies', async (request, response, next) => {
    try {
      const admin = await sessionUserFromToken(pool, cookieValue(request.headers.cookie, SESSION_COOKIE_NAME));
      if (!admin) {
        await auditBestEffort(pool, { action: 'ADMIN_ANOMALIES_ACCESS_DENIED', status: 'FAILURE', details: { reason: 'unauthenticated' } }, request.ip, options.auditPublisher);
        return response.status(401).json({ error: 'Требуется вход.' });
      }
      if (admin.role !== 'admin') {
        await auditBestEffort(pool, { userId: admin.user_id, action: 'ADMIN_ANOMALIES_ACCESS_DENIED', status: 'FAILURE', details: { reason: 'insufficient_role' } }, request.ip, options.auditPublisher);
        return response.status(403).json({ error: 'Недостаточно прав.' });
      }

      const allowed = new Set(['page', 'pageSize', 'severity', 'type', 'status', 'from', 'to']);
      if (Object.keys(request.query).some((key) => !allowed.has(key)) ||
          ['severity', 'type', 'status', 'from', 'to'].some((key) => request.query[key] !== undefined && typeof request.query[key] !== 'string')) {
        return response.status(400).json({ error: 'Некорректные параметры фильтра или пагинации.' });
      }
      const page = positiveInt(request.query.page, 1, 1_000_000);
      const pageSize = positiveInt(request.query.pageSize, 25, 100);
      const severity = request.query.severity as IncidentSeverity | undefined;
      const type = request.query.type as string | undefined;
      const status = request.query.status as IncidentStatus | undefined;
      const from = request.query.from as string | undefined;
      const to = request.query.to as string | undefined;
      const validDate = (value: string | undefined) => {
        if (value === undefined) return true;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
        const date = new Date(`${value}T00:00:00Z`);
        return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
      };
      if (page === null || pageSize === null ||
          (severity !== undefined && !['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(severity)) ||
          (type !== undefined && !ANOMALY_TYPES.includes(type as typeof ANOMALY_TYPES[number])) ||
          (status !== undefined && !['NEW', 'INVESTIGATING', 'RESOLVED', 'FALSE_POSITIVE'].includes(status)) ||
          !validDate(from) || !validDate(to) || (from && to && from > to)) {
        return response.status(400).json({ error: 'Некорректные параметры фильтра или пагинации.' });
      }

      const values: unknown[] = [];
      const filters: string[] = [];
      const add = (value: unknown, expression: (placeholder: string) => string) => {
        values.push(value);
        filters.push(expression(`$${values.length}`));
      };
      if (severity) add(severity, (p) => `severity=${p}`);
      if (type) add(type, (p) => `anomaly_type=${p}`);
      if (status) add(status, (p) => `status=${p}`);
      if (from) add(from, (p) => `detected_at >= ${p}::date`);
      if (to) add(to, (p) => `detected_at < (${p}::date + INTERVAL '1 day')`);
      const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
      const [summary, incidents] = await Promise.all([
        pool.query(`SELECT COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE severity='LOW')::int AS low,
          COUNT(*) FILTER (WHERE severity='MEDIUM')::int AS medium,
          COUNT(*) FILTER (WHERE severity='HIGH')::int AS high,
          COUNT(*) FILTER (WHERE severity='CRITICAL')::int AS critical
          FROM public.anomaly_incidents ${where}`, values),
        pool.query(
          `SELECT incident.incident_id::text AS incident_id, incident.anomaly_type, incident.subject_user_id,
            incident.severity, incident.risk_score, incident.status, incident.detected_at, incident.updated_at,
            incident.first_event_at, incident.last_event_at, incident.evidence, incident.explanation,
            incident.recommendations, incident.deduplication_key,
            COALESCE(events.audit_log_ids, '[]'::jsonb) AS audit_log_ids
           FROM public.anomaly_incidents incident
           LEFT JOIN LATERAL (
             SELECT jsonb_agg(link.log_id::text ORDER BY link.log_id) AS audit_log_ids
             FROM public.anomaly_incident_events link WHERE link.incident_id=incident.incident_id
           ) events ON TRUE
           ${where ? `WHERE ${where.slice(6).replaceAll('severity=', 'incident.severity=').replaceAll('anomaly_type=', 'incident.anomaly_type=').replaceAll('status=', 'incident.status=').replaceAll('detected_at', 'incident.detected_at')}` : ''}
           ORDER BY incident.detected_at DESC, incident.incident_id DESC
           LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
          [...values, pageSize, (page - 1) * pageSize],
        ),
      ]);
      return response.json({ incidents: incidents.rows, page, pageSize, ...(summary.rows[0] ?? { total: 0, low: 0, medium: 0, high: 0, critical: 0 }), totalPages: Math.ceil((summary.rows[0]?.total ?? 0) / pageSize) });
    } catch (error) { return next(error); }
  });

  app.get('/api/v1/admin/anomalies/queue-stats', async (request, response, next) => {
    try {
      const admin = await sessionUserFromToken(pool, cookieValue(request.headers.cookie, SESSION_COOKIE_NAME));
      if (!admin) {
        await auditBestEffort(pool, { action: 'ADMIN_ANOMALIES_ACCESS_DENIED', status: 'FAILURE', details: { reason: 'unauthenticated' } }, request.ip, options.auditPublisher);
        return response.status(401).json({ error: 'Требуется вход.' });
      }
      if (admin.role !== 'admin') {
        await auditBestEffort(pool, { userId: admin.user_id, action: 'ADMIN_ANOMALIES_ACCESS_DENIED', status: 'FAILURE', details: { reason: 'insufficient_role' } }, request.ip, options.auditPublisher);
        return response.status(403).json({ error: 'Недостаточно прав.' });
      }

      const { rows } = await pool.query<{
        pending: number; processed: number; dead_letter: number; processing_errors: number; last_processed_at: string | null;
      }>(
        `SELECT
           COUNT(*) FILTER (WHERE processed_at IS NULL AND dead_lettered_at IS NULL)::int AS pending,
           COUNT(*) FILTER (WHERE processed_at IS NOT NULL)::int AS processed,
           COUNT(*) FILTER (WHERE dead_lettered_at IS NOT NULL)::int AS dead_letter,
           COALESCE(SUM(attempts), 0)::int AS processing_errors,
           MAX(processed_at)::text AS last_processed_at
         FROM public.anomaly_event_queue`,
      );
      return response.json(rows[0] ?? { pending: 0, processed: 0, dead_letter: 0, processing_errors: 0, last_processed_at: null });
    } catch (error) { return next(error); }
  });

  app.get('/api/v1/admin/anomalies/statistical-status', async (request, response, next) => {
    try {
      if (!await requireAdmin(request, response)) return;
      return response.json(createStatisticalAnomalySnapshot(options.jeffreysDetectorEnabled ?? false));
    } catch (error) { return next(error); }
  });

  app.get('/api/v1/admin/anomalies/shadow/status', async (request, response, next) => {
    try {
      if (!await requireAdmin(request, response)) return;
      const storage = await pool.query<{ checkpoint: string | null; evaluations: string | null; incidents: string | null }>(
        `SELECT to_regclass('public.jeffreys_shadow_checkpoint')::text AS checkpoint,
                to_regclass('public.jeffreys_shadow_evaluations')::text AS evaluations,
                to_regclass('public.anomaly_incidents')::text AS incidents`,
      );
      if (!storage.rows[0]?.checkpoint || !storage.rows[0]?.evaluations || !storage.rows[0]?.incidents) {
        return response.status(503).json({ error: 'Shadow Mode storage is unavailable.' });
      }
      const { rows } = await pool.query<{
        profile_version: string | null; latest_evaluation_at: string | null;
        sufficient_data: number; insufficient_data: number; work_limit_exceeded: number; evaluation_error: number;
      }>(
        `SELECT
           (SELECT profile_version FROM public.jeffreys_shadow_evaluations
            ORDER BY evaluated_at DESC, evaluation_id DESC LIMIT 1) AS profile_version,
           (SELECT evaluated_at::text FROM public.jeffreys_shadow_evaluations
            ORDER BY evaluated_at DESC, evaluation_id DESC LIMIT 1) AS latest_evaluation_at,
           COUNT(*) FILTER (WHERE evaluation_status='SUFFICIENT_DATA')::int AS sufficient_data,
           COUNT(*) FILTER (WHERE evaluation_status='INSUFFICIENT_DATA')::int AS insufficient_data,
           COUNT(*) FILTER (WHERE evaluation_status='WORK_LIMIT_EXCEEDED')::int AS work_limit_exceeded,
           COUNT(*) FILTER (WHERE evaluation_status='EVALUATION_ERROR')::int AS evaluation_error
         FROM public.jeffreys_shadow_evaluations`,
      );
      const status = rows[0];
      return response.json({
        experimental: true,
        operational: false,
        enabled: options.jeffreysShadowModeEnabled ?? false,
        storage_available: true,
        profile_version: status?.profile_version ?? null,
        latest_evaluation_at: status?.latest_evaluation_at ?? null,
        evaluation_counts: {
          SUFFICIENT_DATA: status?.sufficient_data ?? 0,
          INSUFFICIENT_DATA: status?.insufficient_data ?? 0,
          WORK_LIMIT_EXCEEDED: status?.work_limit_exceeded ?? 0,
          EVALUATION_ERROR: status?.evaluation_error ?? 0,
        },
      });
    } catch (error) {
      if ((error as { code?: string })?.code === '42P01') return response.status(503).json({ error: 'Shadow Mode storage is unavailable.' });
      return next(error);
    }
  });

  app.get('/api/v1/admin/anomalies/shadow/evaluations', async (request, response, next) => {
    try {
      if (!await requireAdmin(request, response)) return;
      const query = request.query as Record<string, unknown>;
      const allowed = new Set(['page', 'pageSize', 'profile', 'userId', 'status', 'from', 'to']);
      if (Object.keys(query).some((key) => !allowed.has(key)) ||
          Object.keys(query).some((key) => query[key] !== undefined && typeof query[key] !== 'string')) {
        return response.status(400).json({ error: 'Некорректные параметры фильтра или пагинации.' });
      }
      const page = positiveInt(query.page, 1, 1_000_000);
      const pageSize = positiveInt(query.pageSize, 20, 100);
      const profile = query.profile as string | undefined;
      const userId = positiveInt(query.userId, 1, MAX_DATABASE_ID);
      const status = query.status as string | undefined;
      const from = query.from as string | undefined;
      const to = query.to as string | undefined;
      const validDate = (value: string | undefined) => {
        if (value === undefined) return true;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
        const date = new Date(`${value}T00:00:00Z`);
        return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
      };
      const statuses = ['SUFFICIENT_DATA', 'INSUFFICIENT_DATA', 'WORK_LIMIT_EXCEEDED', 'EVALUATION_ERROR'];
      if (page === null || pageSize === null || userId === null ||
          (profile !== undefined && !/^[A-Za-z0-9._-]{1,64}$/.test(profile)) ||
          (status !== undefined && !statuses.includes(status)) ||
          !validDate(from) || !validDate(to) || (from && to && from > to)) {
        return response.status(400).json({ error: 'Некорректные параметры фильтра или пагинации.' });
      }

      const storage = await pool.query<{ evaluations: string | null; incidents: string | null }>(
        `SELECT to_regclass('public.jeffreys_shadow_evaluations')::text AS evaluations,
                to_regclass('public.anomaly_incidents')::text AS incidents`,
      );
      if (!storage.rows[0]?.evaluations || !storage.rows[0]?.incidents) {
        return response.status(503).json({ error: 'Shadow Mode storage is unavailable.' });
      }

      const values: unknown[] = [];
      const filters: string[] = [];
      const add = (value: unknown, expression: (placeholder: string) => string) => {
        values.push(value);
        filters.push(expression(`$${values.length}`));
      };
      if (profile) add(profile, (p) => `evaluation.profile_version=${p}`);
      if (query.userId !== undefined) add(userId, (p) => `evaluation.subject_user_id=${p}`);
      if (status) add(status, (p) => `evaluation.evaluation_status=${p}`);
      if (from) add(from, (p) => `evaluation.evaluated_at >= ${p}::date`);
      if (to) add(to, (p) => `evaluation.evaluated_at < (${p}::date + INTERVAL '1 day')`);
      const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
      const [count, pageRows] = await Promise.all([
        pool.query<{ total: number }>(`SELECT COUNT(*)::int AS total FROM public.jeffreys_shadow_evaluations evaluation ${where}`, values),
        pool.query(
          `SELECT evaluation.evaluation_id::text AS evaluation_id, evaluation.profile_version,
             evaluation.subject_user_id, evaluation.evaluated_at, evaluation.baseline_start_at,
             evaluation.baseline_end_at, evaluation.current_start_at, evaluation.current_end_at,
             evaluation.baseline_observations, evaluation.current_observations,
             evaluation.baseline_distribution, evaluation.current_distribution, evaluation.divergence,
             evaluation.category_contributions, evaluation.evaluation_status, evaluation.sample_counts_capped,
             evaluation.recorded_at,
             COALESCE(correlations.incidents, '[]'::jsonb) AS matching_incidents
           FROM public.jeffreys_shadow_evaluations evaluation
           LEFT JOIN LATERAL (
             SELECT jsonb_agg(jsonb_build_object(
               'incident_id', incident.incident_id::text,
               'anomaly_type', incident.anomaly_type,
               'status', incident.status,
               'severity', incident.severity,
               'detected_at', incident.detected_at,
               'correlation_basis', 'SAME_USER_AND_OVERLAPPING_EVENT_TIME'
             ) ORDER BY incident.detected_at DESC, incident.incident_id DESC) AS incidents
             FROM public.anomaly_incidents incident
             WHERE incident.subject_user_id=evaluation.subject_user_id
               AND incident.first_event_at < evaluation.current_end_at
               AND incident.last_event_at >= evaluation.current_start_at
           ) correlations ON TRUE
           ${where}
           ORDER BY evaluation.evaluated_at DESC, evaluation.evaluation_id DESC
           LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
          [...values, pageSize, (page - 1) * pageSize],
        ),
      ]);
      const total = count.rows[0]?.total ?? 0;
      return response.json({ evaluations: pageRows.rows, page, pageSize, total, totalPages: Math.ceil(total / pageSize) });
    } catch (error) {
      if ((error as { code?: string })?.code === '42P01') return response.status(503).json({ error: 'Shadow Mode storage is unavailable.' });
      return next(error);
    }
  });

  app.get('/api/v1/admin/anomalies/:incidentId', async (request, response, next) => {
    const incidentId = positiveBigIntId(request.params.incidentId);
    if (incidentId === null) return response.status(400).json({ error: 'Некорректный ID инцидента.' });
    try {
      const admin = await sessionUserFromToken(pool, cookieValue(request.headers.cookie, SESSION_COOKIE_NAME));
      if (!admin) {
        await auditBestEffort(pool, { action: 'ADMIN_ANOMALIES_ACCESS_DENIED', status: 'FAILURE', details: { reason: 'unauthenticated' } }, request.ip, options.auditPublisher);
        return response.status(401).json({ error: 'Требуется вход.' });
      }
      if (admin.role !== 'admin') {
        await auditBestEffort(pool, { userId: admin.user_id, action: 'ADMIN_ANOMALIES_ACCESS_DENIED', status: 'FAILURE', details: { reason: 'insufficient_role' } }, request.ip, options.auditPublisher);
        return response.status(403).json({ error: 'Недостаточно прав.' });
      }
      const { rows } = await pool.query(
        `SELECT incident.incident_id::text AS incident_id, incident.anomaly_type, incident.subject_user_id,
          incident.severity, incident.risk_score, incident.status, incident.detected_at, incident.updated_at,
          incident.first_event_at, incident.last_event_at, incident.evidence, incident.explanation,
          incident.recommendations, incident.deduplication_key,
          COALESCE(events.audit_log_ids, '[]'::jsonb) AS audit_log_ids,
          COALESCE(timeline.events, '[]'::jsonb) AS timeline
         FROM public.anomaly_incidents incident
         LEFT JOIN LATERAL (
           SELECT jsonb_agg(link.log_id::text ORDER BY link.log_id) AS audit_log_ids
           FROM public.anomaly_incident_events link WHERE link.incident_id=incident.incident_id
         ) events ON TRUE
         LEFT JOIN LATERAL (
           SELECT jsonb_agg(jsonb_build_object(
             'log_id', log.log_id::text,
             'created_at', log.created_at,
             'action', log.action,
             'status', log.status,
             'entity_type', log.entity_type,
             'entity_id', log.entity_id
           ) ORDER BY log.created_at, log.log_id) AS events
           FROM public.anomaly_incident_events link
           JOIN public.audit_logs log ON log.log_id=link.log_id
           WHERE link.incident_id=incident.incident_id
         ) timeline ON TRUE WHERE incident.incident_id=$1`, [incidentId],
      );
      return rows[0] ? response.json({ incident: rows[0] }) : response.status(404).json({ error: 'Инцидент не найден.' });
    } catch (error) { return next(error); }
  });

  app.patch('/api/v1/admin/anomalies/:incidentId/status', async (request, response, next) => {
    const incidentId = positiveBigIntId(request.params.incidentId);
    if (incidentId === null) return response.status(400).json({ error: 'Некорректный ID инцидента.' });
    const target = request.body?.status as IncidentStatus | undefined;
    if (!['INVESTIGATING', 'RESOLVED', 'FALSE_POSITIVE'].includes(target ?? '')) {
      return response.status(400).json({ error: 'Недопустимый статус инцидента.' });
    }
    let actorId: number | null = null;
    try {
      const admin = await sessionUserFromToken(pool, cookieValue(request.headers.cookie, SESSION_COOKIE_NAME));
      if (!admin) {
        await auditBestEffort(pool, { action: 'ADMIN_ANOMALIES_ACCESS_DENIED', status: 'FAILURE', details: { reason: 'unauthenticated' } }, request.ip, options.auditPublisher);
        return response.status(401).json({ error: 'Требуется вход.' });
      }
      if (admin.role !== 'admin') {
        await auditBestEffort(pool, { userId: admin.user_id, action: 'ADMIN_ANOMALIES_ACCESS_DENIED', status: 'FAILURE', details: { reason: 'insufficient_role' } }, request.ip, options.auditPublisher);
        return response.status(403).json({ error: 'Недостаточно прав.' });
      }
      actorId = admin.user_id;
      const changed = await inTransaction(pool, async (client) => {
        const current = await client.query<{ status: IncidentStatus }>(
          'SELECT status FROM public.anomaly_incidents WHERE incident_id=$1 FOR UPDATE', [incidentId],
        );
        if (!current.rows[0]) return { missing: true as const };
        const previous = current.rows[0].status;
        if (previous === 'RESOLVED' || previous === 'FALSE_POSITIVE') return { conflict: true as const };
        if (previous === target) return { status: target, audit: null };
        const updated = await client.query<AnomalyIncident>(
          `UPDATE public.anomaly_incidents SET status=$1, updated_at=NOW()
           WHERE incident_id=$2
           RETURNING incident_id::text AS incident_id, anomaly_type, subject_user_id, severity, risk_score, status,
             detected_at, updated_at, first_event_at, last_event_at, evidence, explanation, recommendations, deduplication_key`,
          [target, incidentId],
        );
        const audit = await insertAuditLog(client, {
          userId: actorId, action: 'ANOMALY_STATUS_CHANGED', entityType: 'anomaly_incident',
          entityId: Number(incidentId) <= MAX_DATABASE_ID ? Number(incidentId) : null,
          status: 'SUCCESS', details: { from: previous, to: target }, ipAddress: request.ip,
        });
        return { status: target, incident: updated.rows[0], audit };
      });
      if ('missing' in changed) return response.status(404).json({ error: 'Инцидент не найден.' });
      if ('conflict' in changed) return response.status(409).json({ error: 'Завершённый инцидент нельзя изменить.' });
      if (changed.audit) publishAuditLog(options.auditPublisher, changed.audit);
      return response.json({ incident: changed.incident ?? { incident_id: incidentId, status: changed.status } });
    } catch (error) { return next(error); }
  });

  app.get('/api/v1/admin/replenishment/demo', async (request, response, next) => {
    let admin: UserRow | null;
    try {
      admin = await requireAdmin(request, response);
    } catch (error) {
      return next(error);
    }
    if (!admin) return;
    try {
      const reportText = await readFile(options.replenishmentDemoReportPath ?? SYNTHETIC_REPLENISHMENT_REPORT_PATH, 'utf8');
      let report: unknown;
      try { report = JSON.parse(reportText); } catch { return response.status(503).json({ error: 'Демонстрационный отчёт временно недоступен.' }); }
      if (!isSyntheticReplenishmentReport(report)) return response.status(503).json({ error: 'Демонстрационный отчёт временно недоступен.' });
      return response.json(report);
    } catch {
      return response.status(503).json({ error: 'Демонстрационный отчёт временно недоступен.' });
    }
  });

  app.post('/api/v1/admin/replenishment/runs', async (request, response, next) => {
    let admin: UserRow | null;
    try { admin = await requireAdmin(request, response); }
    catch (error) { return next(error); }
    if (!admin) return;
    if (request.body && (typeof request.body !== 'object' || Array.isArray(request.body) || Object.keys(request.body).length > 0)) {
      return response.status(400).json({ error: 'Создание запуска не принимает данные отчёта от клиента.' });
    }

    let report: unknown;
    try {
      const contents = await readFile(options.replenishmentDemoReportPath ?? SYNTHETIC_REPLENISHMENT_REPORT_PATH, 'utf8');
      report = JSON.parse(contents);
      if (!isSyntheticReplenishmentReport(report)) return response.status(503).json({ error: 'Демонстрационный отчёт временно недоступен.' });
    } catch {
      return response.status(503).json({ error: 'Демонстрационный отчёт временно недоступен.' });
    }

    try {
      const saved = await inTransaction(pool, async (client) => {
        const { metadata, recommendations } = report as { metadata: Record<string, unknown>; recommendations: Record<string, unknown>[] };
        const forecast = metadata.forecast_period as { start: string; end: string };
        const policy = metadata.safety_stock_policy as { safety_days: number };
        const insertedRun = await client.query<{ run_id: string; created_at: string }>(
          `INSERT INTO public.replenishment_runs
             (source, model_name, model_version, forecast_start, forecast_end, review_period_days, metadata_snapshot, created_by_user_id)
           VALUES ('SYNTHETIC', $1, NULL, $2::date, $3::date, $4, $5::jsonb, $6)
           RETURNING run_id::text AS run_id, created_at`,
          [metadata.model, forecast.start, forecast.end, metadata.review_period_days, JSON.stringify(metadata), admin!.user_id],
        );
        if (!insertedRun.rows[0]) throw new Error('Replenishment run insert returned no row.');
        const runId = insertedRun.rows[0].run_id;
        for (const [recommendationIndex, recommendation] of recommendations.entries()) {
          await client.query(
            `INSERT INTO public.replenishment_recommendations
               (run_id, recommendation_index, synthetic_product_id, synthetic_supplier_id, supplier_name, recommendation_snapshot)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
            [runId, recommendationIndex, recommendation.synthetic_product_id, recommendation.supplier_id,
              recommendation.supplier_name, JSON.stringify(recommendation)],
          );
        }
        const log = await insertAuditLog(client, {
          userId: admin!.user_id, action: 'REPLENISHMENT_RUN_CREATED', entityType: 'replenishment_run',
          entityId: Number(runId) <= MAX_DATABASE_ID ? Number(runId) : null, status: 'SUCCESS',
          details: { run_id: runId, source: 'SYNTHETIC', recommendation_count: recommendations.length }, ipAddress: request.ip,
        });
        return { runId, createdAt: insertedRun.rows[0].created_at, count: recommendations.length, model: metadata.model,
          forecastStart: forecast.start, forecastEnd: forecast.end, safetyDays: policy.safety_days, log };
      });
      publishAuditLog(options.auditPublisher, saved.log);
      return response.status(201).json({ run: {
        run_id: saved.runId, source: 'SYNTHETIC', model_name: saved.model, forecast_start: saved.forecastStart,
        forecast_end: saved.forecastEnd, created_at: saved.createdAt, recommendation_count: saved.count,
        accepted_count: 0, rejected_count: 0, pending_count: saved.count,
      } });
    } catch (error) { return next(error); }
  });

  app.get('/api/v1/admin/replenishment/runs', async (request, response, next) => {
    try {
      if (!await requireAdmin(request, response)) return;
      const page = positiveInt(request.query.page, 1, 1_000_000);
      const pageSize = positiveInt(request.query.pageSize, 10, 100);
      if (page === null || pageSize === null) return response.status(400).json({ error: 'Некорректные параметры пагинации.' });
      const offset = (page - 1) * pageSize;
      if (!Number.isSafeInteger(offset)) return response.status(400).json({ error: 'Некорректные параметры пагинации.' });
      const totalResult = await pool.query<{ total: number }>('SELECT COUNT(*)::int AS total FROM public.replenishment_runs');
      const { rows } = await pool.query(
        `SELECT r.run_id::text AS run_id, r.source, r.model_name, r.model_version,
           r.forecast_start, r.forecast_end, r.review_period_days, r.created_at,
           r.created_by_user_id, creator.name AS created_by_name,
           (SELECT COUNT(*)::int FROM public.replenishment_recommendations rec WHERE rec.run_id=r.run_id) AS recommendation_count,
           (SELECT COUNT(*)::int FROM public.replenishment_decisions d JOIN public.replenishment_recommendations rec ON rec.recommendation_id=d.recommendation_id WHERE rec.run_id=r.run_id AND d.decision='ACCEPTED') AS accepted_count,
           (SELECT COUNT(*)::int FROM public.replenishment_decisions d JOIN public.replenishment_recommendations rec ON rec.recommendation_id=d.recommendation_id WHERE rec.run_id=r.run_id AND d.decision='REJECTED') AS rejected_count,
           ((SELECT COUNT(*)::int FROM public.replenishment_recommendations rec WHERE rec.run_id=r.run_id) -
            (SELECT COUNT(*)::int FROM public.replenishment_decisions d JOIN public.replenishment_recommendations rec ON rec.recommendation_id=d.recommendation_id WHERE rec.run_id=r.run_id)) AS pending_count
         FROM public.replenishment_runs r
         LEFT JOIN public.users creator ON creator.user_id=r.created_by_user_id
         ORDER BY r.created_at DESC, r.run_id DESC LIMIT $1 OFFSET $2`, [pageSize, offset],
      );
      const total = Number(totalResult.rows[0]?.total ?? 0);
      return response.json({ runs: rows, page, pageSize, total, totalPages: Math.ceil(total / pageSize) });
    } catch (error) { return next(error); }
  });

  app.get('/api/v1/admin/replenishment/runs/:runId/recommendations', async (request, response, next) => {
    try {
      if (!await requireAdmin(request, response)) return;
      const runId = positiveBigIntId(request.params.runId);
      const page = positiveInt(request.query.page, 1, 1_000_000);
      const pageSize = positiveInt(request.query.pageSize, 20, 100);
      if (runId === null || page === null || pageSize === null) return response.status(400).json({ error: 'Некорректный ID запуска или параметры пагинации.' });
      const offset = (page - 1) * pageSize;
      if (!Number.isSafeInteger(offset)) return response.status(400).json({ error: 'Некорректные параметры пагинации.' });
      const exists = await pool.query('SELECT run_id FROM public.replenishment_runs WHERE run_id=$1', [runId]);
      if (!exists.rows[0]) return response.status(404).json({ error: 'Запуск не найден.' });
      const totalResult = await pool.query<{ total: number }>(
        'SELECT COUNT(*)::int AS total FROM public.replenishment_recommendations WHERE run_id=$1', [runId],
      );
      const { rows } = await pool.query(
        `SELECT rec.recommendation_id::text AS recommendation_id, rec.recommendation_index,
           rec.recommendation_snapshot, COALESCE(d.decision, 'PENDING') AS decision_status,
           d.decided_at, d.decided_by_user_id, decision_admin.name AS decided_by_name
         FROM public.replenishment_recommendations rec
         LEFT JOIN public.replenishment_decisions d ON d.recommendation_id=rec.recommendation_id
         LEFT JOIN public.users decision_admin ON decision_admin.user_id=d.decided_by_user_id
         WHERE rec.run_id=$1 ORDER BY rec.recommendation_index LIMIT $2 OFFSET $3`, [runId, pageSize, offset],
      );
      const total = Number(totalResult.rows[0]?.total ?? 0);
      const recommendations = rows.map((row) => ({ ...row.recommendation_snapshot, recommendation_id: row.recommendation_id,
        recommendation_index: row.recommendation_index, decision_status: row.decision_status, decided_at: row.decided_at,
        decided_by_user_id: row.decided_by_user_id, decided_by_name: row.decided_by_name }));
      return response.json({ run_id: runId, recommendations, page, pageSize, total, totalPages: Math.ceil(total / pageSize) });
    } catch (error) { return next(error); }
  });

  app.patch('/api/v1/admin/replenishment/recommendations/:recommendationId/decision', async (request, response, next) => {
    try {
      const admin = await requireAdmin(request, response);
      if (!admin) return;
      const recommendationId = positiveBigIntId(request.params.recommendationId);
      const body = request.body;
      if (recommendationId === null || !body || typeof body !== 'object' || Array.isArray(body) ||
          Object.keys(body).length !== 1 || !['ACCEPTED', 'REJECTED'].includes(body.decision)) {
        return response.status(400).json({ error: 'Укажите корректное решение ACCEPTED или REJECTED.' });
      }
      const requestedDecision = body.decision as 'ACCEPTED' | 'REJECTED';
      const outcome = await inTransaction(pool, async (client) => {
        const recommendationResult = await client.query<{ recommendation_snapshot: Record<string, unknown>; run_id: string }>(
          `SELECT recommendation_snapshot, run_id::text AS run_id
           FROM public.replenishment_recommendations WHERE recommendation_id=$1 FOR UPDATE`, [recommendationId],
        );
        const recommendation = recommendationResult.rows[0];
        if (!recommendation) return { kind: 'missing' as const };
        if (recommendation.recommendation_snapshot.recommendation_status !== 'PURCHASE_RECOMMENDED') return { kind: 'ineligible' as const };
        const currentResult = await client.query<{ decision: 'ACCEPTED' | 'REJECTED'; decided_at: string; decided_by_user_id: number | null }>(
          `SELECT decision, decided_at, decided_by_user_id FROM public.replenishment_decisions WHERE recommendation_id=$1`, [recommendationId],
        );
        const current = currentResult.rows[0];
        if (current) return current.decision === requestedDecision
          ? { kind: 'existing' as const, decision: current }
          : { kind: 'conflict' as const };
        const inserted = await client.query<{ decision_id: string; decision: 'ACCEPTED' | 'REJECTED'; decided_at: string; decided_by_user_id: number }>(
          `INSERT INTO public.replenishment_decisions (recommendation_id, decision, decided_by_user_id)
           VALUES ($1, $2, $3) RETURNING decision_id::text AS decision_id, decision, decided_at, decided_by_user_id`,
          [recommendationId, requestedDecision, admin.user_id],
        );
        if (!inserted.rows[0]) throw new Error('Replenishment decision insert returned no row.');
        const audit = await insertAuditLog(client, {
          userId: admin.user_id, action: 'REPLENISHMENT_DECISION_RECORDED', entityType: 'replenishment_recommendation',
          entityId: Number(recommendationId) <= MAX_DATABASE_ID ? Number(recommendationId) : null, status: 'SUCCESS',
          details: { recommendation_id: recommendationId, run_id: recommendation.run_id, decision: requestedDecision }, ipAddress: request.ip,
        });
        return { kind: 'created' as const, decision: inserted.rows[0], audit };
      });
      if (outcome.kind === 'missing') return response.status(404).json({ error: 'Рекомендация не найдена.' });
      if (outcome.kind === 'ineligible') return response.status(400).json({ error: 'Решение доступно только для рекомендаций с закупкой.' });
      if (outcome.kind === 'conflict') return response.status(409).json({ error: 'Для этой рекомендации уже записано противоположное решение.' });
      if (outcome.kind === 'created') publishAuditLog(options.auditPublisher, outcome.audit);
      return response.json({ decision: outcome.decision, already_recorded: outcome.kind === 'existing' });
    } catch (error) { return next(error); }
  });

  app.get('/api/v1/admin/orders', async (request, response, next) => {
    try {
      const admin = await sessionUserFromToken(pool, cookieValue(request.headers.cookie, SESSION_COOKIE_NAME));
      if (!admin) {
        await auditBestEffort(pool, { action: 'ADMIN_ORDERS_ACCESS_DENIED', status: 'FAILURE', details: { reason: 'unauthenticated' } }, request.ip, options.auditPublisher);
        return response.status(401).json({ error: 'Требуется вход.' });
      }
      if (admin.role !== 'admin') {
        await auditBestEffort(pool, { userId: admin.user_id, action: 'ADMIN_ORDERS_ACCESS_DENIED', status: 'FAILURE', details: { reason: 'insufficient_role' } }, request.ip, options.auditPublisher);
        return response.status(403).json({ error: 'Недостаточно прав.' });
      }
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

  app.patch('/api/v1/admin/orders/:orderId/status', async (request, response, next) => {
    const orderId = positiveInt(request.params.orderId, 1, MAX_DATABASE_ID);
    if (orderId === null) return response.status(400).json({ error: 'Некорректный ID заказа.' });
    let adminId: number | null = null;
    let client: PoolClient | null = null;
    let transactionOpen = false;
    let pendingOrderStatusAudit: Awaited<ReturnType<typeof insertAuditLog>> | null = null;
    try {
      const admin = await sessionUserFromToken(pool, cookieValue(request.headers.cookie, SESSION_COOKIE_NAME));
      if (!admin) {
        await auditBestEffort(pool, { action: 'ORDER_STATUS_CHANGED', entityType: 'order', entityId: orderId, status: 'FAILURE', details: { reason: 'unauthenticated' } }, request.ip, options.auditPublisher);
        return response.status(401).json({ error: 'Требуется вход.' });
      }
      if (admin.role !== 'admin') {
        await auditBestEffort(pool, { userId: admin.user_id, action: 'ORDER_STATUS_CHANGED', entityType: 'order', entityId: orderId, status: 'FAILURE', details: { reason: 'insufficient_role' } }, request.ip, options.auditPublisher);
        return response.status(403).json({ error: 'Недостаточно прав.' });
      }
      adminId = admin.user_id;
      const status = request.body?.status;
      if (typeof status !== 'string' || !ORDER_STATUSES.has(status)) {
        await auditBestEffort(pool, { userId: adminId, action: 'ORDER_STATUS_CHANGED', entityType: 'order', entityId: orderId, status: 'FAILURE', details: { reason: 'invalid_status' } }, request.ip, options.auditPublisher);
        return response.status(400).json({ error: 'Недопустимый статус заказа.' });
      }

      client = await pool.connect();
      await client.query('BEGIN');
      transactionOpen = true;
      const current = await client.query<{ status: string }>('SELECT status FROM orders WHERE order_id=$1 FOR UPDATE', [orderId]);
      if (!current.rows[0]) {
        await client.query('ROLLBACK');
        transactionOpen = false;
        await auditBestEffort(pool, { userId: adminId, action: 'ORDER_STATUS_CHANGED', entityType: 'order', entityId: orderId, status: 'FAILURE', details: { reason: 'not_found' } }, request.ip, options.auditPublisher);
        return response.status(404).json({ error: 'Заказ не найден.' });
      }
      if (current.rows[0].status === status) {
        await client.query('COMMIT');
        transactionOpen = false;
        return response.json({ order: { order_id: orderId, status } });
      }
      const updated = await client.query<{ order_id: number; status: string }>(
        'UPDATE orders SET status=$1 WHERE order_id=$2 RETURNING order_id, status', [status, orderId],
      );
      pendingOrderStatusAudit = await insertAuditLog(client, {
        userId: adminId, action: 'ORDER_STATUS_CHANGED', entityType: 'order', entityId: orderId,
        status: 'SUCCESS', details: { from: current.rows[0].status, to: status }, ipAddress: request.ip,
      });
      await client.query('COMMIT');
      transactionOpen = false;
      publishAuditLog(options.auditPublisher, pendingOrderStatusAudit);
      return response.json({ order: updated.rows[0] });
    } catch (error) {
      if (client && transactionOpen) await client.query('ROLLBACK').catch(() => undefined);
      if (adminId !== null) await auditBestEffort(pool, { userId: adminId, action: 'ORDER_STATUS_CHANGED', entityType: 'order', entityId: orderId, status: 'FAILURE', details: { reason: 'request_failed' } }, request.ip, options.auditPublisher);
      return next(error);
    } finally { client?.release(); }
  });

  app.get('/api/v1/admin/categories', async (request, response, next) => {
    try {
      if (!await requireAdmin(request, response)) return;
      const { rows } = await pool.query(
        `SELECT c.category_id, c.category_name, COUNT(p.product_id)::int AS count
         FROM public.categories c LEFT JOIN public.products p ON p.category_id=c.category_id
         GROUP BY c.category_id ORDER BY c.category_id`,
      );
      return response.json({ categories: rows });
    } catch (error) { return next(error); }
  });

  app.post('/api/v1/admin/categories', async (request, response, next) => {
    try {
      if (!await requireAdmin(request, response)) return;
      const name = validateCategoryName(request.body?.name);
      if (!name) return response.status(400).json({ error: 'Название категории должно содержать от 1 до 100 символов.' });
      const { rows } = await pool.query(
        `INSERT INTO public.categories (category_name) VALUES ($1)
         RETURNING category_id, category_name`, [name],
      );
      return response.status(201).json({ category: { ...rows[0], count: 0 } });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') return response.status(409).json({ error: 'Категория с таким названием уже существует.' });
      return next(error);
    }
  });

  app.patch('/api/v1/admin/categories/:categoryId', async (request, response, next) => {
    try {
      if (!await requireAdmin(request, response)) return;
      const categoryId = positiveInt(request.params.categoryId, 1, MAX_DATABASE_ID);
      const name = validateCategoryName(request.body?.name);
      if (categoryId === null) return response.status(400).json({ error: 'Некорректный ID категории.' });
      if (!name) return response.status(400).json({ error: 'Название категории должно содержать от 1 до 100 символов.' });
      const { rows } = await pool.query(
        `UPDATE public.categories SET category_name=$1 WHERE category_id=$2
         RETURNING category_id, category_name,
           (SELECT COUNT(*)::int FROM public.products WHERE category_id=$2) AS count`, [name, categoryId],
      );
      if (!rows[0]) return response.status(404).json({ error: 'Категория не найдена.' });
      return response.json({ category: rows[0] });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') return response.status(409).json({ error: 'Категория с таким названием уже существует.' });
      return next(error);
    }
  });

  app.delete('/api/v1/admin/categories/:categoryId', async (request, response, next) => {
    try {
      if (!await requireAdmin(request, response)) return;
      const categoryId = positiveInt(request.params.categoryId, 1, MAX_DATABASE_ID);
      if (categoryId === null) return response.status(400).json({ error: 'Некорректный ID категории.' });
      const { rows } = await pool.query('DELETE FROM public.categories WHERE category_id=$1 RETURNING category_id', [categoryId]);
      if (!rows[0]) return response.status(404).json({ error: 'Категория не найдена.' });
      return response.status(204).end();
    } catch (error) {
      if ((error as { code?: string }).code === '23503') return response.status(409).json({ error: 'Нельзя удалить категорию, пока в ней есть товары.' });
      return next(error);
    }
  });

  app.get('/api/v1/admin/users', async (request, response, next) => {
    try {
      if (!await requireAdmin(request, response)) return;
      const { rows } = await pool.query(
        `SELECT u.user_id, u.name, u.email, u.phone, u.address,
           COUNT(DISTINCT o.order_id)::int AS order_count,
           COUNT(DISTINCT r.review_id)::int AS review_count
         FROM public.users u
         LEFT JOIN public.orders o ON o.user_id=u.user_id
         LEFT JOIN public.reviews r ON r.user_id=u.user_id
         GROUP BY u.user_id ORDER BY u.user_id`,
      );
      return response.json({ users: rows });
    } catch (error) { return next(error); }
  });

  app.get('/api/v1/admin/reviews', async (request, response, next) => {
    try {
      if (!await requireAdmin(request, response)) return;
      const { rows } = await pool.query(
        `SELECT r.review_id, r.user_id, r.product_id, r.rating, r.comment, r.review_date,
           jsonb_build_object('user_id', u.user_id, 'name', u.name) AS "user",
           jsonb_build_object('product_id', p.product_id, 'name', p.name) AS product
         FROM public.reviews r
         JOIN public.users u ON u.user_id=r.user_id
         JOIN public.products p ON p.product_id=r.product_id
         ORDER BY r.review_date DESC, r.review_id DESC`,
      );
      return response.json({ reviews: rows });
    } catch (error) { return next(error); }
  });

  app.delete('/api/v1/admin/reviews/:reviewId', async (request, response, next) => {
    try {
      if (!await requireAdmin(request, response)) return;
      const reviewId = positiveInt(request.params.reviewId, 1, MAX_DATABASE_ID);
      if (reviewId === null) return response.status(400).json({ error: 'Некорректный ID отзыва.' });
      const { rows } = await pool.query('DELETE FROM public.reviews WHERE review_id=$1 RETURNING review_id', [reviewId]);
      if (!rows[0]) return response.status(404).json({ error: 'Отзыв не найден.' });
      return response.status(204).end();
    } catch (error) { return next(error); }
  });

  app.get('/api/v1/admin/products', async (request, response, next) => {
    try {
      const admin = await sessionUserFromToken(pool, cookieValue(request.headers.cookie, SESSION_COOKIE_NAME));
      if (!admin) {
        await auditBestEffort(pool, { action: 'PRODUCTS_ACCESS_DENIED', status: 'FAILURE', details: { reason: 'unauthenticated' } }, request.ip, options.auditPublisher);
        return response.status(401).json({ error: 'Требуется вход.' });
      }
      if (admin.role !== 'admin') {
        await auditBestEffort(pool, { userId: admin.user_id, action: 'PRODUCTS_ACCESS_DENIED', status: 'FAILURE', details: { reason: 'insufficient_role' } }, request.ip, options.auditPublisher);
        return response.status(403).json({ error: 'Недостаточно прав.' });
      }
      const { rows } = await pool.query(
        `SELECT p.product_id, p.name, p.description, p.price::float8 AS price, p.stock_quantity, p.category_id
         FROM products p ORDER BY p.product_id`,
      );
      return response.json({ products: rows });
    } catch (error) { return next(error); }
  });

  app.post('/api/v1/admin/products', async (request, response, next) => {
    let actorId: number | null = null;
    try {
      const admin = await sessionUserFromToken(pool, cookieValue(request.headers.cookie, SESSION_COOKIE_NAME));
      if (!admin) {
        await auditBestEffort(pool, { action: 'PRODUCT_CREATED', status: 'FAILURE', details: { reason: 'unauthenticated' } }, request.ip, options.auditPublisher);
        return response.status(401).json({ error: 'Требуется вход.' });
      }
      if (admin.role !== 'admin') {
        await auditBestEffort(pool, { userId: admin.user_id, action: 'PRODUCT_CREATED', status: 'FAILURE', details: { reason: 'insufficient_role' } }, request.ip, options.auditPublisher);
        return response.status(403).json({ error: 'Недостаточно прав.' });
      }
      actorId = admin.user_id;
      const product = validateProduct(request.body);
      if (!product) {
        await auditBestEffort(pool, { userId: actorId, action: 'PRODUCT_CREATED', status: 'FAILURE', details: { reason: 'invalid_input' } }, request.ip, options.auditPublisher);
        return response.status(400).json({ error: 'Проверьте название, описание, цену, остаток и категорию.' });
      }
      const result = await inTransaction(pool, async (client) => {
        const { rows } = await client.query(
          `INSERT INTO products (name, description, price, stock_quantity, category_id)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING product_id, name, description, price::float8 AS price, stock_quantity, category_id`,
          [product.name, product.description, product.price.toFixed(2), product.stock_quantity, product.category_id],
        );
        const log = await insertAuditLog(client, { userId: actorId, action: 'PRODUCT_CREATED', entityType: 'product', entityId: rows[0].product_id, status: 'SUCCESS', ipAddress: request.ip });
        return { product: rows[0], log };
      });
      publishAuditLog(options.auditPublisher, result.log);
      return response.status(201).json({ product: result.product });
    } catch (error) {
      if (actorId !== null) await auditBestEffort(pool, { userId: actorId, action: 'PRODUCT_CREATED', status: 'FAILURE', details: { reason: 'request_failed' } }, request.ip, options.auditPublisher);
      if ((error as { code?: string }).code === '23503') return response.status(400).json({ error: 'Выбранная категория не существует.' });
      return next(error);
    }
  });

  app.patch('/api/v1/admin/products/:productId', async (request, response, next) => {
    const productId = positiveInt(request.params.productId, 1, MAX_DATABASE_ID);
    if (productId === null) return response.status(400).json({ error: 'Invalid product id' });
    let actorId: number | null = null;
    try {
      const admin = await sessionUserFromToken(pool, cookieValue(request.headers.cookie, SESSION_COOKIE_NAME));
      if (!admin) {
        await auditBestEffort(pool, { action: 'PRODUCT_UPDATED', entityType: 'product', entityId: productId, status: 'FAILURE', details: { reason: 'unauthenticated' } }, request.ip, options.auditPublisher);
        return response.status(401).json({ error: 'Требуется вход.' });
      }
      if (admin.role !== 'admin') {
        await auditBestEffort(pool, { userId: admin.user_id, action: 'PRODUCT_UPDATED', entityType: 'product', entityId: productId, status: 'FAILURE', details: { reason: 'insufficient_role' } }, request.ip, options.auditPublisher);
        return response.status(403).json({ error: 'Недостаточно прав.' });
      }
      actorId = admin.user_id;
      const product = validateProduct(request.body);
      if (!product) {
        await auditBestEffort(pool, { userId: actorId, action: 'PRODUCT_UPDATED', entityType: 'product', entityId: productId, status: 'FAILURE', details: { reason: 'invalid_input' } }, request.ip, options.auditPublisher);
        return response.status(400).json({ error: 'Проверьте название, описание, цену, остаток и категорию.' });
      }
      const result = await inTransaction(pool, async (client) => {
        const { rows } = await client.query(
          `UPDATE products SET name=$1, description=$2, price=$3, stock_quantity=$4, category_id=$5
           WHERE product_id=$6
           RETURNING product_id, name, description, price::float8 AS price, stock_quantity, category_id`,
          [product.name, product.description, product.price.toFixed(2), product.stock_quantity, product.category_id, productId],
        );
        if (!rows[0]) return { product: null, log: null };
        const log = await insertAuditLog(client, { userId: actorId, action: 'PRODUCT_UPDATED', entityType: 'product', entityId: productId, status: 'SUCCESS', ipAddress: request.ip });
        return { product: rows[0], log };
      });
      if (!result.product) {
        await auditBestEffort(pool, { userId: actorId, action: 'PRODUCT_UPDATED', entityType: 'product', entityId: productId, status: 'FAILURE', details: { reason: 'not_found' } }, request.ip, options.auditPublisher);
        return response.status(404).json({ error: 'Товар не найден.' });
      }
      if (result.log) publishAuditLog(options.auditPublisher, result.log);
      return response.json({ product: result.product });
    } catch (error) {
      if (actorId !== null) await auditBestEffort(pool, { userId: actorId, action: 'PRODUCT_UPDATED', entityType: 'product', entityId: productId, status: 'FAILURE', details: { reason: 'request_failed' } }, request.ip, options.auditPublisher);
      if ((error as { code?: string }).code === '23503') return response.status(400).json({ error: 'Выбранная категория не существует.' });
      return next(error);
    }
  });

  app.delete('/api/v1/admin/products/:productId', async (request, response, next) => {
    const productId = positiveInt(request.params.productId, 1, MAX_DATABASE_ID);
    if (productId === null) return response.status(400).json({ error: 'Invalid product id' });
    let actorId: number | null = null;
    try {
      const admin = await sessionUserFromToken(pool, cookieValue(request.headers.cookie, SESSION_COOKIE_NAME));
      if (!admin) {
        await auditBestEffort(pool, { action: 'PRODUCT_DELETED', entityType: 'product', entityId: productId, status: 'FAILURE', details: { reason: 'unauthenticated' } }, request.ip, options.auditPublisher);
        return response.status(401).json({ error: 'Требуется вход.' });
      }
      if (admin.role !== 'admin') {
        await auditBestEffort(pool, { userId: admin.user_id, action: 'PRODUCT_DELETED', entityType: 'product', entityId: productId, status: 'FAILURE', details: { reason: 'insufficient_role' } }, request.ip, options.auditPublisher);
        return response.status(403).json({ error: 'Недостаточно прав.' });
      }
      actorId = admin.user_id;
      const result = await inTransaction(pool, async (client) => {
        const { rows } = await client.query('DELETE FROM products WHERE product_id=$1 RETURNING product_id', [productId]);
        if (!rows[0]) return { productId: null, log: null };
        const log = await insertAuditLog(client, { userId: actorId, action: 'PRODUCT_DELETED', entityType: 'product', entityId: productId, status: 'SUCCESS', ipAddress: request.ip });
        return { productId: rows[0].product_id as number, log };
      });
      if (result.productId === null) {
        await auditBestEffort(pool, { userId: actorId, action: 'PRODUCT_DELETED', entityType: 'product', entityId: productId, status: 'FAILURE', details: { reason: 'not_found' } }, request.ip, options.auditPublisher);
        return response.status(404).json({ error: 'Товар не найден.' });
      }
      if (result.log) publishAuditLog(options.auditPublisher, result.log);
      return response.status(204).end();
    } catch (error) {
      if (actorId !== null) await auditBestEffort(pool, { userId: actorId, action: 'PRODUCT_DELETED', entityType: 'product', entityId: productId, status: 'FAILURE', details: { reason: 'request_failed' } }, request.ip, options.auditPublisher);
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

  app.get('/api/health/ready', async (_request, response) => {
    try {
      const readiness = await checkDatabaseReadiness(pool);
      const ready = Boolean(readiness.products_relation && readiness.anomaly_schema_ready);
      return response.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'unavailable', ...readiness });
    } catch (error) {
      console.error('Database readiness check failed:', error instanceof Error ? error.message : 'Unknown error');
      return response.status(503).json({ error: 'Database readiness check failed' });
    }
  });

  app.get('/api/v1/categories', (_request, response, next) => {
    void pool.query(
      `SELECT c.category_id, c.category_name, COUNT(p.product_id)::int AS count
       FROM public.categories c LEFT JOIN public.products p ON p.category_id = c.category_id
       GROUP BY c.category_id ORDER BY c.category_id`,
    ).then(({ rows }) => response.json(rows)).catch(next);
  });

  app.get('/api/v1/categories/:categoryId', async (request, response, next) => {
    const categoryId = positiveInt(request.params.categoryId, 1, MAX_DATABASE_ID);
    if (categoryId === null) return response.status(400).json({ error: 'Invalid category id' });
    try {
      const { rows } = await pool.query(
        `SELECT c.category_id, c.category_name, COUNT(p.product_id)::int AS count
         FROM public.categories c LEFT JOIN public.products p ON p.category_id = c.category_id
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
         FROM public.products p LEFT JOIN public.reviews r ON r.product_id = p.product_id
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
  response.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=${token}; ${cookieOptions(secure)}`);
}

export async function sessionUserFromToken(pool: Pool, token: string | undefined): Promise<SessionUser | null> {
  if (!token || !/^[A-Za-z\d_-]{40,50}$/.test(token)) return null;
  const { rows } = await pool.query<UserRow>(
    `SELECT u.user_id, u.name, u.email, u.phone, u.address, u.role
     FROM user_sessions s JOIN users u ON u.user_id=s.user_id
     WHERE s.token_hash=$1 AND s.expires_at > NOW()`, [tokenHash(token)],
  );
  return rows[0] ?? null;
}

async function auditBestEffort(
  pool: Pool,
  event: Omit<AuditEventInput, 'ipAddress'>,
  ipAddress?: string,
  publisher?: AuditPublisher,
): Promise<void> {
  try {
    const log = await insertAuditLog(pool, { ...event, ipAddress: ipAddress ?? null });
    publishAuditLog(publisher, log);
  } catch (error) {
    console.error('Audit log write failed:', error instanceof Error ? error.message : 'Unknown error');
  }
}

async function inTransaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let open = false;
  try {
    await client.query('BEGIN');
    open = true;
    const result = await operation(client);
    await client.query('COMMIT');
    open = false;
    return result;
  } catch (error) {
    if (open) await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
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
      pool.query(`SELECT COUNT(*)::int AS total FROM public.products p ${where}`, countValues),
      pool.query(
        `SELECT p.product_id, p.name, p.description, p.price::float8 AS price, p.stock_quantity, p.category_id,
                COALESCE(AVG(r.rating), 0)::float AS rating, COUNT(r.review_id)::int AS reviews
         FROM public.products p LEFT JOIN public.reviews r ON r.product_id = p.product_id ${where}
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
