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

## Database
users, categories, products, orders, order_items, payments, reviews (see `src/types/database.ts`).
**PostgreSQL integration is not implemented yet.** Current mock rows are placeholders; paste the real seed rows into `src/data/mock.ts`.
