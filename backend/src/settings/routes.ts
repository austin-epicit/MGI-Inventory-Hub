import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { requireRole } from "../auth/middleware.js";
import {
	ACCOUNT_FINGERPRINT_KEY,
	accountFingerprint,
	decryptSecret,
	deleteCredentials,
	parseKey,
	saveCredentials,
} from "../cin7/credentials.js";
import {
	buildHttpSource,
	type SourceEnv,
	type SourceHandle,
	type SourceOpts,
} from "../cin7/sourceFactory.js";
import {
	Cin7AuthError,
	Cin7HttpError,
	Cin7ParseError,
	Cin7RateLimitError,
} from "../cin7/source.js";
import type { Db } from "../db.js";
import { createSuccessResponse, httpError } from "../http/responses.js";
import { validate } from "../http/validate.js";
import { resolveSyncDeps, type SyncRuntime } from "../sync/deps.js";
import { CIN7_ME_KEY, getCachedMe, runSync, type CachedMe } from "../sync/engine.js";
import { remapFromRaw } from "../sync/remap.js";
import { clearMirror, mirrorIsEmpty } from "../sync/reset.js";
import { withSyncLock } from "../sync/scheduler.js";
import { getSyncStatus } from "../sync/status.js";
import { getSetting, setSetting } from "./appSettings.js";

export type Cin7Wiring = {
	env: SourceEnv & { BACKFILL_MONTHS: number };
	resolveSource: () => Promise<SourceHandle | null>;
	// Tests swap the shared 55/min limiter for one that never waits.
	httpOpts?: SourceOpts;
};

type Deps = {
	db: Db;
	clock: () => Date;
	uploadsDir: string;
	log: SyncRuntime["log"];
	cin7: Cin7Wiring;
	timeZone?: string;
};

const mask = (id: string) => (id.length <= 4 ? "••••" : `••••${id.slice(-4)}`);

export const createSettingsRoutes = (deps: Deps, requireAuth: RequestHandler): Router => {
	const { db, clock, cin7 } = deps;
	const key = parseKey(cin7.env.ENCRYPTION_KEY);
	const router = Router();
	router.use(requireAuth, requireRole("admin"));

	const connection = async () => {
		const row = await db.cin7_connection.findUnique({ where: { id: 1 } });
		const me = await getCachedMe(db);
		// A rotated ENCRYPTION_KEY or a damaged row must not take the page down: the admin needs
		// the form to re-enter the credentials.
		let accountIdMasked: string | null = null;
		let unreadable = false;
		if (row) {
			try {
				accountIdMasked = mask(decryptSecret(row.account_id_enc, key));
			} catch {
				unreadable = true;
			}
		}
		return {
			source: cin7.env.CIN7_SOURCE,
			connected: row !== null,
			accountIdMasked,
			unreadable,
			verifiedAt: row?.verified_at?.toISOString() ?? null,
			company: me?.company ?? null,
			baseCurrency: me?.currency ?? null,
			timeZone: me?.timeZone ?? null,
		};
	};

	router.get("/cin7", async (_req, res) => {
		res.json(createSuccessResponse(await connection()));
	});

	router.put(
		"/cin7",
		validate({
			body: z.object({
				accountId: z.string().trim().min(1).max(200),
				applicationKey: z.string().trim().min(1).max(200),
				confirmReplace: z.boolean().optional(),
			}),
		}),
		async (req, res) => {
			const { confirmReplace, ...creds } = req.valid.body as {
				accountId: string;
				applicationKey: string;
				confirmReplace?: boolean;
			};
			// Throwaway source: retries run without sleeping, so a dead host fails in moments.
			const probe = buildHttpSource(cin7.env, creds, {
				...cin7.httpOpts,
				sleep: async () => {},
			});
			let me;
			try {
				me = await probe.me();
			} catch (e) {
				if (e instanceof Cin7AuthError)
					throw httpError(
						422,
						"CIN7_AUTH",
						"Cin7 rejected this Account ID and Application Key"
					);
				if (
					e instanceof Cin7HttpError ||
					e instanceof Cin7RateLimitError ||
					e instanceof Cin7ParseError
				)
					throw httpError(
						502,
						"CIN7_UNREACHABLE",
						"Could not reach Cin7. Check the connection and try again"
					);
				throw e;
			}
			const cached: CachedMe = {
				company: me.Company,
				currency: me.Currency,
				timeZone: me.TimeZone,
			};
			const save = async () => {
				await setSetting(db, CIN7_ME_KEY, cached);
				await setSetting(
					db,
					ACCOUNT_FINGERPRINT_KEY,
					accountFingerprint(creds.accountId)
				);
				await saveCredentials(db, key, creds, clock());
			};
			// Mirrored data belongs to one Cin7 account; mixing in another's would corrupt every total.
			// Demo data (no stored credentials) and unreadable ones count as a different account.
			// The fingerprint outlives Disconnect; the decrypted row covers installs saved before it.
			const incoming = accountFingerprint(creds.accountId);
			let sameAccount =
				(await getSetting<string>(db, ACCOUNT_FINGERPRINT_KEY)) ===
				incoming;
			const row = await db.cin7_connection.findUnique({ where: { id: 1 } });
			if (!sameAccount && row) {
				try {
					sameAccount =
						accountFingerprint(
							decryptSecret(row.account_id_enc, key)
						) === incoming;
				} catch {
					sameAccount = false;
				}
			}
			if (sameAccount) {
				await save();
			} else if (!confirmReplace && !(await mirrorIsEmpty(db))) {
				throw httpError(
					409,
					"ACCOUNT_CHANGED",
					"This is a different Cin7 account. Saving it replaces all mirrored data"
				);
			} else {
				const locked = await withSyncLock({ db, clock }, async () => {
					await clearMirror(db, clock());
					await deleteCredentials(db); // drops the old account's webhook tokens too
					await save();
				});
				if (!locked.acquired) throw busy();
			}
			res.json(createSuccessResponse(await connection()));
		}
	);

	router.delete("/cin7", async (_req, res) => {
		await deleteCredentials(db);
		res.json(createSuccessResponse(await connection()));
	});

	return router;
};

