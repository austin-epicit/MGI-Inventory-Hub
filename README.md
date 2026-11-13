# MGI Inventory Hub

Internal web app that mirrors an IT-equipment reseller's Cin7 inventory data: products, purchase and sales orders, stock, and cost/price history. Express 5 + Prisma 7 + Postgres backend, React frontend. Read-only toward Cin7 (the only write is registering webhooks).

## Using the app

Everything below is done in the browser. The only server-side values are the one-time deploy settings in `.env.prod`.

### First-run setup

1. Open `https://<your domain>/setup`. This page works only until the first admin exists.
2. Enter the **Setup token** (the `SETUP_TOKEN` the operator put in `.env.prod`), your name, email, and a password of 12+ characters, then create the admin.
3. You are signed in. The header shows **Cin7 not connected** until the next section is done.

### Connect Cin7

1. Go to **Settings → Cin7 connection** (admins only).
2. Enter the **Account ID** and **Application Key** from Cin7, then **Save and verify**. The key is checked against Cin7 before it is saved, and stored encrypted.
3. The first sync starts within a few minutes (or press **Sync now** under Sync status). The first load reads up to 24 months of history and respects Cin7's rate limit, so it can take a while; **Settings → Sync status → Initial load** shows progress per data type.

To replace a key, use **Replace credentials** on the same card. **Disconnect** stops syncing and deletes the saved key; data already copied stays. Reconnecting the same account resumes syncing where it left off; reconnecting a different one asks before replacing. Saving a **different Cin7 account** while data is mirrored asks for confirmation first ("Replace it and clear all mirrored data?"): confirming deletes every mirrored product, order, stock level, price snapshot, sync cursor, skipped-record entry and webhook state, and the new account backfills from scratch. Picture files already on disk are left in place (they are keyed by Cin7 attachment ID and are never shown for the new account). Webhooks registered in the old Cin7 account are not removed from it; delete them there. Re-saving the same account (for example a rotated key) keeps everything.

### Read the sync status

- **The header** (top of every page) shows when data was last synced. Neutral: healthy. **Amber**: no successful sync for over 30 minutes, or some records could not be synced, or records are quarantined ("N records skipped"). **Red, "Sync failing"**: the last run failed, with the reason (for example Cin7 rejected the saved credentials, Cin7 could not be reached, rate limit reached).
- **Settings → Sync status** has the last successful sync, the last run (Running, Partial, Failed), the initial-load progress, **Sync now**, and the **Rebuild from stored data** buttons (Products, Purchase orders, Sales orders). Rebuild re-reads what is already stored, makes no Cin7 calls, and blocks other syncs until done; use it only if asked to.
- Syncing runs on its own about every 5 minutes plus a nightly full check. When a sync fails, the last good data stays on screen; nothing is wiped.

### Invite users

1. **Settings → Users**, fill in name, email and **Role** (Viewer or Admin), then **Create invite link**.
2. Copy the link and send it to the person yourself (the app does not send email). They open it and choose a password.
3. For a forgotten password use **Reset link** on that user's row; **New invite link** reissues an unused invite. **Deactivate** removes access.

Viewers can read everything but do not see Settings. Admins can also change Settings and manage users.

### Register webhooks (optional)

Webhooks make Cin7 changes appear within about a minute instead of at the next 5-minute sync. They need Cin7 **Advanced Automations**; without it nothing here is needed and syncing works the same.

1. Connect Cin7 first.
2. **Settings → Cin7 webhooks → Register webhooks**.
3. The card lists each webhook as Active or not. If some are inactive, fix them in Cin7 and use **Register again**; registering twice is safe.

The address Cin7 calls back is built from the deployment's public URL, so it only works when the app is reachable from the internet.

### What "Demo data" means

A header badge reading **Demo data** means the app is serving generated sample records, not your Cin7 data. It appears on local or demo setups only. A production deployment never shows it: the server refuses to start on demo data unless the operator turned it on deliberately. If you see it on the live site, tell the operator.

## Deploying (operator)

Needs a server with Docker, a domain name pointing at it, and ports 80 and 443 open to the internet (Caddy gets the HTTPS certificate on its own). Hosting provider and domain are not prescribed.

```bash
cp .env.prod.example .env.prod      # fill in every value; never commit this file
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
```

Then open `https://<DOMAIN>/setup` and follow the first-run steps above. Database migrations apply automatically on start (`migrate deploy` only; never reset). Keep `ENCRYPTION_KEY` backed up somewhere other than the server. With `NODE_ENV=production` the server refuses to start unless `CIN7_BASE_URL` is an `https://` URL (the Application Key travels in a header).

