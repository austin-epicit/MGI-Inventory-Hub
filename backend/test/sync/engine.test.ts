import { beforeEach, describe, expect, it, vi } from "vitest";
import { seedDemo } from "../../prisma/seed.js";
import type { Cin7Dataset, SeedHistoryPoint } from "../../fixtures/generate.js";
import { createFixtureSource } from "../../src/cin7/fixtureSource.js";
import type { Cin7Sale } from "../../src/cin7/schemas.js";
import {
	Cin7AuthError,
	Cin7HttpError,
	Cin7ParseError,
	Cin7RateLimitError,
	type Cin7Source,
	type PageQuery,
} from "../../src/cin7/source.js";
import { parseCin7Stamp } from "../../src/cin7/timestamps.js";
import { log } from "../../src/log.js";
import { runSync, type SyncDeps, type SyncKind } from "../../src/sync/engine.js";
import { dec4 } from "../../src/sync/money.js";
import { createSyncTick, nightlyPeriod, startScheduler } from "../../src/sync/scheduler.js";
import { demoDataset } from "../helpers/dataset.js";
import { resetDb, testDb } from "../helpers/db.js";

const HOUR = 3_600_000;
const T0 = new Date("2026-11-20T12:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
// T0's calendar day in Los Angeles (the fixture's Cin7 time zone) minus BACKFILL_MONTHS (24).
const CUTOFF = "2024-11-20";
const SCHEDULE = { intervalMs: 300_000, nightlyAt: "02:00", timezone: "America/Los_Angeles" };

type Call = { method: string; args: unknown[] };

// Records every Cin7 call; `fault` may return an error to throw instead of answering.
function spySource(inner: Cin7Source, fault?: (call: Call) => Error | undefined) {
	const calls: Call[] = [];
	const source = new Proxy(inner, {
		get(target, key) {
			const value: unknown = Reflect.get(target, key);
			if (typeof value !== "function") return value;
			return async (...args: unknown[]) => {
				const call = { method: String(key), args };
				calls.push(call);
				const err = fault?.(call);
				if (err) throw err;
				return value(...args);
			};
		},
	});
	const called = (method: string) => calls.filter((c) => c.method === method);
	return { source, calls, called };
}

const deps = (source: Cin7Source, over: Partial<SyncDeps> = {}): SyncDeps => ({
	db: testDb,
	source,
	clock: () => T0,
	log,
	...over,
});

// Every 8th order plus all products, stock and reference data: same shapes, far fewer writes.
function smallDataset(): Cin7Dataset {
	const ds = structuredClone(demoDataset());
	const sales = new Set(ds.saleList.filter((_, i) => i % 8 === 0).map((s) => s.SaleID));
	ds.saleList = ds.saleList.filter((s) => sales.has(s.SaleID));
	ds.sales = ds.sales.filter((s) => sales.has(s.ID));
	const pos = new Set(ds.purchaseList.filter((_, i) => i % 8 === 0).map((p) => p.ID));
	ds.purchaseList = ds.purchaseList.filter((p) => pos.has(p.ID));
	ds.purchases = ds.purchases.filter((p) => pos.has(p.ID));
	return ds;
}

const inWindow = (orderDate: string) => orderDate.slice(0, 10) >= CUTOFF;
// Task 6's counting rules, applied to the raw dataset.
const saleCounted = (s: Cin7Sale) =>
	["AUTHORISED", "AUTH_NO_ALLOC", "FULFILLED", "CLOSED"].includes(s.Order.Status) &&
	s.Status !== "VOIDED";
const purchaseCounted = (p: { Status: string; Order?: { Status: string } | null }) =>
	p.Order?.Status === "AUTHORISED" && p.Status !== "VOIDED";

// In-window sales that have lines (drafts have none), in list order.
const editableSales = (ds: Cin7Dataset) =>
	ds.saleList.filter(
		(s) =>
			inWindow(s.OrderDate) &&
			ds.sales.find((d) => d.ID === s.SaleID)!.Order.Lines.length > 0
	);

// An edit made in Cin7: fresh modification stamps and a new price on the first line.
function editSale(ds: Cin7Dataset, saleId: string, when: Date, price: number) {
	const item = ds.saleList.find((s) => s.SaleID === saleId)!;
	const sale = ds.sales.find((s) => s.ID === saleId)!;
	item.Updated = when.toISOString();
	sale.LastModifiedOn = when.toISOString();
	const line = sale.Order.Lines[0]!;
	line.Price = price;
	line.Total = Math.round(line.Quantity * price * (100 - line.Discount)) / 100;
	return sale;
}

const firstLinePrice = async (saleId: string) =>
	(
		await testDb.sale_line.findUniqueOrThrow({
			where: { sale_id_line_no: { sale_id: saleId, line_no: 1 } },
		})
	).unit_price.toFixed(4);

const cursor = (entity: string) => testDb.sync_cursor.findUniqueOrThrow({ where: { entity } });
const runRow = (id: bigint) => testDb.sync_run.findUniqueOrThrow({ where: { id } });
const stockRows = () =>
	testDb.stock_level.findMany({
		orderBy: [{ product_id: "asc" }, { location_name: "asc" }, { bin: "asc" }],
	});

async function tableCounts() {
	return {
		price_tier: await testDb.price_tier.count(),
		location: await testDb.location.count(),
		supplier: await testDb.supplier.count(),
		customer: await testDb.customer.count(),
		product: await testDb.product.count(),
		product_image: await testDb.product_image.count(),
		product_price_snapshot: await testDb.product_price_snapshot.count(),
		purchase: await testDb.purchase.count(),
		purchase_line: await testDb.purchase_line.count(),
		sale: await testDb.sale.count(),
		sale_line: await testDb.sale_line.count(),
		stock_level: await testDb.stock_level.count(),
	};
}

beforeEach(resetDb);

describe("runSync", () => {
	it("stores Simple, Advanced and Service purchases as /advanced-purchase serves them, plus null-rate and CLOSED edge cases", async () => {
		const ds = structuredClone(demoDataset());
		const recent = (d: string) => d.slice(0, 10) >= CUTOFF;
		const pick = (type: string) =>
			ds.purchaseList.find(
				(p) =>
					p.Type === type &&
					recent(p.OrderDate!) &&
					p.Status !== "VOIDED" &&
					ds.purchases.find((d) => d.ID === p.ID)!.Order!.Status ===
						"AUTHORISED"
			)!;
		const types = ["Simple Purchase", "Advanced Purchase", "Service Purchase"];
		const items = types.map(pick);
		ds.purchaseList = items;
		ds.purchases = ds.purchases.filter((p) => items.some((i) => i.ID === p.ID));
		// Foreign voided sale with a null rate, and a CLOSED order, both inside the window.
		const sale = ds.sales.find(
			(s) =>
				s.CustomerCurrency !== s.BaseCurrency &&
				recent(ds.saleList.find((l) => l.SaleID === s.ID)!.OrderDate) &&
				s.Order.Lines.length > 0
		)!;
		const closed = ds.sales.find(
			(s) =>
				s.ID !== sale.ID &&
				recent(ds.saleList.find((l) => l.SaleID === s.ID)!.OrderDate) &&
				s.Status !== "VOIDED" &&
				s.Order.Lines.length > 0
		)!;
		sale.Status = "VOIDED";
		sale.CurrencyRate = null;
		closed.Order.Status = "CLOSED";
		ds.sales = [sale, closed];
		ds.saleList = ds.saleList.filter(
			(l) => l.SaleID === sale.ID || l.SaleID === closed.ID
		);
		const r = await runSync(deps(createFixtureSource(ds)), "backfill", {
			trigger: "manual",
		});
		expect(r.status).toBe("ok");
		const stored = await testDb.purchase.findMany({
			select: { type: true, counted: true },
		});
		expect(stored.map((p) => p.type).sort()).toEqual([...types].sort());
		expect(stored.every((p) => p.counted)).toBe(true);
		expect(await testDb.sync_record_failure.count()).toBe(0);
		const voided = await testDb.sale.findUniqueOrThrow({ where: { id: sale.ID } });
		expect(voided.counted).toBe(false);
		expect(voided.total_base.toFixed(4)).toBe("0.0000");
		expect(
			(await testDb.sale.findUniqueOrThrow({ where: { id: closed.ID } })).counted
		).toBe(true);
	});

	it("stores a quote-stage sale (no SaleOrderNumber) and a blind receipt (no Order, no OrderDate) as uncounted, listed rows", async () => {
		const ds = structuredClone(demoDataset());
		const recent = (d: string) => d.slice(0, 10) >= CUTOFF;
		const sale = ds.sales.find((s) =>
			recent(ds.saleList.find((l) => l.SaleID === s.ID)!.OrderDate)
		)!;
		sale.Order.Status = "DRAFT";
		sale.Order.SaleOrderNumber = null;
		const sItem = ds.saleList.find((l) => l.SaleID === sale.ID)!;
		ds.sales = [sale];
		ds.saleList = [sItem];
		const item = ds.purchaseList.find((p) => recent(p.OrderDate!))!;
		const po = ds.purchases.find((p) => p.ID === item.ID)!;
		delete po.Order;
		po.OrderDate = null;
		item.OrderDate = null;
		ds.purchases = [po];
		ds.purchaseList = [item];
		const r = await runSync(deps(createFixtureSource(ds)), "backfill", {
			trigger: "manual",
		});
		expect(r.status).toBe("ok");
		expect(await testDb.sync_record_failure.count()).toBe(0);
		const s1 = await testDb.sale.findUniqueOrThrow({ where: { id: sale.ID } });
		expect(s1.order_number).toBe(sItem.OrderNumber);
		expect(s1.counted).toBe(false);
		const p1 = await testDb.purchase.findUniqueOrThrow({ where: { id: po.ID } });
		expect(p1.counted).toBe(false);
		expect(p1.order_date).toBeNull();
		expect(await testDb.purchase_line.count()).toBe(0);
	});

	it("backfill mirrors every counted purchase/sale within 24 months", async () => {
		const ds = demoDataset();
		const spy = spySource(createFixtureSource(ds));
		const onImages = vi.fn(async (_ids: string[]) => {});
		const r = await runSync(
			deps(spy.source, { onImages, apiCalls: () => spy.calls.length }),
			"backfill",
			{ trigger: "manual" }
		);
		expect(r.status).toBe("ok");
		expect(r.errorCode).toBeUndefined();

		const saleIds = new Set(
			ds.saleList.filter((s) => inWindow(s.OrderDate)).map((s) => s.SaleID)
		);
		const sales = ds.sales.filter((s) => saleIds.has(s.ID));
		const poIds = new Set(
			ds.purchaseList.filter((p) => inWindow(p.OrderDate!)).map((p) => p.ID)
		);
		const pos = ds.purchases.filter((p) => poIds.has(p.ID));
		expect(sales.length).toBeLessThan(ds.sales.length); // the window cut real orders
		expect(pos.length).toBeLessThan(ds.purchases.length);

		expect(await testDb.sale.count()).toBe(sales.length);
		expect(await testDb.sale.count({ where: { counted: true } })).toBe(
			sales.filter(saleCounted).length
		);
		expect(await testDb.sale_line.count()).toBe(
			sales.reduce((n, s) => n + s.Order.Lines.length, 0)
		);
		expect(await testDb.purchase.count()).toBe(pos.length);
		expect(await testDb.purchase.count({ where: { counted: true } })).toBe(
			pos.filter(purchaseCounted).length
		);
		expect(await testDb.purchase_line.count()).toBe(
			pos.reduce((n, p) => n + p.Order!.Lines.length, 0)
		);
		const before = new Date(`${CUTOFF}T00:00:00.000Z`);
		expect(await testDb.sale.count({ where: { order_date: { lt: before } } })).toBe(0);
		expect(await testDb.purchase.count({ where: { order_date: { lt: before } } })).toBe(
			0
		);
		// Too-old orders cost no detail call.
		expect(spy.called("sale")).toHaveLength(sales.length);
		expect(spy.called("purchase")).toHaveLength(pos.length);

		const attachments = ds.products
			.flatMap((p) => p.Attachments ?? [])
			.map((a) => a.ID);
		expect(await tableCounts()).toMatchObject({
			price_tier: ds.priceTiers.length,
			location: ds.locations.length,
			supplier: ds.suppliers.length,
			customer: ds.customers.length,
			product: ds.products.length,
			product_image: attachments.length,
			product_price_snapshot: ds.products.length,
			stock_level: ds.availability.length,
		});
		expect(r.counts).toMatchObject({
			sales: sales.length,
			"sales.too_old": ds.sales.length - sales.length,
			purchases: pos.length,
			products: ds.products.length,
			snapshots: ds.products.length,
			stock: ds.availability.length,
		});
		expect(onImages).toHaveBeenCalledTimes(1);
		expect([...onImages.mock.calls[0]![0]].sort()).toEqual([...attachments].sort());

		for (const entity of ["suppliers", "customers", "products", "purchases", "sales"]) {
			expect(await cursor(entity)).toMatchObject({
				last_success_at: T0,
				backfill_done: true,
				backfill_page: 0,
			});
		}
		expect(
			(await testDb.app_setting.findUniqueOrThrow({ where: { key: "cin7.me" } }))
				.value
		).toEqual({
			company: ds.me.Company,
			currency: "USD",
			timeZone: "America/Los_Angeles",
		});
		expect(await runRow(r.runId)).toMatchObject({
			kind: "backfill",
			trigger: "manual",
			status: "ok",
			started_at: T0,
			finished_at: T0,
			api_calls: spy.calls.length,
			errors: [],
			error_code: null,
		});
	});

	describe("run time zone when me() fails", () => {
		// T0 is Nov 20 in UTC but already Nov 21 in Auckland; a 1-month cutoff differs by that day.
		const edge = async (over: Partial<SyncDeps>) => {
			const ds = smallDataset();
			const target = editableSales(ds)[0]!;
			target.OrderDate = "2026-10-20";
			const spy = spySource(createFixtureSource(ds), (c) =>
				c.method === "me" ? new Error("me down") : undefined
			);
			await runSync(deps(spy.source, { backfillMonths: 1, ...over }), "backfill");
			return testDb.sale.count({ where: { id: target.SaleID } });
		};

		it("uses the cached Cin7 zone", async () => {
			await testDb.app_setting.create({
				data: {
					key: "cin7.me",
					value: {
						company: "X",
						currency: "USD",
						timeZone: "Pacific/Auckland",
					},
				},
			});
			expect(await edge({})).toBe(0);
		});

		it("falls back to the configured zone when nothing is cached", async () => {
			expect(await edge({ timeZone: "Pacific/Auckland" })).toBe(0);
		});

		it("stays UTC with neither", async () => {
			expect(await edge({})).toBe(1);
		});
	});

	it("second backfill: identical row counts, no new snapshots", async () => {
		const ds = smallDataset();
		const spy = spySource(createFixtureSource(ds));
		const onImages = vi.fn(async (_ids: string[]) => {});
		const first = await runSync(deps(spy.source, { onImages }), "backfill");
		expect(first.status).toBe("ok");
		const counts = await tableCounts();
		const details = spy.called("sale").length + spy.called("purchase").length;

		const second = await runSync(
			deps(spy.source, { onImages, clock: () => at(HOUR) }),
			"backfill"
		);
		expect(second.status).toBe("ok");
		expect(await tableCounts()).toEqual(counts);
		expect(second.counts).toMatchObject({
			snapshots: 0,
			"sales.unchanged": first.counts.sales,
			"purchases.unchanged": first.counts.purchases,
		});
		expect(second.counts.sales ?? 0).toBe(0);
		// Unchanged orders are not fetched again.
		expect(spy.called("sale").length + spy.called("purchase").length).toBe(details);
		expect(onImages).toHaveBeenLastCalledWith([]);
		expect(await cursor("sales")).toMatchObject({ last_success_at: at(HOUR) });
	});

	it("resumes from the saved page after a crash on page 3", async () => {
		const ds = smallDataset();
		const pageSize = 50;
		// On page 3 the 11th order gets a 5xx and the walk crashes on the 12th.
		const failed = ds.saleList[2 * pageSize + 10]!;
		const crashAt = ds.saleList[2 * pageSize + 11]!;
		expect(inWindow(failed.OrderDate) && inWindow(crashAt.OrderDate)).toBe(true);
		const crashing = spySource(createFixtureSource(ds), (c) => {
			if (c.method !== "sale") return undefined;
			if (c.args[0] === failed.SaleID)
				return new Cin7HttpError("Bad Gateway", 502);
			if (c.args[0] === crashAt.SaleID) return new Error("worker crashed");
			return undefined;
		});
		const r1 = await runSync(deps(crashing.source, { pageSize }), "backfill");
		expect(r1.status).toBe("partial");
		expect((await runRow(r1.runId)).errors).toEqual([
			expect.objectContaining({
				entity: "sales",
				id: failed.SaleID,
				code: "CIN7_HTTP",
			}),
			{
				entity: "sales",
				id: null,
				code: "SYNC_ERROR",
				message: "worker crashed",
			},
		]);
		// Page 3 holds a skipped order, so the saved page stays at 2.
		expect(await cursor("sales")).toMatchObject({
			backfill_page: 2,
			backfill_done: false,
		});
		// A single 5xx order no longer stops the run: stock was still refreshed.
		expect(await testDb.stock_level.count()).toBe(ds.availability.length);
		expect(await testDb.sync_record_failure.findMany()).toEqual([
			expect.objectContaining({
				entity: "sales",
				record_id: failed.SaleID,
				attempts: 1,
				last_code: "CIN7_HTTP",
			}),
		]);

		const healthy = spySource(createFixtureSource(ds));
		const r2 = await runSync(
			deps(healthy.source, { pageSize, clock: () => at(HOUR) }),
			"backfill"
		);
		expect(r2.status).toBe("ok");
		const pages = healthy.called("saleList").map((c) => (c.args[0] as PageQuery).page);
		expect(pages[0]).toBe(3);
		// Only orders not yet written are fetched: the failed one and everything after it.
		expect(healthy.called("sale").map((c) => c.args[0])).toEqual(
			ds.saleList
				.slice(2 * pageSize + 10)
				.filter((s) => inWindow(s.OrderDate))
				.map((s) => s.SaleID)
		);
		expect(await testDb.sale.count()).toBe(
			ds.saleList.filter((s) => inWindow(s.OrderDate)).length
		);
		// The walk began in the crashed run, so the cursor dates from then, not the resume.
		expect(await cursor("sales")).toMatchObject({
			backfill_done: true,
			backfill_page: 0,
			last_success_at: T0,
		});
		expect(await testDb.sync_record_failure.count()).toBe(0); // the retry succeeded
	});

	it("incremental picks up a sale edited after the cursor (new Updated + Price)", async () => {
		const ds = smallDataset();
		const spy = spySource(createFixtureSource(ds));
		await runSync(deps(spy.source), "backfill");

		const [target] = editableSales(ds);
		const edited = editSale(ds, target!.SaleID, at(HOUR / 2), 4321.5);
		// AverageCost moves without a LastModifiedOn bump; only a product re-fetch sees it.
		const moved = ds.products.find((p) => p.ID === edited.Order.Lines[0]!.ProductID)!;
		moved.AverageCost += 5;
		spy.calls.length = 0;

		const r = await runSync(
			deps(spy.source, {
				clock: () => at(HOUR),
				apiCalls: () => spy.calls.length,
			}),
			"incremental"
		);
		expect(r.status).toBe("ok");
		expect(r.counts.sales).toBe(1);
		expect(spy.called("sale").map((c) => c.args[0])).toEqual([edited.ID]);
		expect(await firstLinePrice(edited.ID)).toBe(dec4(4321.5));
		const row = await testDb.sale.findUniqueOrThrow({ where: { id: edited.ID } });
		expect(row.cin7_updated_at).toEqual(parseCin7Stamp(edited.LastModifiedOn));
		// Ten minutes of overlap behind the cursor.
		const since = new Date(T0.getTime() - 10 * 60_000);
		expect(spy.called("saleList")[0]!.args[0]).toMatchObject({ updatedSince: since });
		expect(spy.called("products")[0]!.args[0]).toMatchObject({ modifiedSince: since });

		const lineProducts = [...new Set(edited.Order.Lines.map((l) => l.ProductID))];
		expect(spy.called("product").map((c) => c.args[0])).toEqual(lineProducts);
		expect(r.counts["products.touched"]).toBe(lineProducts.length);
		const snaps = await testDb.product_price_snapshot.findMany({
			where: { product_id: moved.ID },
			orderBy: { observed_at: "asc" },
		});
		expect(snaps.map((s) => s.average_cost.toFixed(4))).toEqual([
			dec4(moved.AverageCost - 5),
			dec4(moved.AverageCost),
		]);
		expect(await cursor("sales")).toMatchObject({ last_success_at: at(HOUR) });
		expect((await runRow(r.runId)).api_calls).toBe(spy.calls.length);
	});

	it("auth error → run failed CIN7_AUTH; all previous rows intact", async () => {
		const ds = smallDataset();
		await runSync(deps(createFixtureSource(ds)), "backfill");
		const counts = await tableCounts();
		const stock = await stockRows();
		const cursors = await testDb.sync_cursor.findMany({ orderBy: { entity: "asc" } });

		// The key is revoked mid stock sweep: page 1 was read, page 2 is refused.
		const spy = spySource(createFixtureSource(ds), (c) =>
			c.method === "availability" && (c.args[0] as PageQuery).page === 2
				? new Cin7AuthError("API key revoked", 403)
				: undefined
		);
		const onImages = vi.fn(async (_ids: string[]) => {});
		const r = await runSync(
			deps(spy.source, { pageSize: 100, onImages, clock: () => at(HOUR) }),
			"incremental"
		);
		expect(r).toMatchObject({ status: "failed", errorCode: "CIN7_AUTH" });
		expect(await tableCounts()).toEqual(counts);
		expect(await stockRows()).toEqual(stock);
		expect(onImages).not.toHaveBeenCalled();
		const row = await runRow(r.runId);
		expect(row).toMatchObject({ status: "failed", error_code: "CIN7_AUTH" });
		expect(row.errors).toEqual([
			{
				entity: "stock",
				id: null,
				code: "CIN7_AUTH",
				message: "API key revoked",
			},
		]);
		// Steps finished before the refusal keep their progress; no cursor moved back.
		const after = await testDb.sync_cursor.findMany({ orderBy: { entity: "asc" } });
		for (const [i, c] of after.entries()) {
			expect(c.last_success_at!.getTime()).toBeGreaterThanOrEqual(
				cursors[i]!.last_success_at!.getTime()
			);
		}
	});

	it("one unparseable sale → run partial, the other sales stored", async () => {
		const ds = smallDataset();
		const window = ds.saleList.filter((s) => inWindow(s.OrderDate));
		const [unparseable, missing, badDate] = [window[3]!, window[7]!, window[11]!];
		badDate.OrderDate = "20/11/2025";
		ds.sales = ds.sales.filter((s) => s.ID !== missing.SaleID); // the detail now 404s
		const spy = spySource(createFixtureSource(ds), (c) =>
			c.method === "sale" && c.args[0] === unparseable.SaleID
				? new Cin7ParseError("Order.Lines: expected array", '{"Order":{}}')
				: undefined
		);
		const r = await runSync(deps(spy.source), "backfill");
		expect(r.status).toBe("partial");
		expect(r.errorCode).toBeUndefined();
		expect(r.counts.errors).toBe(3);
		const row = await runRow(r.runId);
		expect(row.error_code).toBeNull();
		expect(row.errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					entity: "sales",
					id: unparseable.SaleID,
					code: "CIN7_PARSE",
				}),
				expect.objectContaining({
					entity: "sales",
					id: missing.SaleID,
					code: "NOT_FOUND",
				}),
				expect.objectContaining({
					entity: "sales",
					id: badDate.SaleID,
					code: "CIN7_DATA",
				}),
			])
		);
		expect(await testDb.sale.count()).toBe(window.length - 3);
		expect(
			await testDb.sale.findUnique({ where: { id: unparseable.SaleID } })
		).toBeNull();
		// Sales stay unfinished so the next run retries them; the other entities completed.
		expect(await cursor("sales")).toMatchObject({
			backfill_done: false,
			backfill_page: 0,
			last_success_at: null,
		});
		expect(await cursor("purchases")).toMatchObject({ backfill_done: true });
		expect(await testDb.stock_level.count()).toBe(ds.availability.length);
		expect(await testDb.sync_record_failure.count({ where: { attempts: 1 } })).toBe(3);

		const retry = await runSync(
			deps(createFixtureSource(smallDataset()), { clock: () => at(HOUR) }),
			"incremental"
		);
		expect(retry.status).toBe("ok");
		expect(retry.counts.sales).toBe(3);
		expect(await testDb.sale.count()).toBe(window.length);
		expect(await cursor("sales")).toMatchObject({ backfill_done: true });
		expect(await testDb.sync_record_failure.count()).toBe(0);
	});

	it("a detail 5xx is a record error; three in a row abort the run as CIN7_HTTP", async () => {
		const ds = smallDataset();
		const w = ds.saleList.filter((s) => inWindow(s.OrderDate)).map((s) => s.SaleID);
		const failing = (ids: string[]) =>
			spySource(createFixtureSource(ds), (c) =>
				c.method === "sale" && ids.includes(c.args[0] as string)
					? new Cin7HttpError("Bad Gateway", 502)
					: undefined
			).source;
		// Two pairs of failures, split by a success that shows Cin7 still answers.
		const r1 = await runSync(deps(failing([w[2]!, w[3]!, w[5]!, w[6]!])), "backfill");
		expect(r1.status).toBe("partial");
		expect(r1.counts.errors).toBe(4);
		expect(await testDb.stock_level.count()).toBe(ds.availability.length);

		await resetDb();
		const r2 = await runSync(deps(failing([w[2]!, w[3]!, w[4]!])), "backfill");
		expect(r2).toMatchObject({ status: "failed", errorCode: "CIN7_HTTP" });
		expect(await testDb.stock_level.count()).toBe(0); // the run stopped
		// The third failure is charged to Cin7 being down, not to its record.
		const charged = await testDb.sync_record_failure.findMany();
		expect(charged.map((f) => f.record_id).sort()).toEqual([w[2]!, w[3]!].sort());
	});

	it("one poison record across 3 runs → quarantined, cursor advances, run no longer blocked", async () => {
		const ds = smallDataset();
		const poison = ds.saleList.filter((s) => inWindow(s.OrderDate))[5]!;
		const spy = spySource(createFixtureSource(ds), (c) =>
			c.method === "sale" && c.args[0] === poison.SaleID
				? new Cin7ParseError("Order: expected object", "{}")
				: undefined
		);
		const runAt = (hours: number, kind: SyncKind) =>
			runSync(deps(spy.source, { clock: () => at(hours * HOUR) }), kind);
		const failure = () =>
			testDb.sync_record_failure.findUniqueOrThrow({
				where: {
					entity_record_id: {
						entity: "sales",
						record_id: poison.SaleID,
					},
				},
			});

		expect((await runAt(0, "backfill")).status).toBe("partial");
		// Still no sales cursor, so the incremental walks the list again and retries it.
		expect((await runAt(1, "incremental")).status).toBe("partial");
		expect(await cursor("sales")).toMatchObject({ backfill_done: false });
		expect(await failure()).toMatchObject({ attempts: 2, last_code: "CIN7_PARSE" });

		const r3 = await runAt(2, "incremental");
		expect(r3.status).toBe("ok");
		expect(r3.counts).toMatchObject({ quarantined: 1 });
		expect(r3.counts.errors).toBeUndefined();
		expect((await runRow(r3.runId)).errors).toEqual([
			expect.objectContaining({
				entity: "sales",
				id: poison.SaleID,
				code: "QUARANTINED",
			}),
		]);
		expect(await cursor("sales")).toMatchObject({
			backfill_done: true,
			last_success_at: at(2 * HOUR),
		});
		expect(await failure()).toMatchObject({
			attempts: 3,
			first_failed_at: T0,
			last_failed_at: at(2 * HOUR),
		});

		// Past the cursor, the next incremental no longer even lists it.
		expect((await runAt(3, "incremental")).status).toBe("ok");
		expect(spy.called("sale").filter((c) => c.args[0] === poison.SaleID)).toHaveLength(
			3
		);
	});

	it("a quarantined record that later succeeds loses its failure row", async () => {
		const ds = smallDataset();
		const poison = editableSales(ds)[4]!;
		let broken = true;
		const spy = spySource(createFixtureSource(ds), (c) =>
			broken && c.method === "sale" && c.args[0] === poison.SaleID
				? new Cin7HttpError("Bad Request", 400)
				: undefined
		);
		// Two earlier runs already failed on it, so this one quarantines it.
		await testDb.sync_record_failure.create({
			data: {
				entity: "sales",
				record_id: poison.SaleID,
				attempts: 2,
				last_code: "CIN7_HTTP",
				last_message: "Bad Request",
				first_failed_at: at(-2 * HOUR),
				last_failed_at: at(-HOUR),
			},
		});
		const r1 = await runSync(deps(spy.source), "backfill");
		expect(r1).toMatchObject({ status: "ok", counts: { quarantined: 1 } });
		expect(await cursor("sales")).toMatchObject({ backfill_done: true });

		// Fixed in Cin7, which bumps its Updated stamp into the next incremental window.
		broken = false;
		editSale(ds, poison.SaleID, at(HOUR / 2), 77.5);
		const r2 = await runSync(
			deps(spy.source, { clock: () => at(HOUR) }),
			"incremental"
		);
		expect(r2.status).toBe("ok");
		expect(await firstLinePrice(poison.SaleID)).toBe(dec4(77.5));
		expect(await testDb.sync_record_failure.count()).toBe(0);
	});

	it("a quarantined record's own 5xx does not count toward the outage limit", async () => {
		const ds = smallDataset();
		const w = ds.saleList.filter((s) => inWindow(s.OrderDate)).map((s) => s.SaleID);
		const spy = spySource(createFixtureSource(ds), (c) =>
			c.method === "sale" && [w[2], w[3], w[4]].includes(c.args[0] as string)
				? new Cin7HttpError("Bad Gateway", 502)
				: undefined
		);
		// Three adjacent records that always 5xx; the first two are already quarantined.
		await testDb.sync_record_failure.createMany({
			data: [w[2]!, w[3]!].map((record_id) => ({
				entity: "sales",
				record_id,
				attempts: 3,
				last_code: "CIN7_HTTP",
				last_message: "Bad Gateway",
				first_failed_at: at(-3 * HOUR),
				last_failed_at: at(-HOUR),
			})),
		});
		const r = await runSync(deps(spy.source), "backfill");
		expect(r.status).toBe("partial"); // not failed: only w[4] counts, and it is blocking
		expect(r.counts).toMatchObject({ errors: 1, quarantined: 2 });
		expect(await testDb.stock_level.count()).toBe(ds.availability.length);
	});

	it("rate-limit retries exhausted → partial CIN7_RATE_LIMIT; unfinished cursors stay put", async () => {
		const spy = spySource(createFixtureSource(smallDataset()), (c) =>
			c.method === "saleList"
				? new Cin7RateLimitError("429 after 5 tries")
				: undefined
		);
		const r = await runSync(deps(spy.source), "backfill");
		expect(r).toMatchObject({ status: "partial", errorCode: "CIN7_RATE_LIMIT" });
		expect(await cursor("purchases")).toMatchObject({ backfill_done: true });
		expect(
			await testDb.sync_cursor.findUnique({ where: { entity: "sales" } })
		).toBeNull();
		// The run stops there: no stock sweep against a rate-limited API.
		expect(spy.called("availability")).toHaveLength(0);
		expect(await runRow(r.runId)).toMatchObject({
			status: "partial",
			error_code: "CIN7_RATE_LIMIT",
		});
	});

	it("an empty or unreadable stock sweep keeps the stored stock and does not fail the run", async () => {
		const ds = smallDataset();
		await runSync(deps(createFixtureSource(ds)), "backfill");
		const stock = await stockRows();
		expect(stock.length).toBeGreaterThan(100);

		const empty: Cin7Source = {
			...createFixtureSource(ds),
			availability: async (q) => ({ items: [], total: 0, page: q.page }),
		};
		const r1 = await runSync(deps(empty, { clock: () => at(HOUR) }), "incremental");
		expect(r1.status).toBe("partial");
		expect(r1.errorCode).toBeUndefined();
		expect((await runRow(r1.runId)).errors).toEqual([
			expect.objectContaining({ entity: "stock", id: null, code: "EMPTY_SWEEP" }),
		]);
		expect(await stockRows()).toEqual(stock);

		const fixture = createFixtureSource(ds);
		const unreadable: Cin7Source = {
			...fixture,
			availability: async (q) => {
				if (q.page === 2) throw new Cin7ParseError("not JSON", "<html>");
				return fixture.availability(q);
			},
		};
		const r2 = await runSync(
			deps(unreadable, { pageSize: 100, clock: () => at(2 * HOUR) }),
			"incremental"
		);
		expect(r2.status).toBe("partial");
		expect((await runRow(r2.runId)).errors).toEqual([
			expect.objectContaining({ entity: "stock", code: "INCOMPLETE" }),
		]);
		expect(await stockRows()).toEqual(stock);
	});

	it("targeted: one list call, then detail only for the target IDs; cursors untouched", async () => {
		const ds = smallDataset();
		const spy = spySource(createFixtureSource(ds));
		await runSync(deps(spy.source), "backfill");
		const [a, b] = editableSales(ds);
		editSale(ds, a!.SaleID, at(HOUR / 2), 111.25);
		editSale(ds, b!.SaleID, at(HOUR / 2), 222.25);
		const product = ds.products[5]!;
		product.AverageCost += 3;
		spy.calls.length = 0;

		const r = await runSync(deps(spy.source, { clock: () => at(HOUR) }), "targeted", {
			trigger: "webhook",
			targets: { sales: [a!.SaleID], products: [product.ID] },
		});
		expect(r.status).toBe("ok");
		expect(spy.calls.map((c) => c.method)).toEqual(["product", "saleList", "sale"]);
		expect(spy.called("saleList")[0]!.args[0]).toMatchObject({
			page: 1,
			updatedSince: at(-HOUR),
		});
		expect(await firstLinePrice(a!.SaleID)).toBe(dec4(111.25));
		expect(await firstLinePrice(b!.SaleID)).not.toBe(dec4(222.25));
		expect(
			await testDb.product_price_snapshot.count({
				where: { product_id: product.ID },
			})
		).toBe(2);
		expect(await cursor("sales")).toMatchObject({ last_success_at: T0 });
		expect(await runRow(r.runId)).toMatchObject({
			kind: "targeted",
			trigger: "webhook",
		});
	});

	it("targeted: order ids match case-insensitively", async () => {
		const ds = smallDataset();
		const spy = spySource(createFixtureSource(ds));
		await runSync(deps(spy.source), "backfill");
		const [a] = editableSales(ds);
		editSale(ds, a!.SaleID, at(HOUR / 2), 333.25);
		const r = await runSync(deps(spy.source, { clock: () => at(HOUR) }), "targeted", {
			trigger: "webhook",
			targets: { sales: [a!.SaleID.toUpperCase()] },
		});
		expect(r.status).toBe("ok");
		expect(await firstLinePrice(a!.SaleID)).toBe(dec4(333.25));
	});

	it("reconcile: full product sweep, 72 h order window; only full sweeps move cursors", async () => {
		const ds = smallDataset();
		const spy = spySource(createFixtureSource(ds));
		await runSync(deps(spy.source), "backfill");
		const T1 = at(100 * HOUR);
		const [recent] = editableSales(ds);
		editSale(ds, recent!.SaleID, at(50 * HOUR), 999.75); // 50 h before T1
		const product = ds.products[9]!;
		product.AverageCost += 7;
		spy.calls.length = 0;

		const r = await runSync(deps(spy.source, { clock: () => T1 }), "reconcile");
		expect(r.status).toBe("ok");
		expect(spy.called("products")[0]!.args[0]).not.toHaveProperty("modifiedSince");
		expect(spy.called("saleList")[0]!.args[0]).toMatchObject({
			updatedSince: new Date(T1.getTime() - 72 * HOUR),
		});
		expect(await firstLinePrice(recent!.SaleID)).toBe(dec4(999.75));
		expect(
			await testDb.product_price_snapshot.count({
				where: { product_id: product.ID },
			})
		).toBe(2);
		expect(await cursor("products")).toMatchObject({ last_success_at: T1 });
		expect(await cursor("sales")).toMatchObject({ last_success_at: T0 });
	});
});

