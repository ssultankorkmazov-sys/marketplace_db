# MarketKZ

Marketplace application: React, TypeScript, Vite, Tailwind CSS, React Router; Node.js, TypeScript, Express; PostgreSQL.

## Run locally

1. Copy `.env.example` to `.env` and set local PostgreSQL connection details.
2. Start the existing PostgreSQL database. Do not re-import `db/marketplace_db.sql` when it is already initialized.
3. Apply pending additive schema migrations: `npm --prefix server run db:migrate`.
4. Start the API: `npm --prefix server run dev` (port 3001).
5. In another terminal, start the UI: `npm run dev`.

The backend does not import or reset the database on startup. The SQL seed file remains the original catalog and fixture source.

## Production hosting

The GitHub Pages workflow builds the frontend with `VITE_API_URL=https://marketkz-api.onrender.com/api/v1`. The API allows credentialed browser requests from the Pages origin `https://ssultankorkmazov-sys.github.io`; local origins `http://localhost:5173` and `http://127.0.0.1:5173` are allowed only outside production. Keep `NODE_ENV=production` on the Render service so its cross-site session cookie is sent with `SameSite=None; Secure`.

## Audit log and live activity

Apply additive migrations before using the audit page. The migration runner records completed files in `public.schema_migrations` and applies each recorded migration only once. On a database created before the tracker, it recognizes migrations 001–005 as already applied only when their complete expected schema is present; a partial or incompatible schema causes the transaction to stop for manual review. This runner is restricted to the local PostgreSQL database named exactly `market_db_test`; it verifies `current_database()` on the active connection and refuses every other database. Run it with `npm --prefix server run db:migrate` only after explicitly setting `DATABASE_URL` to that local test database. It is not a production/shared-database migration mechanism; any such migration needs a separately reviewed and approved procedure. The migrations add the tracker, audit/anomaly tables, indexes and trigger without dropping or replacing existing tables or rows.

Rule-based anomaly detection is an additive backend extension. Migration `004_anomaly_incidents.sql` adds incident, audit-event link and transactional outbox tables, plus a trigger that queues newly inserted audit events. Migration `005_anomaly_queue_dead_letter.sql` adds nullable retry diagnostics and dead-letter timestamp columns; the worker preserves a redacted error summary and stops retrying after five attempts. Neither migration backfills or replays older audit rows. The migration runner includes 004 and 005 but retains its `market_db_test`-only guard; do not point it at production. The worker processes queued events asynchronously and retries failed work with backoff. Initial rules are configurable with `ANOMALY_FAILED_LOGIN_THRESHOLD` / `ANOMALY_FAILED_LOGIN_WINDOW_SECONDS`, `ANOMALY_ADMIN_DENIED_THRESHOLD` / `ANOMALY_ADMIN_DENIED_WINDOW_SECONDS`, `ANOMALY_ORDER_THRESHOLD` / `ANOMALY_ORDER_WINDOW_SECONDS`, and `ANOMALY_POLL_INTERVAL_MS`; defaults are 5 events in 120 seconds, 5 in 120 seconds, and 5 in 300 seconds respectively. Thresholds and windows are starting values, not universal security limits. Scores use a deterministic rule-specific base risk plus 10 points per event above threshold, capped at 100; severity bands are 0–39 LOW, 40–69 MEDIUM, 70–89 HIGH, 90–100 CRITICAL. Recommendations are deterministic review/verification steps; the system never automatically blocks accounts or alters orders. `/api/health/ready` returns HTTP 503 until products and every required anomaly table, constraint, index, enabled trigger and exact trigger-function body are present.

Administrators can open **Журнал активности** in the admin navigation. The REST endpoints are `GET /api/v1/admin/logs` and `GET /api/v1/admin/logs/:logId`; both require a valid administrator session. Filters include `page`, `pageSize`, `action`, `status`, `userId`, `from`, `to`, and `q`. There are no log mutation endpoints. The live feed is `wss://marketkz-api.onrender.com/api/v1/admin/logs/stream` in production and authenticates from the existing HttpOnly session cookie. While connected, the server revalidates the session and admin role every 15 seconds and closes the socket when either is no longer valid. If the socket disconnects, the UI reconnects with backoff and reloads the current page over REST.

