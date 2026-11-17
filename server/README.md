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

`db:migrate` reads only `TEST_DATABASE_URL` and accepts exactly localhost/127.0.0.1:5432/`market_db_test`. It never loads `.env` or falls back to `DATABASE_URL`. For a restored backup used to rehearse migrations, use the separate `db:migrate:copy` command with `MIGRATION_COPY_DATABASE_URL`; it accepts only localhost/127.0.0.1:5432/`market_db_migration_test`, and additionally requires the active TCP server address to be `127.0.0.1` and port `5432`. Neither runner can migrate `market_db`, and the existing `db:migrate` target remains unchanged. Integration tests use only `TEST_DATABASE_URL` and never initialize or migrate a database.

The restored-copy rehearsal applies migration files 001–007 in order through the same transaction and advisory lock used by the regular runner. Existing complete legacy schemas for 001 and 002 are recorded without rerunning their SQL; incomplete or incompatible definitions cause a rollback. The runner does not load migration URLs from `.env` and does not use generic database URL variables as fallbacks.

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

## Rule-based anomaly detection

Apply additive migrations `004_anomaly_incidents.sql` and `005_anomaly_queue_dead_letter.sql` through an explicitly reviewed migration process before deploying this backend phase. The repository migration runner is deliberately restricted to the local `market_db_test` database; it must not be used for production. Migration 004 does not rewrite existing data or replay historical `audit_logs`; migration 005 adds only nullable error/dead-letter metadata. A trigger places future audit inserts in `anomaly_event_queue` in the same transaction. The worker processes each queued event transactionally, links evidence to audit log IDs, retries failures with exponential backoff up to five attempts, then records a redacted error summary and dead-letter timestamp. It uses a per-subject advisory lock plus a partial unique index to avoid duplicate active incidents. `/api/health/ready` reports HTTP 503 until catalog and all required anomaly schema objects, including the enabled trigger and exact function body, are available. PostgreSQL integration tests run with `npm --prefix server run test:integration` only when a local `TEST_DATABASE_URL` points to a database ending in `_test`; the anomaly integration test additionally requires migrations 004 and 005 to be applied there. Tests never apply migrations automatically.

The initial thresholds default to five events: failed logins per known account in 120 seconds, authenticated administrative access denials per account in 120 seconds, and created orders per account in 300 seconds. Configure them with `ANOMALY_FAILED_LOGIN_THRESHOLD`, `ANOMALY_FAILED_LOGIN_WINDOW_SECONDS`, `ANOMALY_ADMIN_DENIED_THRESHOLD`, `ANOMALY_ADMIN_DENIED_WINDOW_SECONDS`, `ANOMALY_ORDER_THRESHOLD`, and `ANOMALY_ORDER_WINDOW_SECONDS`. `ANOMALY_POLL_INTERVAL_MS` defaults to 5000. Values are validated on startup. Risk scores are deterministic: base scores are 55, 65, and 50 for the three respective rules, plus 10 per event above threshold, capped at 100. Severity is MEDIUM 40–69, HIGH 70–89, CRITICAL 90–100 (LOW is reserved for future lower-scored detections). Recommendations are rule-based and require administrator judgment; no account or business action is taken automatically.

The experimental Jeffreys Divergence dashboard/API contract is not connected to the anomaly worker and cannot create incidents. `JEFFREYS_DETECTOR_ENABLED` defaults to `false`; the current endpoint remains non-operational even when set to `true` and reports `NOT_INTEGRATED`. Do not enable it as a production detector: the flag is reserved for a future implementation after real-data calibration and review. The contract endpoint is `GET /api/v1/admin/anomalies/statistical-status` and requires an administrator session.

### Jeffreys Shadow Mode (observational, local evaluation only)

Migration `006_jeffreys_shadow_mode.sql` adds a singleton checkpoint and `jeffreys_shadow_evaluations`. The shadow processor is a separate lifecycle from the rule worker, reads only bounded `SELECT` windows from `audit_logs`, and writes only those two tables. It does not use or update `anomaly_event_queue`, create incidents, or change any rule output. `JEFFREYS_SHADOW_MODE_ENABLED` defaults to `false`; when false, the processor does no database work. The existing `JEFFREYS_DETECTOR_ENABLED` flag and statistical-status endpoint contract are separate and unchanged.