describe("scheduler", () => {
	const failFast = () =>
		spySource(createFixtureSource(demoDataset()), (c) =>
			c.method === "me" ? new Cin7AuthError("no key") : undefined
		);

	it("scheduler skips the tick while the advisory lock is held", async () => {
		const spy = failFast();
		const tick = createSyncTick(deps(spy.source), SCHEDULE);
		// A run whose process died: still "running" in the table.
		const stale = await testDb.sync_run.create({
			data: {
				kind: "backfill",
				trigger: "schedule",
				status: "running",
				started_at: T0,
			},
		});

		await testDb.$transaction(async (tx) => {
			await tx.$executeRaw`SELECT pg_advisory_xact_lock(727001)`;
			expect(await tick()).toEqual({ acquired: false });
		});
		expect(spy.calls).toHaveLength(0);
		expect(await testDb.sync_run.count()).toBe(1);
		expect((await runRow(stale.id)).status).toBe("running");

		const r = await tick();
		expect(r).toMatchObject({
			acquired: true,
			result: { status: "failed", errorCode: "CIN7_AUTH" },
		});
		expect(spy.called("me")).toHaveLength(1);
		// Holding the lock proves no run is live, so the leftover row is closed.
		expect(await runRow(stale.id)).toMatchObject({
			status: "failed",
			error_code: "INTERRUPTED",
		});
	});

	it("runs reconcile on the first tick after 02:00 in the cached Cin7 time zone", async () => {
		// Last reconcile: Nov 9 06:00 in New York, 03:00 in Los Angeles.
		await testDb.sync_run.create({
			data: {
				kind: "reconcile",
				trigger: "schedule",
				status: "ok",
				started_at: new Date("2026-11-09T11:00:00Z"),
			},
		});
		// Now: Nov 10 02:30 in New York, still Nov 9 23:30 in Los Angeles.
		const now = new Date("2026-11-10T07:30:00Z");
		const tick = createSyncTick(
			deps(failFast().source, { clock: () => now }),
			SCHEDULE
		);
		const kindOfTick = async () => {
			const r = await tick();
			if (!r.acquired) throw new Error("lock unexpectedly held");
			return (await runRow(r.result.runId)).kind;
		};
		expect(await kindOfTick()).toBe("incremental"); // APP_TIMEZONE fallback
		await testDb.app_setting.create({
			data: {
				key: "cin7.me",
				value: {
					company: "X",
					currency: "USD",
					timeZone: "America/New_York",
				},
			},
		});
		expect(await kindOfTick()).toBe("reconcile");
		// failFast makes that run fail, and only a successful reconcile satisfies the night.
		await testDb.sync_run.updateMany({
			where: { kind: "reconcile", status: { not: "ok" } },
			data: { status: "ok" },
		});
		expect(await kindOfTick()).toBe("incremental"); // once per night
	});

	it("a failed reconcile does not count as tonight's reconcile", async () => {
		const mk = (status: "ok" | "failed", at: string) =>
			testDb.sync_run.create({
				data: {
					kind: "reconcile",
					trigger: "schedule",
					status,
					started_at: new Date(at),
				},
			});
		await mk("ok", "2026-11-08T12:00:00Z");
		await mk("failed", "2026-11-10T11:00:00Z"); // 03:00 in Los Angeles
		const tick = createSyncTick(
			deps(failFast().source, { clock: () => new Date("2026-11-10T20:00:00Z") }),
			SCHEDULE
		);
		const r = await tick();
		if (!r.acquired) throw new Error("lock unexpectedly held");
		expect((await runRow(r.result.runId)).kind).toBe("reconcile");
	});

	it("a failed reconcile is retried at most once an hour", async () => {
		await testDb.sync_run.create({
			data: {
				kind: "reconcile",
				trigger: "schedule",
				status: "ok",
				started_at: new Date("2026-11-08T12:00:00Z"),
			},
		});
		let now = new Date("2026-11-10T11:00:00Z"); // 03:00 in Los Angeles
		const tick = createSyncTick(
			deps(failFast().source, { clock: () => now }),
			SCHEDULE
		);
		const kindOfTick = async () => {
			const r = await tick();
			if (!r.acquired) throw new Error("lock unexpectedly held");
			return (await runRow(r.result.runId)).kind;
		};
		expect(await kindOfTick()).toBe("reconcile"); // fails
		now = new Date("2026-11-10T11:05:00Z");
		expect(await kindOfTick()).toBe("incremental"); // too soon to retry
		now = new Date("2026-11-10T12:01:00Z");
		expect(await kindOfTick()).toBe("reconcile"); // an hour later
	});

	it("never starts under NODE_ENV=test", () => {
		vi.useFakeTimers();
		try {
			const handle = startScheduler(deps(failFast().source), SCHEDULE);
			expect(vi.getTimerCount()).toBe(0);
			handle.stop();
		} finally {
			vi.useRealTimers();
		}
	});

	it("nightlyPeriod rolls over at 02:00 local time, DST days included", () => {
		const la = (iso: string) =>
			nightlyPeriod(new Date(iso), "America/Los_Angeles", "02:00");
		expect(la("2026-11-09T09:59:00Z")).toBe("2026-11-08"); // 01:59 PST
		expect(la("2026-11-09T10:00:00Z")).toBe("2026-11-09"); // 02:00 PST
		expect(la("2026-03-08T09:30:00Z")).toBe("2026-03-07"); // 01:30 PST
		expect(la("2026-03-08T10:00:00Z")).toBe("2026-03-08"); // 03:00 PDT; 02:00 was skipped
	});
});

