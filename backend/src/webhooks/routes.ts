import express, { Router, type ErrorRequestHandler, type RequestHandler } from "express";
import { requireRole } from "../auth/middleware.js";
import { decryptSecret, parseKey } from "../cin7/credentials.js";
import {
	Cin7AuthError,
	Cin7HttpError,
	Cin7ParseError,
	Cin7RateLimitError,
} from "../cin7/source.js";
import type { Db } from "../db.js";
import { createSuccessResponse, httpError } from "../http/responses.js";
import type { Cin7Wiring } from "../settings/routes.js";
import { resolveSyncDeps, type SyncRuntime } from "../sync/deps.js";
import {
	createWebhookRunner,
	DEBOUNCE_MS,
	extractTargets,
	parseTolerant,
	safeEqual,
	type WebhookRunner,
} from "./receiver.js";
import { getWebhookState, NotConnectedError, registerWebhooks } from "./register.js";

export type WebhookRouteDeps = {
	db: Db;
	clock: () => Date;
	log: SyncRuntime["log"];
	uploadsDir: string;
	cin7: Cin7Wiring;
	publicBaseUrl: string;
	timeZone?: string;
};

const runtimeOf = (deps: WebhookRouteDeps): SyncRuntime => ({
	db: deps.db,
	clock: deps.clock,
	log: deps.log,
	uploadsDir: deps.uploadsDir,
	backfillMonths: deps.cin7.env.BACKFILL_MONTHS,
	...(deps.timeZone ? { timeZone: deps.timeZone } : {}),
	resolveSource: deps.cin7.resolveSource,
});

export const createDefaultRunner = (deps: WebhookRouteDeps): WebhookRunner => {
	const runtime = runtimeOf(deps);
	return createWebhookRunner({
		db: deps.db,
		log: deps.log,
		resolveDeps: () => resolveSyncDeps(runtime),
		debounceMs: DEBOUNCE_MS,
	});
};

const MAX_BODY = "5mb";
const TYPE_MAX = 200;

// Cin7 deactivates a webhook that keeps failing, so once the caller is authenticated every
// outcome is a 2xx; problems are recorded on the event instead.
export const createWebhookReceiver = (deps: WebhookRouteDeps, runner: WebhookRunner): Router => {
	const { db, clock, log } = deps;
	const router = Router();

	const authenticate: RequestHandler = async (req, _res, next) => {
		const row = await db.cin7_connection.findUnique({ where: { id: 1 } });
		const token = row?.webhook_path_token;
		if (!row || !token || !safeEqual(token, String(req.params.pathToken ?? "")))
			throw httpError(404, "NOT_FOUND", "Not found");
		const header = req.headers.authorization ?? "";
		const given = header.startsWith("Bearer ") ? header.slice(7) : "";
		let ok = false;
		try {
			const bearer = decryptSecret(
				row.webhook_bearer_enc ?? "",
				parseKey(deps.cin7.env.ENCRYPTION_KEY)
			);
			ok = safeEqual(bearer, given);
		} catch {
			// Unreadable secret: nothing can authenticate.
		}
		if (!ok) throw httpError(401, "UNAUTHENTICATED", "Invalid credentials");
		next();
	};

	// Raw text: strict JSON parsing would bounce the trailing-comma bodies Cin7 sends.
	const text = express.text({ type: () => true, limit: MAX_BODY });

	router.post("/cin7/:pathToken/*type", authenticate, text, async (req, res) => {
		const type = [req.params.type as unknown as string[]]
			.flat()
			.join("/")
			.slice(0, TYPE_MAX);
		const body = typeof req.body === "string" ? req.body : "";
		const payload = parseTolerant(body);
		const targets = payload === undefined ? undefined : extractTargets(type, payload);
		const ids = targets ? Object.values(targets).flat() : [];
		const ignored = targets === undefined;
		const reason =
			payload === undefined
				? "Body is not readable JSON"
				: "Not a type this app syncs, or no record ID in the payload";
		try {
			const event = await db.webhook_event.create({
				data: {
					type,
					record_ids: ids,
					received_at: clock(),
					status: ignored ? "ignored" : "received",
					error: ignored ? reason : null,
				},
			});
			if (targets) runner.enqueue(targets, event.id);
		} catch (err) {
			// The nightly reconcile covers a lost event; failing here would count against Cin7's retries.
			log.error({ err, type }, "could not record webhook event");
		}
		res.status(200).json({ received: true });
	});

	const ack: ErrorRequestHandler = (err, _req, res, next) => {
		if (typeof err?.statusCode === "number" && err.statusCode < 500 && err.code)
			return next(err); // auth failures keep their status
		log.warn({ err }, "webhook body rejected");
		res.status(200).json({ received: true });
	};
	router.use(ack);
	return router;
};

const refused = () =>
	httpError(
		422,
		"WEBHOOKS_REFUSED",
		"Cin7 refused the webhook registration. This needs Cin7 Advanced Automations on the account"
	);

export const createWebhookAdminRoutes = (
	deps: WebhookRouteDeps,
	requireAuth: RequestHandler
): Router => {
	const { db, cin7 } = deps;
	const key = parseKey(cin7.env.ENCRYPTION_KEY);
	const router = Router();
	router.use(requireAuth, requireRole("admin"));

	const view = async () => {
		const [state, last] = await Promise.all([
			getWebhookState(db),
			db.webhook_event.findFirst({
				orderBy: { received_at: "desc" },
				select: { received_at: true },
			}),
		]);
		return {
			registered: state !== null,
			types: state?.types ?? [],
			registeredAt: state?.registeredAt ?? null,
			lastCheckAt: state?.lastCheckAt ?? null,
			reactivatedAt: state?.reactivatedAt ?? null,
			reactivatedTypes: state?.reactivatedTypes ?? [],
			lastEventAt: last?.received_at.toISOString() ?? null,
		};
	};

	router.get("/", async (_req, res) => {
		res.json(createSuccessResponse(await view()));
	});

	router.post("/register", async (_req, res) => {
		const syncDeps = await resolveSyncDeps(runtimeOf(deps));
		if (!syncDeps)
			throw httpError(
				409,
				"NOT_CONNECTED",
				"Connect Cin7 before registering webhooks"
			);
		try {
			await registerWebhooks({ ...syncDeps, key }, deps.publicBaseUrl);
		} catch (e) {
			if (e instanceof NotConnectedError)
				throw httpError(
					409,
					"NOT_CONNECTED",
					"Connect Cin7 before registering webhooks"
				);
			if (
				e instanceof Cin7AuthError ||
				(e instanceof Cin7HttpError && e.status < 500 && e.status > 0)
			)
				throw refused();
			if (
				e instanceof Cin7HttpError ||
				e instanceof Cin7RateLimitError ||
				e instanceof Cin7ParseError
			)
				throw httpError(
					502,
					"CIN7_UNREACHABLE",
					"Could not reach Cin7. Try again shortly"
				);
			throw e;
		}
		res.json(createSuccessResponse(await view()));
	});

	return router;
};
