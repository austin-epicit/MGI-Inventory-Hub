import type { Logger } from "pino";
import type { Db } from "../db.js";
import type {
	Cin7Availability,
	Cin7Customer,
	Cin7Product,
	Cin7PurchaseListItem,
	Cin7SaleListItem,
	Cin7Supplier,
} from "../cin7/schemas.js";
import {
	Cin7AuthError,
	Cin7HttpError,
	Cin7ParseError,
	Cin7RateLimitError,
	type Cin7PurchaseType,
	type Cin7Source,
	type Page,
	type PageQuery,
} from "../cin7/source.js";
import { getSetting, setSetting } from "../settings/appSettings.js";
import {
	clearRecordFailure,
	completeCursor,
	failureKey,
	getCursor,
	loadRecordFailures,
	markWalkStart,
	noteRecordFailure,
	OVERLAP_MS,
	QUARANTINE_AFTER,
	saveBackfillPage,
	takeWalkStart,
	type CursorEntity,
} from "./cursors.js";
import { parseCin7Date, parseCin7Timestamp, validTimeZone, zonedParts } from "./dates.js";
import { Cin7DataError } from "./money.js";
import { upsertProducts } from "./products.js";
import { mapPurchase, upsertPurchase } from "./purchases.js";
import { upsertReference } from "./reference.js";
import { mapSale, upsertSale } from "./sales.js";
import { replaceStock } from "./stock.js";

export type SyncKind = "backfill" | "incremental" | "reconcile" | "targeted";
export type SyncTrigger = "schedule" | "manual" | "webhook" | "seed";
export type SyncTargets = { sales?: string[]; purchases?: string[]; products?: string[] };

export type SyncDeps = {
	db: Db;
	source: Cin7Source;
	clock: () => Date;
	log: Logger;
	onImages?: (ids: string[]) => Promise<void>;
	// Running total of Cin7 calls made by the source; each run stores its own delta.
	apiCalls?: () => number;
	backfillMonths?: number; // BACKFILL_MONTHS, default 24
	pageSize?: number; // default 1000, Cin7's maximum
	timeZone?: string; // APP_TIMEZONE: used until the first successful me()
};

export type SyncRunSummary = {
	runId: bigint;
	status: "ok" | "partial" | "failed";
	counts: Record<string, number>;
	errorCode?: string;
};

// One entry of sync_run.errors.
export type SyncErrorEntry = { entity: string; id: string | null; code: string; message: string };

export const CIN7_ME_KEY = "cin7.me";
export type CachedMe = { company: string; currency: string; timeZone: string };
export const getCachedMe = (db: Db) => getSetting<CachedMe>(db, CIN7_ME_KEY);

const HOUR = 3_600_000;
const MAX_ERRORS = 50;
const MAX_TOUCHED = 200;
const MAX_DETAIL_OUTAGES = 3; // consecutive detail 5xx that mean Cin7 itself is down
const RECONCILE_WINDOW_MS = 72 * HOUR;
const TARGETED_WINDOW_MS = 2 * HOUR;
const PURCHASE_TYPES = ["Simple Purchase", "Advanced Purchase", "Service Purchase"];
type RefInput = Parameters<typeof upsertReference>[1];
const NO_REF: RefInput = { tiers: [], locations: [], suppliers: [], customers: [] };

class NotFoundError extends Error {}
// A 5xx/network failure on one detail call, demoted to a record error.
class DetailUnavailableError extends Error {}

type Fatal = { status: "failed" | "partial"; code: string };

// A 5xx or network failure that outlasted the HTTP client's retries (a 4xx is about the request).
const isOutage = (e: unknown) => e instanceof Cin7HttpError && !(e.status >= 400 && e.status < 500);

// Errors that end the run: the next call would hit the same wall. An outage reaching this point
// came from a list call, or was the third detail outage in a row (fetchDetail).
function fatalOf(e: unknown): Fatal | null {
	if (e instanceof Cin7AuthError) return { status: "failed", code: "CIN7_AUTH" };
	if (e instanceof Cin7RateLimitError) return { status: "partial", code: "CIN7_RATE_LIMIT" };
	if (isOutage(e)) return { status: "failed", code: "CIN7_HTTP" };
	return null;
}

