# MarketKZ backend and local catalog database

The API uses the seven-table schema and seed data in `../db/marketplace_db.sql`. The source SQL is left unchanged. The backend never imports data on startup.

## Local development database

1. Copy the root `.env.example` to `.env` and adjust the local PostgreSQL credentials if needed. The database role must be allowed to create a database.
2. Start a local PostgreSQL server. If Docker is installed, from the repository root run `docker compose up -d postgres`. Docker is optional; an installed local PostgreSQL server works too.
3. From the repository root, explicitly allow initialization and run the guarded importer:

   ```powershell
   $env:ALLOW_DB_INIT = 'marketkz-local-dev'
   npm --prefix server run db:init
   Remove-Item Env:ALLOW_DB_INIT
   ```

   The importer only accepts a database URL on loopback (`localhost`, `127.0.0.1`, or `::1`). It creates the target database if it does not exist. If the database already exists, it refuses to import when any user table exists. It does not drop tables or delete data. The source SQL's `CREATE DATABASE` line is skipped because the importer has already selected the target database. A successful import checks all seven tables, 50 rows per table (350 total), seven foreign keys, and all seven synchronized `SERIAL` sequences.

4. Install backend dependencies once, apply the additive authentication migration to the already initialized database, and run the API:

   ```powershell
   npm --prefix server install
   npm --prefix server run db:migrate
   npm --prefix server run dev
   ```

   `GET http://localhost:3001/api/health` checks the live database connection. Catalog endpoints are under `/api/v1`.

`db:migrate` adds password/role fields, a server session table, and nullable order delivery snapshots. It preserves existing marketplace records. Existing seeded users have no password hash and cannot use the old demo password. A trusted operator must assign admin role to a verified account; never grant it at registration. For integration tests, provision a separate database whose name ends in `_test`, import the fixture there using the guarded command above with `DATABASE_URL` pointed at that test database, then set `TEST_DATABASE_URL` to that URL before `npm --prefix server test`. Integration tests never initialize or modify the database themselves. Without `TEST_DATABASE_URL`, only the real-PostgreSQL integration suite is skipped; API unit tests do not claim database connectivity.

## Catalog API

- `GET /api/v1/categories` (also accepts a trailing slash)
- `GET /api/v1/categories/:categoryId`
- `GET /api/v1/categories/:categoryId/products`
- `GET /api/v1/products/:productId`
- `GET /api/v1/products?q=phone&categoryId=1&sortBy=price&sortOrder=asc&page=1&pageSize=20`

Product list responses include `items`, `page`, `pageSize`, `total`, and `totalPages`. Maximum `pageSize` is 100. `sortBy` is restricted to `id`, `price`, or `name`; values are never interpolated from arbitrary client input into SQL.

## Authentication API

- `POST /api/v1/auth/register` creates an ordinary account and starts a session.
- `POST /api/v1/auth/login` verifies a scrypt password hash and starts a session.
- `GET /api/v1/auth/me` returns the current session's public user profile.
- `POST /api/v1/auth/logout` revokes the session.
- `PATCH /api/v1/profile` updates the authenticated account's name, phone, and address only.

Sessions use `HttpOnly; SameSite=Lax` cookies and hashed random tokens in PostgreSQL. In production the cookie is also `Secure`.

To enable the local admin demonstration, register an ordinary account through the app. Then connect to the local database as its trusted owner, run the `SELECT` and targeted `UPDATE users SET role = 'admin' ... AND password_hash IS NOT NULL` examples in the root README, and verify exactly one row was updated. Never add role selection to registration or profile forms, and never commit database credentials.

## Orders API

- `POST /api/v1/orders` accepts product ids, quantities, delivery details, and a demo payment method. The server ignores client prices and totals, reads and locks current product rows, checks stock, decrements inventory, and writes the order, items, and Pending payment in one transaction. It never collects card credentials.
- `GET /api/v1/orders` returns order summaries, items, and payment status for the session user only.
- `GET /api/v1/orders/:orderId` returns an order only if it belongs to the session user; otherwise it returns 404.

## Admin MVP API

All routes below require a valid server session whose current database role is `admin`.

- `GET /api/v1/admin/orders` lists orders, buyers, items, and payment status (demonstration only).
- `GET /api/v1/admin/products` lists products.
- `POST /api/v1/admin/products` creates a validated product.
- `PATCH /api/v1/admin/products/:productId` updates a validated product.
- `DELETE /api/v1/admin/products/:productId` deletes an unreferenced product. PostgreSQL foreign keys protect products referenced by an order or review; those attempts return 409 without deleting related history.
