# CLAUDE.md

## Purpose

MGI Inventory Hub: a standalone internal app mirroring an IT-equipment reseller's Cin7 inventory (products, PO/SO, stock, cost and price history). Separate from TradeWorks/HVAC; never edit that repo. Plan and decisions: `docs/superpowers/` (plans, specs).

## Rules

- **Claude never runs git writes in this repo** (`add`, `commit`, `push`, `stash`, `init`). Austin commits.
- Never run `prisma format`; use `prisma migrate dev --name <name>` for migrations. Never `migrate reset` on start or in compose.
- Comments: non-obvious WHY only, one or two lines, trailing `//` preferred.
- Prettier: double quotes, tabs width 8, print width 100. TypeScript strict, ES2020. ESLint TS (+ react-hooks in frontend).

## Invariants

- Same-origin app: the web server serves the SPA and proxies `/api`. Session = httpOnly `mgi_session` cookie; no tokens in `localStorage`. Unsafe `/api` requests (except `/api/webhooks`) pass `requireSameOrigin`.
- Every JSON endpoint returns `{ success, data, error: { code, message } | null, meta? }` (exceptions: image bytes, webhook ack).
- Cin7 is reached only through `Cin7Source`; the HTTP source sends GET only (except `/webhooks`). Every Cin7 call, attachment downloads included, shares one limiter: 55 calls/min.
- Money columns `Decimal(18,4)`, rates `Decimal(18,6)`; charts/KPIs read only `*_base` columns; API money = JSON numbers rounded to 4 dp.
- Cin7 business dates (`OrderDate`, `InvoiceDate`) are `@db.Date`, serialized `"YYYY-MM-DD"`, never time-zone shifted. Other timestamps `timestamptz`, ISO UTC.
- Time zone and base currency come from Cin7 `GET /me`, cached in `app_setting`; `APP_TIMEZONE` is the fallback.
- A tier price of 0 means "not set". Voided/draft orders stay listed but never feed charts or KPIs. Foreign-currency orders plot in base currency. A failed sync keeps the last good data.
- Price vocabulary: **Purchase cost**, **Average cost**, **List price — <tier>**, **Sold price — <tier>**.
- Every operating action has a UI path; env values are one-time deploy config only.
- UI: dark zinc base, blue `#3b82f6` primary, red only for destructive/error, Inter 400-700, motion <= 200 ms ease-out, dense tables. Load the `dataviz` skill before chart code.

## Commands

```bash
cd backend
npm run dev            # tsx watch, :3100
npm run build          # prisma generate + tsc
npm test               # vitest (migrates mgi_test first); npx vitest run <path>
npm run typecheck      # tsc --noEmit
npm run lint
npm run migrate:deploy
cd ../frontend
npm run dev            # :5180, proxies /api to :3100
npm run build          # tsc -b && vite build
npx tsc --noEmit -p tsconfig.app.json
npx vitest run
```

Ports: api 3100, web 5180, Postgres 5440 (`.dev/` holds the local cluster; leave it alone), fake Cin7 4010.

Docker is not available on the dev machine (the CLI hangs; do not run docker or compose). The local Postgres 18 cluster in `.dev/pgdata` (port 5440, trust auth, databases `mgi` and `mgi_test`) is started with `pg_ctl` (`pg_ctl -D .dev/pgdata -o "-p 5440" -l .dev/pg.log start`; binaries under `E:\Code Things\PostgreSQL\18\bin`). Never drop or recreate it.

## Structure

Backend `src/`: `server app env db log`, `http/`, `auth/`, `users/`, `settings/`, `cin7/` (source abstraction, limiter, credentials), `sync/` (engine, scheduler, lock, remap), `images/`, `products/ purchases/ sales/ overview/`, `webhooks/`; `backend/fixtures/` (demo data, fake Cin7); `backend/test/` (globalSetup migrates `TEST_DATABASE_URL`; helpers `resetDb`, `testApp`). Frontend `src/`: `lib/ auth/ layout/ components/ features/{overview,products,purchases,sales,settings}/ types/`. Plans and specs: `docs/superpowers/`.

## Production (operator notes)

- `docker-compose.prod.yml` + `.env.prod` (from `.env.prod.example`, never committed): Caddy (`web`, `frontend/Dockerfile` target `prod`, domain from `DOMAIN`) proxies `/api` to `api`; `db` Postgres 17; `backup` sidecar (`docker/backup.sh`: daily dump + uploads archive, 30 days); json-file logs 50m x 14 files. Run: `docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build`. The local `docker-compose.yml` builds the `dev` target of the same frontend Dockerfile.
- Production env: `NODE_ENV=production`, `CIN7_SOURCE=http` (fixture is refused unless `ALLOW_DEMO_DATA=true`), `TRUST_PROXY=1`, `PUBLIC_BASE_URL=https://<domain>` (same-origin checks and webhook callback URL).
- **Sync lock requirement:** the sync lock is a transaction-scoped advisory lock held on one idle-in-transaction connection for the whole run (up to `LOCK_HOLD_MS`, 24 h). Postgres `idle_in_transaction_session_timeout` must be 0 or longer than the longest sync run (the compose file sets 0), and no proxy/NAT between api and db may drop idle connections (TCP keepalives are set). Violating this loses the lock silently and lets two syncs overlap.
- No secrets in the compose file or README. Losing `ENCRYPTION_KEY` means re-entering the Cin7 credentials.
- `README.md` holds the UI-only operating guide plus the Deploying section; keep its UI labels in step with the Settings cards.