// Bad data in one Cin7 record: skip it and go on. Anything else is our bug and ends the step.
function recordCode(e: unknown): string | null {
	if (e instanceof NotFoundError) return "NOT_FOUND";
	if (e instanceof Cin7ParseError) return "CIN7_PARSE";
	if (e instanceof Cin7DataError || e instanceof RangeError) return "CIN7_DATA";
	if (e instanceof Cin7HttpError || e instanceof DetailUnavailableError) return "CIN7_HTTP";
	return null;
}

// Capped: messages land in sync_run.errors and sync_record_failure on every failing run.
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);

type Run = {
	deps: SyncDeps;
	startedAt: Date;
	limit: number;
	timeZone: string;
	step: string;
	counts: Record<string, number>;
	errors: SyncErrorEntry[];
	blocking: number; // errors that hold back cursors and make the run partial
	quarantined: number; // listed in errors but blocking nothing
	failures: Map<string, number>; // attempts per failing record (failureKey)
	outages: number; // consecutive detail outages
	imageIds: string[];
	touched: Set<string>; // products on orders written this run
	refreshed: Set<string>; // products written this run
};

const bump = (run: Run, key: string, n = 1) => {
	run.counts[key] = (run.counts[key] ?? 0) + n;
};

function addError(run: Run, id: string | null, code: string, message: string, blocking = true) {
	if (blocking) run.blocking += 1;
	else run.quarantined += 1;
	if (run.errors.length < MAX_ERRORS)
		run.errors.push({ entity: run.step, id, code, message });
}

// Runs one record's work. A record-level failure is remembered across runs; after
// QUARANTINE_AFTER attempts it stops blocking, so one poison record cannot stall the mirror.
async function record(run: Run, id: string, fn: () => Promise<void>): Promise<void> {
	const entity = run.step;
	const key = failureKey(entity, id);
	try {
		await fn();
	} catch (e) {
		const code = fatalOf(e) ? null : recordCode(e);
		if (!code) throw e;
		const message = messageOf(e);
		const attempts = await noteRecordFailure(run.deps.db, {
			entity,
			id,
			code,
			message,
			at: run.deps.clock(),
		});
		run.failures.set(key, attempts);
		const quarantined = attempts >= QUARANTINE_AFTER;
		if (quarantined) {
			addError(
				run,
				id,
				"QUARANTINED",
				`${code} (${attempts} attempts): ${message}`,
				false
			);
		} else {
			addError(run, id, code, message);
		}
		run.deps.log.warn(
			{ entity, id, code, attempts, err: message },
			quarantined ? "sync record quarantined" : "sync record skipped"
		);
		return;
	}
	if (run.failures.delete(key)) await clearRecordFailure(run.deps.db, entity, id);
}

// A detail outage is that record's problem until MAX_DETAIL_OUTAGES in a row say Cin7 is down.
// A quarantined record's own outages say nothing about Cin7, so they neither count nor reset.
async function fetchDetail<T>(run: Run, id: string, call: () => Promise<T>): Promise<T> {
	try {
		const value = await call();
		run.outages = 0;
		return value;
	} catch (e) {
		if (!isOutage(e)) {
			run.outages = 0;
			throw e;
		}
		const attempts = run.failures.get(failureKey(run.step, id)) ?? 0;
		if (attempts < QUARANTINE_AFTER) {
			run.outages += 1;
			if (run.outages >= MAX_DETAIL_OUTAGES) throw e;
		}
		throw new DetailUnavailableError(messageOf(e));
	}
}

// One entity's work. `clean()` says whether it has met no blocking error so far; only fatal
// errors escape.
async function step(
	run: Run,
	name: string,
	fn: (clean: () => boolean) => Promise<void>
): Promise<void> {
	run.step = name;
	const before = run.blocking;
	try {
		await fn(() => run.blocking === before);
	} catch (e) {
		if (fatalOf(e)) throw e;
		addError(run, null, recordCode(e) ?? "SYNC_ERROR", messageOf(e));
		run.deps.log.error({ entity: name, err: e }, "sync step failed");
	}
}

