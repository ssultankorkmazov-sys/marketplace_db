# MarketKZ
Modern marketplace frontend inspired by Kazakhstan e-commerce platforms (original branding).

## Run
`npm install` → `npm run dev` · build: `npm run build`

## Stack
React, TypeScript, Vite, Tailwind CSS 4, React Router, Lucide React

## Architecture
React UI → `src/services.ts` (async, mock) → `src/data/mock.ts` (mirrors marketplace_db tables).
To go live, replace the bodies of service functions with `fetch('/api/...')`; UI stays unchanged.
Cart and favorites live in localStorage (not in the DB schema). `CURRENT_USER_ID = 1` is a mock login.

## Auth & admin (frontend demo only - NOT secure)
- `src/authService.ts`: register / login / logout / getSession. Session in `marketkz_auth`, demo passwords in `marketkz_credentials` (never on the DB-shaped `users` rows).
- Demo admin: `admin@marketkz.kz` / `admin123` (`admin@marketz.kz` is accepted as an alias). Seeded DB users sign in with the demo password `user123`.
- Routes: `/login`, `/register`, `/admin`, `/admin/products|categories|orders|users|reviews` (admin only; others are redirected).
- All tables are persisted in localStorage (`marketkz_users|products|categories|reviews|orders|order_items|payments`), seeded from `src/data/mock.ts` on first use.
  After changing `mock.ts`, bump `SEED_VERSION` in `src/data/store.ts` so returning visitors are re-seeded once.

## Tests
`npm test` runs the vitest + jsdom suite in `tests/` (seed data vs spec, referential integrity, auth, reviews, admin CRUD, access control, basename routing).

## Database & seed data
Source of truth: `db/marketplace_db.sql` (schema + 350 INSERT rows: 50 each in users, categories, products, orders, order_items, payments, reviews).
`src/data/mock.ts` is GENERATED from it - never edit by hand:

    npm run seed:generate     # db/marketplace_db.sql -> src/data/mock.ts
    # then bump SEED_VERSION in src/data/store.ts

SERIAL ids are assigned 1..n in INSERT order; DECIMAL columns are numbers; timestamps become `YYYY-MM-DDTHH:mm:ss`.

**localStorage migration.** On load, a browser whose stored seed version differs from `SEED_VERSION` (or that predates versioning) gets the old seed rows replaced
by the current ones. Users registered by visitors (user_id > 50) with their orders, payments, reviews and demo credentials are kept; rows made under an old
placeholder identity are dropped. Products/categories are left as they are (admin edits survive). **Dev reset:** admin dashboard -> "Сбросить демо-данные"
(`resetAllData()` in `src/data/store.ts`) wipes all marketkz_* data and re-seeds.

PostgreSQL integration is not implemented; the service layer (`src/services.ts`) is the seam to replace with REST calls.
