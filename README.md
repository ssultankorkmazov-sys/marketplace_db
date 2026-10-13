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

The GitHub Pages workflow builds the frontend with `VITE_API_URL=https://marketkz-api.onrender.com/api/v1`. The API allows credentialed browser requests from the Pages origin `https://ssultankorkmazov-sys.github.io` and the local development origins `http://localhost:5173` and `http://127.0.0.1:5173`. Keep `NODE_ENV=production` on the Render service so its cross-site session cookie is sent with `SameSite=None; Secure`.

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