// Pages until Cin7 returns a short page; Total alone could stop early if it is ever under-reported.
async function walk<T>(
	run: Run,
	first: number,
	fetch: (page: number) => Promise<Page<T>>,
	onPage: (items: T[], page: number) => Promise<void>
): Promise<void> {
	for (let page = first; ; page++) {
		const { items, total } = await fetch(page);
		// Guards against a source that ignores Page and would serve page 1 forever.
		if (page > 1 && items.length > 0 && (page - 1) * run.limit >= total)
			throw new Error(`page ${page} lies past Total ${total}`);
		await onPage(items, page);
		if (items.length < run.limit) return;
	}
}

type EntitySpec<T> = {
	entity: CursorEntity;
	list: (page: number, since?: Date) => Promise<Page<T>>;
	write: (items: T[], cutoff: string | null) => Promise<void>;
	idOf: (item: T) => string;
	// Reconcile re-reads only the last 72 h of these instead of sweeping everything.
	windowed: boolean;
};

async function syncEntity<T>(
	run: Run,
	kind: "backfill" | "incremental" | "reconcile",
	spec: EntitySpec<T>
): Promise<void> {
	const { db } = run.deps;
	await step(run, spec.entity, async (clean) => {
		const cursor = await getCursor(db, spec.entity);
		const since =
			cursor.backfillDone && cursor.lastSuccessAt
				? new Date(cursor.lastSuccessAt.getTime() - OVERLAP_MS)
				: null;
		if (kind === "backfill" || (kind === "incremental" && !since)) {
			await backfillWalk(run, spec, cursor.backfillPage, clean);
			return;
		}
		const windowed = kind === "reconcile" && spec.windowed;
		const from =
			kind === "incremental"
				? (since ?? undefined)
				: windowed
					? new Date(run.startedAt.getTime() - RECONCILE_WINDOW_MS)
					: undefined;
		await walk(
			run,
			1,
			(page) => spec.list(page, from),
			(items) => spec.write(items, null)
		);
		// A 72 h window need not cover everything since the cursor, so it never moves it.
		if (!windowed && clean()) await completeCursor(db, spec.entity, run.startedAt);
	});
}

async function backfillWalk<T>(
	run: Run,
	spec: EntitySpec<T>,
	savedPage: number,
	clean: () => boolean
): Promise<void> {
	const { db } = run.deps;
	const first = savedPage + 1;
	if (first === 1) await markWalkStart(db, spec.entity, run.startedAt);
	const cutoff = backfillCutoff(run);
	await walk(
		run,
		first,
		(page) => spec.list(page),
		async (items, page) => {
			await spec.write(items, cutoff);
			// A page with a skipped record is not fully written: a resume revisits it.
			if (clean()) await saveBackfillPage(db, spec.entity, page);
		}
	);
	if (clean()) {
		await completeCursor(
			db,
			spec.entity,
			(await takeWalkStart(db, spec.entity)) ?? run.startedAt
		);
	} else {
		await saveBackfillPage(db, spec.entity, 0); // retry the skipped records from page 1
	}
}

// Calendar day BACKFILL_MONTHS before today in the account's time zone; older orders are skipped.
function backfillCutoff(run: Run): string {
	const months = run.deps.backfillMonths ?? 24;
	const [y, m, d] = zonedParts(run.startedAt, run.timeZone).ymd.split("-").map(Number);
	return new Date(Date.UTC(y!, m! - 1 - months, d!)).toISOString().slice(0, 10);
}

async function writeProduct(run: Run, p: Cin7Product, countAs: string): Promise<void> {
	const r = await upsertProducts(run.deps.db, [p], run.deps.clock());
	bump(run, countAs);
	bump(run, "snapshots", r.snapshots);
	bump(run, "images", r.imageIds.length);
	run.imageIds.push(...r.imageIds);
	run.refreshed.add(p.ID);
}

type OrderOps<T> = {
	key: "sales" | "purchases";
	stampOf: (item: T) => string;
	dateOf: (item: T) => string | null | undefined;
	stored: (ids: string[]) => Promise<{ id: string; cin7_updated_at: Date }[]>;
	// Fetches the detail, writes it and returns the product IDs on its lines.
	fetchAndWrite: (item: T) => Promise<string[]>;
};

