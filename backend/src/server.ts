import "dotenv/config";
import path from "node:path";
import { createApp } from "./app.js";
import { getCin7Source } from "./cin7/sourceFactory.js";
import { getDb } from "./db.js";
import { parseEnv } from "./env.js";
import { log } from "./log.js";
import { resolveSyncDeps } from "./sync/deps.js";
import { startScheduler } from "./sync/scheduler.js";
import { checkWebhooks } from "./webhooks/register.js";
import { parseKey } from "./cin7/credentials.js";

const env = parseEnv(process.env);
// A relative UPLOADS_DIR (local dev) is relative to the backend folder, where npm runs.
const uploadsDir = path.resolve(process.cwd(), env.UPLOADS_DIR);
const db = getDb(env.DATABASE_URL);
const resolveSource = () => getCin7Source(db, env);
const app = createApp({
	cin7: { env, resolveSource },
	db,
	clock: () => new Date(),
	publicBaseUrl: env.PUBLIC_BASE_URL,
	timeZone: env.APP_TIMEZONE,
	uploadsDir,
	trustProxy: env.TRUST_PROXY,
	auth: {
		jwtSecret: env.JWT_SECRET,
		sessionTtlHours: env.SESSION_TTL_HOURS,
		setupToken: env.SETUP_TOKEN,
		secureCookie: env.NODE_ENV === "production",
	},
});

app.listen(env.PORT, () => log.info({ port: env.PORT }, "API listening"));

// Resolved on every tick, so credentials saved in Settings start syncing without a restart.
const runtime = {
	db,
	clock: () => new Date(),
	log,
	uploadsDir,
	backfillMonths: env.BACKFILL_MONTHS,
	timeZone: env.APP_TIMEZONE,
	resolveSource,
};
startScheduler(
	() => resolveSyncDeps(runtime),
	{
		intervalMs: 300_000,
		nightlyAt: "02:00",
		timezone: env.APP_TIMEZONE,
		onNightly: (d) => checkWebhooks({ ...d, key: parseKey(env.ENCRYPTION_KEY) }),
	},
	log
);