describe("dev seed", () => {
	const pointKey = (pt: SeedHistoryPoint) =>
		[dec4(pt.averageCost), ...pt.tierPrices.map(dec4)].join("|");

	it("seed inserts seedHistory snapshots with source 'seed'", async () => {
		const ds = demoDataset();
		// One snapshot per change, like the live sync: unchanged months add nothing.
		const expected = ds.seedHistory.reduce(
			(n, h) =>
				n +
				h.points.filter(
					(pt, i) =>
						i === 0 ||
						pointKey(pt) !== pointKey(h.points[i - 1]!)
				).length,
			0
		);
		const r = await seedDemo(testDb, { clock: () => T0, log });
		expect(r.run.status).toBe("ok");
		expect(r.seedSnapshots).toBe(expected);
		expect(
			await testDb.product_price_snapshot.count({ where: { source: "seed" } })
		).toBe(expected);
		// The whole demo window is mirrored, even orders older than BACKFILL_MONTHS.
		expect(await testDb.sale.count()).toBe(ds.sales.length);
		expect(await testDb.purchase.count()).toBe(ds.purchases.length);
		expect((await runRow(r.run.runId)).trigger).toBe("seed");

		const h = ds.seedHistory[0]!;
		const snaps = await testDb.product_price_snapshot.findMany({
			where: { product_id: h.productId },
			orderBy: { observed_at: "asc" },
		});
		expect(snaps[0]).toMatchObject({
			source: "seed",
			observed_at: new Date(`${h.points[0]!.month}-01T12:00:00.000Z`),
		});
		expect(snaps[snaps.length - 1]).toMatchObject({ source: "sync", observed_at: T0 });

		// Re-seeding replaces the history instead of stacking a second copy.
		await seedDemo(testDb, { clock: () => at(HOUR), log });
		expect(
			await testDb.product_price_snapshot.count({ where: { source: "seed" } })
		).toBe(expected);
	});
});