async function writeOrders<T>(
	run: Run,
	items: T[],
	cutoff: string | null,
	idOf: (item: T) => string,
	ops: OrderOps<T>
): Promise<void> {
	if (items.length === 0) return;
	const stored = new Map(
		(await ops.stored(items.map(idOf))).map((r) => [r.id, r.cin7_updated_at])
	);
	for (const item of items) {
		await record(run, idOf(item), async () => {
			const day = parseCin7Date(ops.dateOf(item));
			if (cutoff && day && day < cutoff) {
				bump(run, `${ops.key}.too_old`);
				return;
			}
			const prev = stored.get(idOf(item));
			if (prev && parseCin7Timestamp(ops.stampOf(item)) <= prev) {
				bump(run, `${ops.key}.unchanged`);
				return;
			}
			for (const productId of await ops.fetchAndWrite(item))
				run.touched.add(productId);
			bump(run, ops.key);
		});
	}
}

const lineProducts = (lines: { product_id?: string | null }[]) =>
	lines.flatMap((l) => (l.product_id ? [l.product_id] : []));

function saleSpec(run: Run): EntitySpec<Cin7SaleListItem> {
	const { db, source } = run.deps;
	const idOf = (i: Cin7SaleListItem) => i.SaleID;
	return {
		entity: "sales",
		windowed: true,
		idOf,
		list: (page, since) =>
			source.saleList({
				page,
				limit: run.limit,
				...(since ? { updatedSince: since } : {}),
			}),
		write: (items, cutoff) =>
			writeOrders(run, items, cutoff, idOf, {
				key: "sales",
				stampOf: (i) => i.Updated,
				dateOf: (i) => i.OrderDate,
				stored: (ids) =>
					db.sale.findMany({
						where: { id: { in: ids } },
						select: { id: true, cin7_updated_at: true },
					}),
				fetchAndWrite: async (item) => {
					const raw = await fetchDetail(run, item.SaleID, () =>
						source.sale(item.SaleID)
					);
					if (!raw)
						throw new NotFoundError(
							`sale ${item.SaleID} not found in Cin7`
						);
					const mapped = mapSale(raw, item);
					await upsertSale(db, mapped, run.deps.clock());
					return lineProducts(mapped.lines);
				},
			}),
	};
}

function purchaseSpec(run: Run): EntitySpec<Cin7PurchaseListItem> {
	const { db, source } = run.deps;
	const idOf = (i: Cin7PurchaseListItem) => i.ID;
	return {
		entity: "purchases",
		windowed: true,
		idOf,
		list: (page, since) =>
			source.purchaseList({
				page,
				limit: run.limit,
				...(since ? { updatedSince: since } : {}),
			}),
		write: (items, cutoff) =>
			writeOrders(run, items, cutoff, idOf, {
				key: "purchases",
				stampOf: (i) => i.LastUpdatedDate,
				dateOf: (i) => i.OrderDate,
				stored: (ids) =>
					db.purchase.findMany({
						where: { id: { in: ids } },
						select: { id: true, cin7_updated_at: true },
					}),
				fetchAndWrite: async (item) => {
					if (!PURCHASE_TYPES.includes(item.Type))
						throw new Cin7DataError(
							`unknown purchase type "${item.Type}"`,
							item.ID
						);
					const raw = await fetchDetail(run, item.ID, () =>
						source.purchase(
							item.ID,
							item.Type as Cin7PurchaseType
						)
					);
					if (!raw)
						throw new NotFoundError(
							`purchase ${item.ID} not found in Cin7`
						);
					const mapped = mapPurchase(raw, item);
					await upsertPurchase(db, mapped, run.deps.clock());
					return lineProducts(mapped.lines);
				},
			}),
	};
}

function productSpec(run: Run): EntitySpec<Cin7Product> {
	const idOf = (p: Cin7Product) => p.ID;
	return {
		entity: "products",
		windowed: false,
		idOf,
		list: (page, since) =>
			run.deps.source.products({
				page,
				limit: run.limit,
				...(since ? { modifiedSince: since } : {}),
			}),
		// Always written: AverageCost may move without a LastModifiedOn bump.
		write: async (items) => {
			for (const p of items)
				await record(run, p.ID, () => writeProduct(run, p, "products"));
		},
	};
}

