import crypto from "node:crypto";
import type { Logger } from "pino";
import type { Db } from "../db.js";
import { runSync, type SyncDeps, type SyncTargets } from "../sync/engine.js";
import { withSyncLock } from "../sync/scheduler.js";

export const DEBOUNCE_MS = 15_000;

// Equal-length buffers or a plain false: timingSafeEqual throws on a length mismatch.
export function safeEqual(a: string, b: string): boolean {
	const x = Buffer.from(a);
	const y = Buffer.from(b);
	return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Cin7 payload samples carry trailing commas, so strict JSON is only the first attempt.
function stripTrailingCommas(text: string): string {
	let out = "";
	let inString = false;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i]!;
		if (inString) {
			out += ch;
			if (ch === "\\") out += text[++i] ?? "";
			else if (ch === '"') inString = false;
			continue;
		}
		if (ch === '"') inString = true;
		else if (ch === ",") {
			let j = i + 1;
			while (j < text.length && /\s/.test(text[j]!)) j++;
			if (text[j] === "}" || text[j] === "]") continue;
		}
		out += ch;
	}
	return out;
}

export function parseTolerant(text: string): unknown {
	for (const candidate of [text, stripTrailingCommas(text)]) {
		try {
			return JSON.parse(candidate);
		} catch {
			// try the next form
		}
	}
	return undefined;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

// Cin7 ids arrive in either case; the mirror stores them lowercase.
const idsOf = (values: unknown[]): string[] => [
	...new Set(
		values
			.filter((v): v is string => typeof v === "string" && v.trim() !== "")
			.map((v) => v.trim().toLowerCase())
	),
];

const firstOf = (o: Record<string, unknown>, keys: string[]): unknown[] => {
	for (const k of keys) if (typeof o[k] === "string" && o[k] !== "") return [o[k]];
	return [];
};

// The *DetailsList arrays on the Updated events hold the full records; only their ids are used.
const listedIds = (o: Record<string, unknown>): unknown[] =>
	Object.entries(o)
		.filter(([k, v]) => k.endsWith("DetailsList") && Array.isArray(v))
		.flatMap(([, v]) => (v as unknown[]).map((e) => (isObject(e) ? e.ID : undefined)));

export function extractTargets(type: string, payload: unknown): SyncTargets | undefined {
	let targets: SyncTargets = {};
	if (type === "Stock/AvailableStockLevelChanged") {
		if (Array.isArray(payload))
			targets = {
				products: idsOf(
					payload.map((e) => (isObject(e) ? e.ID : undefined))
				),
			};
	} else if (isObject(payload)) {
		if (type.startsWith("Sale/"))
			targets = {
				sales: idsOf(firstOf(payload, ["SaleID", "SaleTaskID", "TaskID"])),
			};
		else if (type.startsWith("Purchase/")) {
			const own = firstOf(payload, ["TaskID", "ID"]);
			targets = { purchases: idsOf(own.length ? own : listedIds(payload)) };
		} else if (type === "Product/Updated")
			targets = {
				products: idsOf([
					...firstOf(payload, ["ProductID"]),
					...listedIds(payload),
				]),
			};
	}
	const kept = Object.entries(targets).filter(([, ids]) => ids.length > 0);
	return kept.length ? (Object.fromEntries(kept) as SyncTargets) : undefined;
}

type Pending = {
	sales: Set<string>;
	purchases: Set<string>;
	products: Set<string>;
	eventIds: bigint[];
};

const emptyPending = (): Pending => ({
	sales: new Set(),
	purchases: new Set(),
	products: new Set(),
	eventIds: [],
});

export type WebhookRunner = {
	enqueue(targets: SyncTargets, eventId: bigint): void;
	/** Runs whatever is pending now and resolves when no run is in flight. */
	flush(): Promise<void>;
	stop(): void;
};

type RunnerOpts = {
	db: Db;
	log: Logger;
	resolveDeps: () => Promise<SyncDeps | null>;
	debounceMs?: number;
};

// One targeted run per window: the first event opens it, later ones join, so a steady stream
// cannot push the run back forever.
export function createWebhookRunner(opts: RunnerOpts): WebhookRunner {
	const { db, log } = opts;
	let pending = emptyPending();
	let timer: NodeJS.Timeout | undefined;
	let inflight: Promise<void> = Promise.resolve();

	const mark = (ids: bigint[], status: string, error: string | null) =>
		db.webhook_event.updateMany({
			where: { id: { in: ids } },
			data: { status, error },
		});

	async function run(batch: Pending): Promise<void> {
		const targets: SyncTargets = {
			sales: [...batch.sales],
			purchases: [...batch.purchases],
			products: [...batch.products],
		};
		try {
			const deps = await opts.resolveDeps();
			if (!deps)
				return void (await mark(
					batch.eventIds,
					"failed",
					"Cin7 is not connected"
				));
			const locked = await withSyncLock(deps, () =>
				runSync(deps, "targeted", { trigger: "webhook", targets })
			);
			if (!locked.acquired)
				// The next incremental run picks these records up from its cursor.
				return void (await mark(
					batch.eventIds,
					"skipped",
					"Another sync was running"
				));
			const { status, errorCode } = locked.result;
			await mark(
				batch.eventIds,
				status === "failed" ? "failed" : "synced",
				errorCode ?? null
			);
		} catch (err) {
			log.error({ err }, "webhook-triggered sync failed");
			await mark(batch.eventIds, "failed", "Sync error").catch(() => {});
		}
	}

	function fire(): void {
		if (timer) clearTimeout(timer);
		timer = undefined;
		const batch = pending;
		pending = emptyPending();
		if (batch.eventIds.length === 0) return;
		inflight = inflight.then(() => run(batch));
	}

	return {
		enqueue(targets, eventId) {
			for (const id of targets.sales ?? []) pending.sales.add(id);
			for (const id of targets.purchases ?? []) pending.purchases.add(id);
			for (const id of targets.products ?? []) pending.products.add(id);
			pending.eventIds.push(eventId);
			timer ??= setTimeout(fire, opts.debounceMs ?? DEBOUNCE_MS);
			timer.unref();
		},
		flush() {
			fire();
			return inflight;
		},
		stop() {
			if (timer) clearTimeout(timer);
			timer = undefined;
		},
	};
}