The anomaly management REST API is `GET /api/v1/admin/anomalies`, `GET /api/v1/admin/anomalies/:incidentId`, and `PATCH /api/v1/admin/anomalies/:incidentId/status`. Every endpoint checks the existing server session and current database admin role. Status changes accept `INVESTIGATING`, `RESOLVED`, or `FALSE_POSITIVE`; terminal incidents cannot be changed through this API. New and updated incidents are broadcast on the existing administrator WebSocket as `anomaly_incident` events. Evidence includes internal user ID, counts, timestamps and audit log IDs; it omits IP addresses, credentials, names, emails, order contents and other free text. Only identified accounts are grouped: unauthenticated attempts with no reliable user ID are not correlated by proxy IP.

Render Web Services support WebSockets. Live broadcasts are held in the current backend process; if the Render service is scaled to multiple instances, clients and writes may land on different instances, so cross-instance events require a shared PostgreSQL notification or pub/sub layer. REST logs remain authoritative either way.

## Authentication

Registration, login, logout and profile updates use the backend. Passwords are hashed with Node's scrypt. Sessions use random tokens in HttpOnly, SameSite=Lax cookies; PostgreSQL stores token hashes and expirations. Production cookies are Secure. The API never returns password hashes.

Checkout creates the order and its items in one PostgreSQL transaction, recalculates prices from the database, and decrements stock under row locks. The basket remains in browser storage for this educational MVP. Order history is scoped to the signed-in user by the API. Payment records are Pending for demonstration only; no payment is collected.

The authentication migration preserves all existing records. Existing seeded accounts have no password hash and cannot sign in until a password reset/claim process is implemented. There are no demo credentials. Registration and profile endpoints do not accept a role. For a local demonstration, first register a new account in the app, then connect to the local database as its trusted owner and inspect the exact account:

```sql
SELECT user_id, email, role
FROM users
WHERE lower(email) = lower('admin@example.kz')
  AND password_hash IS NOT NULL;
```

After confirming the intended account, promote only that account:

```sql
UPDATE users
SET role = 'admin'
WHERE lower(email) = lower('admin@example.kz')
  AND password_hash IS NOT NULL;
```

Replace the example email with the address used at registration and confirm PostgreSQL reports exactly one updated row. Run these statements only against the local demonstration database using a trusted database-owner connection; never put database credentials in frontend code. Sign out and back in (or reload) to refresh the admin UI.

## Короткая демонстрация проекта

1. Запустите локальную PostgreSQL и примените миграции при необходимости: `npm --prefix server run db:migrate`.
2. В отдельных терминалах запустите API (`npm --prefix server run dev`) и frontend (`npm run dev`), затем откройте адрес Vite, обычно `http://localhost:5173`.
3. Покажите каталог и карточку товара. Зарегистрируйте покупателя через форму приложения: роль обычного пользователя назначается сервером.
4. Добавьте товар в корзину, измените количество и оформите заказ с демонстрационным способом оплаты. Реальные платежи не выполняются; заказ получает статус `Processing`, платёж — `Pending`.
5. Откройте «Мои заказы» и страницу деталей: история загружается с backend и ограничена текущей учётной записью.
6. Для админской части зарегистрируйте отдельную учётную запись и назначьте ей роль по приведённой выше локальной SQL-инструкции. Выйдите и войдите снова, откройте админ-панель, покажите список заказов и создайте или отредактируйте товар. Для удаления выбирайте товар, ещё не связанный с заказом или отзывом: PostgreSQL корректно запрещает удаление связанных товаров.

Не используйте вымышленные универсальные credentials: аккаунты каталожного seed не имеют пароля. Корзина и избранное в учебной версии хранятся в браузере; заказы, позиции, статус демонстрационного платежа, товары и сессии обрабатывает backend/PostgreSQL.

## Project status

The catalog, checkout, order history, admin product management, and admin order viewing use PostgreSQL APIs. Basket and favorites remain in browser storage; categories, user management, reviews and other admin dashboard figures still use demo/local data and are tracked in [docs/migration-audit.md](docs/migration-audit.md). Do not treat browser storage as persistent server data. `src/data/mock.ts` is only a fixture for unconverted workflows and test/dev use; production catalog reads have no mock fallback.

## Checks

- Frontend tests: `npm test`
- Frontend production build: `npm run build`
- Backend tests: `npm --prefix server test`
- Backend type build: `npm --prefix server run build`
- Optional real PostgreSQL integration tests require a separately provisioned local database named with `_test` and `TEST_DATABASE_URL`.