function partySpec<T extends Cin7Supplier | Cin7Customer>(
	run: Run,
	entity: "suppliers" | "customers",
	list: (q: PageQuery & { modifiedSince?: Date }) => Promise<Page<T>>,
	asRef: (x: T) => RefInput
): EntitySpec<T> {
	const idOf = (x: T) => x.ID;
	return {
		entity,
		windowed: false,
		idOf,
		list: (page, since) =>
			list({
				page,
				limit: run.limit,
				...(since ? { modifiedSince: since } : {}),
			}),
		write: async (items) => {
			for (const x of items) {
				await record(run, x.ID, async () => {
					await upsertReference(
						run.deps.db,
						asRef(x),
						run.deps.clock()
					);
					bump(run, entity);
				});
			}
		},
	};
}

async function syncMe(run: Run): Promise<void> {
	await step(run, "me", async () => {
		const me = await run.deps.source.me();
		run.timeZone = validTimeZone(me.TimeZone) ?? run.timeZone;
		const cached: CachedMe = {
			company: me.Company,
			currency: me.Currency,
			timeZone: me.TimeZone,
		};
		await setSetting(run.deps.db, CIN7_ME_KEY, cached);
	});
}

async function syncTiers(run: Run): Promise<void> {
	await step(run, "tiers", async () => {
		for (const t of await run.deps.source.priceTiers()) {
			await record(run, String(t.Code), async () => {
				await upsertReference(
					run.deps.db,
					{ ...NO_REF, tiers: [t] },
					run.deps.clock()
				);
				bump(run, "tiers");
			});
		}
	});
}

// The locations endpoint pages at its own size, so this walks by Total rather than by short page.
async function syncLocations(run: Run): Promise<void> {
	await step(run, "locations", async () => {
		for (let page = 1, seen = 0; ; page++) {
			const { items, total } = await run.deps.source.locations(page);
			for (const l of items) {
				await record(run, l.ID, async () => {
					await upsertReference(
						run.deps.db,
						{ ...NO_REF, locations: [l] },
						run.deps.clock()
					);
					bump(run, "locations");
				});
			}
			seen += items.length;
			if (items.length === 0 || seen >= total) return;
		}
	});
}

// Re-reads products on orders written this run: a receipt or sale can move AverageCost without
// touching the product's LastModifiedOn.
async function refreshTouchedProducts(run: Run): Promise<void> {
	const ids = [...run.touched].filter((id) => !run.refreshed.has(id));
	if (ids.length === 0) return;
	await step(run, "products", async () => {
		for (const id of ids.slice(0, MAX_TOUCHED)) {
			await record(run, id, async () => {
				const p = await fetchDetail(run, id, () =>
					run.deps.source.product(id)
				);
				if (!p) throw new NotFoundError(`product ${id} not found in Cin7`);
				await writeProduct(run, p, "products.touched");
			});
		}
	});
	if (ids.length > MAX_TOUCHED)
		bump(run, "products.touched_deferred", ids.length - MAX_TOUCHED);
}

// Stock is replaced wholesale, so it is only handed over as complete after every page was read.
async function syncStock(run: Run): Promise<void> {
	await step(run, "stock", async () => {
		const rows: Cin7Availability[] = [];
		let problem: string | null = null;
		try {
			await walk(
				run,
				1,
				(page) => run.deps.source.availability({ page, limit: run.limit }),
				async (items) => {
					rows.push(...items);
				}
			);
		} catch (e) {
			if (fatalOf(e)) throw e;
			problem = messageOf(e);
		}
		const r = await replaceStock(run.deps.db, rows, problem === null, run.deps.clock());
		bump(run, "stock", r.count);
		if (!r.replaced) {
			const why =
				r.reason === "EMPTY_SWEEP"
					? "Cin7 returned no stock rows"
					: `stock read incomplete (${problem})`;
			addError(run, null, r.reason, `${why}; kept the stored stock`);
		}
	});
}

async function syncImages(run: Run): Promise<void> {
	const onImages = run.deps.onImages;
	if (!onImages) return;
	await step(run, "images", () => onImages([...new Set(run.imageIds)]));
}

async function syncAll(run: Run, kind: "backfill" | "incremental" | "reconcile"): Promise<void> {
	const { source } = run.deps;
	await syncMe(run);
	await syncTiers(run);
	await syncLocations(run);
	await syncEntity(
		run,
		kind,
		partySpec(
			run,
			"suppliers",
			(q) => source.suppliers(q),
			(s) => ({ ...NO_REF, suppliers: [s] })
		)
	);
	await syncEntity(
		run,
		kind,
		partySpec(
			run,
			"customers",
			(q) => source.customers(q),
			(c) => ({ ...NO_REF, customers: [c] })
		)
	);
	await syncEntity(run, kind, productSpec(run));
	await syncEntity(run, kind, purchaseSpec(run));
	await syncEntity(run, kind, saleSpec(run));
	if (kind === "incremental") await refreshTouchedProducts(run);
	await syncStock(run);
	await syncImages(run);
}

