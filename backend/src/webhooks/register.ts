import crypto from "node:crypto";
import type { Cin7Webhook } from "../cin7/schemas.js";
import { decryptSecret, encryptSecret } from "../cin7/credentials.js";
import { Cin7HttpError, Cin7ParseError, type Cin7Source, type NewWebhook } from "../cin7/source.js";
import type { Db } from "../db.js";
import { getSetting, setSetting } from "../settings/appSettings.js";
import { runSync, type SyncDeps } from "../sync/engine.js";
import { withSyncLock } from "../sync/scheduler.js";

// The decision memo's list: events that change a record we mirror.
export const WEBHOOK_TYPES = [
	"Sale/OrderAuthorised",
	"Sale/InvoiceAuthorised",
	"Sale/CreditNoteAuthorised",
	"Sale/Voided",
	"Sale/Undo",
	"Purchase/OrderAuthorised",
	"Purchase/StockReceivedAuthorised",
	"Purchase/InvoiceAuthorised",
	"Purchase/Updated",
	"Product/Updated",
] as const;

export type WebhookDeps = SyncDeps & { key: Buffer };

export class NotConnectedError extends Error {
	constructor() {
		super("Cin7 is not connected");
		this.name = "NotConnectedError";
	}
}

export const STATE_KEY = "cin7.webhooks";
export type WebhookState = {
	registeredAt: string;
	types: { type: string; active: boolean }[];
	lastCheckAt: string | null;
	reactivatedAt: string | null;
	reactivatedTypes: string[];
};

export const getWebhookState = (db: Db) => getSetting<WebhookState>(db, STATE_KEY);
const saveState = (db: Db, s: WebhookState) => setSetting(db, STATE_KEY, s);

const PATH = "/api/webhooks/cin7";
const callbackUrl = (base: string, token: string, type: string) =>
	`${base.replace(/\/+$/, "")}${PATH}/${token}/${type}`;
const random = (bytes: number) => crypto.randomBytes(bytes).toString("base64url");

// A POST that errored may still have landed: network failures, 5xx, or an unreadable answer.
const ambiguous = (e: unknown) =>
	e instanceof Cin7ParseError ||
	(e instanceof Cin7HttpError && (e.status === 0 || e.status === 599 || e.status >= 500));

const sameHook = (w: NewWebhook) => (h: Cin7Webhook) =>
	h.Type === w.Type && h.ExternalURL === w.ExternalURL;

async function createOnce(source: Cin7Source, w: NewWebhook): Promise<Cin7Webhook> {
	try {
		return await source.webhooks.create(w);
	} catch (e) {
		if (!ambiguous(e)) throw e;
		// Cin7 may have created it before the answer was lost: reuse a match, never double up.
		const found = (await source.webhooks.list()).find(sameHook(w));
		return found ?? source.webhooks.create(w);
	}
}

async function credentials(db: Db) {
	const row = await db.cin7_connection.findUnique({ where: { id: 1 } });
	if (!row) throw new NotConnectedError();
	return { row, token: row.webhook_path_token, bearer: row.webhook_bearer_enc };
}

const stateOf = (
	hooks: { Type: string; IsActive: boolean }[],
	prev: Partial<WebhookState>,
	at: Date
): WebhookState => ({
	registeredAt: prev.registeredAt ?? at.toISOString(),
	types: WEBHOOK_TYPES.map((type) => ({
		type,
		active: hooks.find((h) => h.Type === type)?.IsActive ?? false,
	})),
	lastCheckAt: prev.lastCheckAt ?? null,
	reactivatedAt: prev.reactivatedAt ?? null,
	reactivatedTypes: prev.reactivatedTypes ?? [],
});

// Creates or updates one bearer-auth webhook per type. The path token and bearer are made once
// and reused, so webhooks registered earlier keep working after a second click.
export async function registerWebhooks(
	deps: WebhookDeps,
	publicBaseUrl: string
): Promise<WebhookState> {
	const { db, source, key } = deps;
	const { token: storedToken, bearer: storedBearer } = await credentials(db);
	const token = storedToken ?? random(24);
	const bearer = storedBearer ? decryptSecret(storedBearer, key) : random(32);
	if (!storedToken || !storedBearer)
		await db.cin7_connection.update({
			where: { id: 1 },
			data: {
				webhook_path_token: token,
				webhook_bearer_enc: encryptSecret(bearer, key),
			},
		});

	const existing = await source.webhooks.list();
	const done: Cin7Webhook[] = [];
	for (const type of WEBHOOK_TYPES) {
		const desired: NewWebhook = {
			Type: type,
			IsActive: true,
			ExternalURL: callbackUrl(publicBaseUrl, token, type),
			ExternalAuthorizationType: "bearerauth",
			ExternalBearerToken: bearer,
		};
		const mine = existing.find(sameHook(desired));
		// Always PUT a match: Cin7 may not echo the bearer, so it cannot be compared.
		done.push(
			mine
				? await source.webhooks.update({ ...mine, ...desired })
				: await createOnce(source, desired)
		);
	}
	const prev = (await getWebhookState(db)) ?? {};
	const state = stateOf(
		done,
		{ ...prev, lastCheckAt: deps.clock().toISOString() },
		deps.clock()
	);
	await saveState(db, state);
	return state;
}

// Nightly: Cin7 deactivates a webhook after ~76 minutes of failed deliveries. Turn them back on,
// then reconcile, because events were lost while they were off.
export async function checkWebhooks(deps: WebhookDeps): Promise<void> {
	const { db, source, key, log } = deps;
	const prev = await getWebhookState(db);
	if (!prev) return; // never registered: nothing to watch
	const { token, bearer: bearerEnc } = await credentials(db);
	if (!token || !bearerEnc) return;
	const bearer = decryptSecret(bearerEnc, key);

	const marker = `${PATH}/${token}/`;
	const ours = (await source.webhooks.list()).filter((h) => h.ExternalURL.includes(marker));
	const reactivated: string[] = [];
	const result: Cin7Webhook[] = [];
	for (const hook of ours) {
		if (hook.IsActive) {
			result.push(hook);
			continue;
		}
		try {
			result.push(
				await source.webhooks.update({
					...hook,
					IsActive: true,
					ExternalAuthorizationType: "bearerauth",
					ExternalBearerToken: bearer,
				})
			);
			reactivated.push(hook.Type);
		} catch (err) {
			log.warn({ err, type: hook.Type }, "could not reactivate webhook");
			result.push(hook);
		}
	}
	const now = deps.clock().toISOString();
	await saveState(db, {
		...stateOf(result, prev, deps.clock()),
		lastCheckAt: now,
		...(reactivated.length
			? { reactivatedAt: now, reactivatedTypes: reactivated }
			: {}),
	});
	if (reactivated.length === 0) return;
	log.warn({ types: reactivated }, "webhooks were inactive and have been reactivated");
	const locked = await withSyncLock(deps, () =>
		runSync(deps, "reconcile", { trigger: "schedule" })
	);
	if (!locked.acquired) log.info("webhook reconcile skipped: another sync holds the lock");
}