### What runs

| Service  | Role                                                             |
| -------- | ---------------------------------------------------------------- |
| `web`    | Caddy: HTTPS, serves the built app, proxies `/api` to `api`      |
| `api`    | Express API, sync scheduler; `CIN7_SOURCE=http`, `TRUST_PROXY=1` |
| `db`     | Postgres 17, volume `pgdata`; not published to the network       |
| `backup` | Daily `pg_dump` plus a `tar.gz` of the `uploads` volume          |

### Backups

The `backup` service writes to the `backups` volume once a day (03:00 UTC by default; `BACKUP_HOUR_UTC`), plus one right after first start: `mgi-db-<timestamp>.dump` and `mgi-uploads-<timestamp>.tar.gz`. Files older than 30 days are deleted. Old files are pruned only after a new backup fully succeeds. A failed backup logs `backup FAILED (<step>)` (steps: pg_dump, rename dump, uploads archive, rename uploads archive, prune). If the dump succeeded but a later step failed, the finished `.dump` stays and is pruned with the rest after 30 days. The failure shows in the `backup` service log and the service keeps running. Check with `docker compose --env-file .env.prod -f docker-compose.prod.yml logs backup`, and look for a `backup <timestamp> done` line from the last day. The `backups` volume lives on the same machine as the database, so also copy it off the server (provider snapshots or a scheduled copy), or a disk failure loses both.

Restore needs host access; there is no UI for it. In short: stop `api` and `web`, restore the chosen `.dump` into the `db` service with `pg_restore --clean --if-exists`, unpack the matching `.tar.gz` into the `uploads` volume, start everything again. After a restore the app re-syncs from Cin7 on its own, and product pictures come back from the uploads archive. The `.env.prod` secrets are not in the backups: restoring onto a new server needs the original `ENCRYPTION_KEY`, or the Cin7 credentials must be re-entered under Settings → Cin7 connection.

### Logs

Each service uses Docker's `json-file` driver with `max-size: 50m` and `max-file: 14`. Docker rotates by size, not by date, so "14 days" is approximated as 14 rotated files per service: a service that writes about 50 MB or less per day keeps at least 14 days; a busier one rotates faster and keeps fewer. Raise `max-size` in `docker-compose.prod.yml` if you need a firm 14 days.

### Postgres settings that matter

The sync lock is held on one connection that stays idle inside a transaction for the length of a sync run. `idle_in_transaction_session_timeout` is set to 0 (off) in the compose file and must never be set below the longest sync run (the first backfill can be long), and any proxy or NAT between `api` and `db` must not drop idle connections. The compose file also enables TCP keepalives for this reason. If the lock were lost the app would not notice: two syncs could overlap. The lock does not last for an unlimited run: the transaction holding it is capped at 24 hours. A run that is still going after 24 hours (a very long first backfill) loses the lock, so a scheduled or manual sync can start alongside it. Writes are idempotent upserts, so the data stays correct, and an interrupted backfill continues from its saved page on the next run, but two runs together make the sync slower and may report errors. If a backfill ever nears 24 hours, lower `BACKFILL_MONTHS` before the first sync.

## Local development

```bash
cd backend
cp .env.example .env        # fill in the three secrets
npm install
npx prisma migrate deploy
npm run dev                 # http://localhost:3100/api/health
```

Postgres is expected on `localhost:5440` (`docker compose up db` provides it, with `mgi` and `mgi_test`). `docker-compose.yml` is the local stack (demo data, dev server); `docker-compose.prod.yml` is production.

### Try it against the fake Cin7

To exercise real syncing locally without a Cin7 account, layer the fake server over the local stack:

```bash
docker compose -f docker-compose.yml -f docker-compose.fake.yml --profile fake up -d
```

The overlay switches the api to `CIN7_SOURCE=http` and points it at the fake server on port 4010 (and sets `NODE_ENV=development`). Then open **Settings → Cin7 connection** and enter Account ID `fake-account-id` and Application Key `fake-application-key`, then **Save and verify**. Drop `docker-compose.fake.yml` from the command to go back to demo data.

### Tests

```bash
cd backend && npm test      # migrates mgi_test, then runs vitest against it
cd frontend && npx vitest run
```

Ports: api 3100, web 5180, Postgres 5440, fake Cin7 4010.