async function syncTargets(run: Run, targets: SyncTargets): Promise<void> {
	const { source } = run.deps;
	if (targets.products?.length) {
		await step(run, "products", async () => {
			for (const id of new Set(targets.products)) {
				await record(run, id, async () => {
					const p = await fetchDetail(run, id, () =>
						source.product(id)
					);
					if (!p)
						throw new NotFoundError(
							`product ${id} not found in Cin7`
						);
					await writeProduct(run, p, "products");
				});
			}
		});
	}
	await syncTargetOrders(run, purchaseSpec(run), targets.purchases);
	await syncTargetOrders(run, saleSpec(run), targets.sales);
	await syncImages(run);
}

// The mappers need the list item, so one list call finds the targets; details follow only for them.
async function syncTargetOrders<T>(
	run: Run,
	spec: EntitySpec<T>,
	ids: string[] | undefined
): Promise<void> {
	if (!ids?.length) return;
	await step(run, spec.entity, async () => {
		const wanted = new Set(ids.map((i) => i.toLowerCase())); // Cin7 ids differ in case between endpoints
		const since = new Date(run.startedAt.getTime() - TARGETED_WINDOW_MS);
		const { items } = await spec.list(1, since);
		const found = items.filter((i) => wanted.has(spec.idOf(i).toLowerCase()));
		// Not listed (edited before the window, or not yet): the next incremental gets it.
		if (found.length < wanted.size)
			bump(run, `${spec.entity}.not_listed`, wanted.size - found.length);
		await spec.write(found, null);
	});
}

export async function runSync(
	deps: SyncDeps,
	kind: SyncKind,
	opts: { trigger?: SyncTrigger; targets?: SyncTargets } = {}
): Promise<SyncRunSummary> {
	const { db, log } = deps;
	const startedAt = deps.clock();
	const callsBefore = deps.apiCalls?.() ?? 0;
	const trigger = opts.trigger ?? "manual";
	const failures = await loadRecordFailures(db);
	const { id } = await db.sync_run.create({
		data: { kind, trigger, status: "running", started_at: startedAt },
		select: { id: true },
	});
	const run: Run = {
		deps,
		startedAt,
		limit: deps.pageSize ?? 1000,
		timeZone:
			validTimeZone((await getCachedMe(db))?.timeZone) ??
			validTimeZone(deps.timeZone) ??
			"UTC", // a me() that fails this run keeps the last known zone
		step: "run",
		counts: {},
		errors: [],
		blocking: 0,
		quarantined: 0,
		failures,
		outages: 0,
		imageIds: [],
		touched: new Set(),
		refreshed: new Set(),
	};
	log.info({ runId: String(id), kind, trigger }, "sync run started");
	let fatal: Fatal | null = null;
	try {
		if (kind === "targeted") await syncTargets(run, opts.targets ?? {});
		else await syncAll(run, kind);
	} catch (e) {
		fatal = fatalOf(e) ?? { status: "failed", code: "SYNC_ERROR" };
		addError(run, null, fatal.code, messageOf(e));
		log.error({ runId: String(id), entity: run.step, err: e }, "sync run aborted");
	}
	// Quarantined records stay listed in errors but no longer make the run partial.
	const status = fatal?.status ?? (run.blocking > 0 ? "partial" : "ok");
	if (run.blocking > 0) run.counts.errors = run.blocking;
	if (run.quarantined > 0) run.counts.quarantined = run.quarantined;
	await db.sync_run.update({
		where: { id },
		data: {
			status,
			finished_at: deps.clock(),
			api_calls: (deps.apiCalls?.() ?? 0) - callsBefore,
			counts: run.counts,
			errors: run.errors,
			error_code: fatal?.code ?? null,
		},
	});
	log.info({ runId: String(id), kind, status, counts: run.counts }, "sync run finished");
	return {
		runId: id,
		status,
		counts: run.counts,
		...(fatal ? { errorCode: fatal.code } : {}),
	};
}