Defaults are a 30-day baseline, 24-hour current window, daily evaluation cadence, one-hour allowed-lateness grace, alpha 0.5, minimums 50/20, at most 25 users per tick and 2,000 read events per window. A window exceeding the read cap is stored as `WORK_LIMIT_EXCEEDED` without a divergence. Event-time windows are half-open and ordered by `created_at`; a second account sweep catches rows committed during the first sweep. Rows that arrive after that verification pass and have timestamps in a finalized window are not retroactively replayed. Changing statistical profile parameters requires incrementing `JEFFREYS_SHADOW_PROFILE_VERSION`; the stored signature prevents silently reusing a checkpoint with different settings.

To evaluate locally, first set `TEST_DATABASE_URL` to the local database `market_db_test`, then apply pending migrations with the guarded command `npm --prefix server run db:migrate`. This runner refuses any other database and must not be used for production. In the backend PowerShell terminal, explicitly enable the separate processor:

```powershell
$env:JEFFREYS_SHADOW_MODE_ENABLED = 'true'
$env:JEFFREYS_SHADOW_PROFILE_VERSION = 'shadow-v1'
npm --prefix server run dev
```

Optional settings are `JEFFREYS_SHADOW_BASELINE_WINDOW_SECONDS`, `JEFFREYS_SHADOW_CURRENT_WINDOW_SECONDS`, `JEFFREYS_SHADOW_EVALUATION_CADENCE_SECONDS`, `JEFFREYS_SHADOW_ALLOWED_LATENESS_SECONDS`, `JEFFREYS_SHADOW_ALPHA`, `JEFFREYS_SHADOW_MIN_BASELINE_OBSERVATIONS`, `JEFFREYS_SHADOW_MIN_CURRENT_OBSERVATIONS`, `JEFFREYS_SHADOW_MAX_SUBJECTS_PER_TICK`, `JEFFREYS_SHADOW_MAX_EVENTS_PER_WINDOW`, and `JEFFREYS_SHADOW_POLL_INTERVAL_MS`. These produce measurements only; they do not define an anomaly threshold. Keep the mode off in production until the historical sample and calibration limitations are resolved.

### Jeffreys research materials

The standalone implementation in `src/jeffreys.ts` uses additive smoothing (`alpha = 0.5`) and the symmetric Jeffreys divergence formula. The research modules compare the existing five-category grouping with detailed-auth and calibration-frequency-based groupings, and provide chronological synthetic replay and independent validation. See [the synthetic grouping study](reports/jeffreys-grouping-comparison-results-v3.json), [independent synthetic validation](reports/jeffreys-independent-validation-results.json), and [the replay report](reports/jeffreys-replay-results.json). Every result in those three reports is synthetic and does not establish production detection quality.

The previously supplied anonymized historical sample is too sparse for standard calibration: 173 events across five pseudonymous users and 7 active UTC days produced zero sufficient windows at the tested standard minimums (30/10, 50/20, 100/40). The 5/1 exploratory setting yielded only one calibration and three holdout windows; no operational threshold was selected. These aggregate findings and their limitations are summarized in [the publication-safe real-data note](reports/jeffreys-publication-summary.md). Detailed historical replay output and source exports are intentionally not part of the repository because event sequences and timestamps remain sensitive even after pseudonymization.

For a future local-only analysis, follow the [export and pseudonymization guide](reports/jeffreys-neon-export-guide.md) and [offline replay guide](reports/jeffreys-offline-analysis-guide.md). Keep source CSV, pseudonymized event JSON, and per-window reports outside the repository. The offline runner refuses input and output paths inside the repository and never connects to a database.

Anomaly endpoints, all restricted to the existing administrator session and role:

- `GET /api/v1/admin/anomalies` with optional `page`, `pageSize`, `severity`, `type`, `status`, `from`, and `to` filters, plus severity counts.
- `GET /api/v1/admin/anomalies/:incidentId` for incident evidence and linked audit event IDs.
- `PATCH /api/v1/admin/anomalies/:incidentId/status` accepts `INVESTIGATING`, `RESOLVED`, or `FALSE_POSITIVE`; terminal statuses cannot be reopened through the API.

The existing authenticated admin WebSocket publishes `anomaly_incident` events. Events without a reliable account identifier are excluded from account-grouped rules; the implementation does not infer identity from forwarding headers or proxy IP addresses.