const busy = () =>
	httpError(409, "SYNC_BUSY", "A sync is already running. Try again when it finishes");

export const createSyncRoutes = (deps: Deps, requireAuth: RequestHandler): Router => {
	const { db, clock, log, cin7 } = deps;
	const runtime: SyncRuntime = {
		db,
		clock,
		log,
		uploadsDir: deps.uploadsDir,
		backfillMonths: cin7.env.BACKFILL_MONTHS,
		...(deps.timeZone ? { timeZone: deps.timeZone } : {}),
		resolveSource: cin7.resolveSource,
	};
	const router = Router();
	router.use(requireAuth);

	router.get("/status", async (_req, res) => {
		const fixture = cin7.env.CIN7_SOURCE === "fixture";
		const connected = fixture || (await db.cin7_connection.count()) > 0;
		res.json(
			createSuccessResponse(
				await getSyncStatus(db, {
					source: cin7.env.CIN7_SOURCE,
					connected,
					...(deps.timeZone ? { timeZone: deps.timeZone } : {}),
				})
			)
		);
	});

	router.post(
		"/run",
		requireRole("admin"),
		validate({
			body: z.object({ kind: z.enum(["incremental", "reconcile", "backfill"]) }),
		}),
		async (req, res) => {
			const syncDeps = await resolveSyncDeps(runtime);
			if (!syncDeps)
				throw httpError(
					409,
					"NOT_CONNECTED",
					"Connect Cin7 before syncing"
				);
			const { kind } = req.valid.body as {
				kind: "incremental" | "reconcile" | "backfill";
			};
			// 202 only once the lock is ours; the run itself continues after the response.
			let settle!: (acquired: boolean) => void;
			const acquired = new Promise<boolean>((r) => (settle = r));
			withSyncLock(syncDeps, async () => {
				settle(true);
				return runSync(syncDeps, kind, { trigger: "manual" });
			})
				.then((r) => {
					if (!r.acquired) settle(false);
				})
				.catch((err) => {
					log.error({ err }, "manual sync failed");
					settle(false);
				});
			if (!(await acquired)) throw busy();
			res.status(202).json(createSuccessResponse({ started: true, kind }));
		}
	);

	router.post(
		"/remap",
		requireRole("admin"),
		validate({ body: z.object({ entity: z.enum(["product", "purchase", "sale"]) }) }),
		async (req, res) => {
			const { entity } = req.valid.body as {
				entity: "product" | "purchase" | "sale";
			};
			const locked = await withSyncLock({ db, clock }, () =>
				remapFromRaw(db, entity)
			);
			if (!locked.acquired) throw busy();
			res.json(createSuccessResponse({ entity, ...locked.result }));
		}
	);

	return router;
};
