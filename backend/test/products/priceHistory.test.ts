import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
	buildPriceHistory,
	marginPct,
	type PriceHistoryInput,
} from "../../src/products/priceHistory.js";
import type { AppDeps } from "../../src/app.js";
import { testApp } from "../helpers/app.js";
import { insertUser, loginAs } from "../helpers/auth.js";
import { resetDb, testDb } from "../helpers/db.js";

const empty: PriceHistoryInput = { purchases: [], snapshots: [], saleLines: [], tiers: [] };
const tiers = [
	{ code: 1, name: "Retail" },
	{ code: 2, name: "Wholesale" },
];
const zeros = (...head: number[]) => [...head, ...Array(10 - head.length).fill(0)];
const snap = (observedAt: string, averageCost: number, tierPrices: number[], source = "sync") => ({
	observedAt,
	averageCost,
	tierPrices,
	source: source as "sync" | "seed",
});
const line = (date: string, unitPrice: number, qty = 1, tierName: string | null = "Retail") => ({
	date,
	tierName,
	unitPrice,
	qty,
	averageCost: null,
});
const purchase = (date: string, unitCost: number, n = 1) => ({
	date,
	unitCost,
	qty: 1,
	purchaseId: `p${n}`,
	orderNumber: `PO-${n}`,
	supplier: "S",
});

describe("buildPriceHistory", () => {
	it("carry-in: avg cost 100 set before range, 110 inside → series starts at range.from with 100", () => {
		const h = buildPriceHistory(
			{
				...empty,
				snapshots: [
					snap("2026-01-01", 100, zeros()),
					snap("2026-03-10", 110, zeros()),
				],
			},
			{ range: "30d", today: "2026-04-01", timeZone: "UTC" }
		);
		expect(h.range).toEqual({ from: "2026-03-02", to: "2026-04-01" });
		expect(h.averageCost).toEqual([
			{ date: "2026-03-02", value: 100 },
			{ date: "2026-03-10", value: 110 },
		]);
		expect(h.stats.averageCost).toBe(110);
	});

	it("tier with all-zero prices is absent; tier set to 0 mid-range ends its line at that day", () => {
		const h = buildPriceHistory(
			{
				...empty,
				tiers: [...tiers, { code: 3, name: "Trade" }],
				snapshots: [
					snap("2026-02-20", 5, zeros(50, 0, 0)),
					snap("2026-03-10", 5, zeros(55, 0, 0)),
					snap("2026-03-20", 5, zeros(0, 0, 0)),
				],
			},
			{ range: "30d", today: "2026-04-01", timeZone: "UTC" }
		);
		expect(h.listPrices.map((t) => t.name)).toEqual(["Retail"]);
		expect(h.listPrices[0]!.points).toEqual([
			{ date: "2026-03-02", value: 50 },
			{ date: "2026-03-10", value: 55 },
			{ date: "2026-03-20", value: null },
		]);
	});

	it("set → unset → set: a null point splits the line; repeated unset snapshots collapse", () => {
		const h = buildPriceHistory(
			{
				...empty,
				tiers,
				snapshots: [
					snap("2026-03-05", 5, zeros(50)),
					snap("2026-03-10", 5, zeros(0)),
					snap("2026-03-12", 5, zeros(0)),
					snap("2026-03-20", 5, zeros(60)),
				],
			},
			{ range: "30d", today: "2026-04-01", timeZone: "UTC" }
		);
		expect(h.listPrices[0]!.points).toEqual([
			{ date: "2026-03-05", value: 50 },
			{ date: "2026-03-10", value: null },
			{ date: "2026-03-20", value: 60 },
		]);
	});

	it("a tier unset when the range starts and set later begins at the set day", () => {
		const h = buildPriceHistory(
			{
				...empty,
				tiers,
				snapshots: [
					snap("2026-01-01", 5, zeros(40)),
					snap("2026-02-01", 5, zeros(0)),
					snap("2026-03-15", 5, zeros(45)),
				],
			},
			{ range: "30d", today: "2026-04-01", timeZone: "UTC" }
		);
		expect(h.listPrices[0]!.points).toEqual([{ date: "2026-03-15", value: 45 }]);
	});

	it("a tier zeroed before the range and never reset is absent", () => {
		const h = buildPriceHistory(
			{
				...empty,
				tiers,
				snapshots: [
					snap("2026-01-01", 5, zeros(50)),
					snap("2026-01-05", 5, zeros(0)),
				],
			},
			{ range: "30d", today: "2026-04-01", timeZone: "UTC" }
		);
		expect(h.listPrices).toEqual([]);
	});

	it("collapses consecutive equal values", () => {
		const h = buildPriceHistory(
			{
				...empty,
				tiers,
				snapshots: [
					snap("2026-03-05", 7, zeros(10)),
					snap("2026-03-06", 7, zeros(10)),
					snap("2026-03-07", 8, zeros(10)),
				],
			},
			{ range: "30d", today: "2026-04-01", timeZone: "UTC" }
		);
		expect(h.averageCost).toEqual([
			{ date: "2026-03-05", value: 7 },
			{ date: "2026-03-07", value: 8 },
		]);
		expect(h.listPrices[0]!.points).toEqual([{ date: "2026-03-05", value: 10 }]);
	});

	it("snapshot instants become calendar days in the app time zone", () => {
		// 03:00Z on Mar 2 is still Mar 1 evening in Los Angeles.
		const h = buildPriceHistory(
			{ ...empty, snapshots: [snap("2026-03-02T03:00:00.000Z", 9, zeros())] },
			{ range: "30d", today: "2026-03-20", timeZone: "America/Los_Angeles" }
		);
		expect(h.averageCost).toEqual([{ date: "2026-03-01", value: 9 }]);
	});

	it("sale-line average cost fills the series; a snapshot wins on the same day", () => {
		const h = buildPriceHistory(
			{
				...empty,
				snapshots: [snap("2026-03-10T12:00:00Z", 12, zeros())],
				saleLines: [
					{ ...line("2026-03-05", 1), averageCost: 10 },
					{ ...line("2026-03-10", 1), averageCost: 99 },
					{ ...line("2026-03-12", 1), averageCost: 12 },
				],
			},
			{ range: "30d", today: "2026-04-01", timeZone: "UTC" }
		);
		expect(h.averageCost).toEqual([
			{ date: "2026-03-05", value: 10 },
			{ date: "2026-03-10", value: 12 },
		]);
	});

	it("a sale line before the range supplies the carry-in but stays out of sold prices", () => {
		const h = buildPriceHistory(
			{
				...empty,
				saleLines: [{ ...line("2026-01-05", 40, 5), averageCost: 30 }],
			},
			{ range: "30d", today: "2026-04-01", timeZone: "UTC" }
		);
		expect(h.averageCost).toEqual([{ date: "2026-03-02", value: 30 }]);
		expect(h.soldPrices).toEqual([]);
		expect(h.stats.avgSoldPrice).toBeNull();
	});

	it("CAD line already in base currency plots unchanged", () => {
		// The base value arrives pre-converted (Task 6); nothing here may rescale it.
		const h = buildPriceHistory(
			{
				...empty,
				purchases: [purchase("2026-03-05", 100)],
				saleLines: [line("2026-03-05", 100)],
			},
			{ range: "30d", today: "2026-03-20", timeZone: "UTC" }
		);
		expect(h.purchaseCost[0]!.unitCost).toBe(100);
		expect(h.soldPrices[0]!.buckets[0]!.avg).toBe(100);
	});

	it("sale dated 2026-03-01 lands in the week of Mon 2026-02-23, month 2026-03", () => {
		const input = { ...empty, saleLines: [line("2026-03-01", 10)] };
		const week = buildPriceHistory(input, {
			range: "90d",
			today: "2026-03-15",
			timeZone: "UTC",
		});
		expect(week.bucket).toBe("week");
		expect(week.soldPrices[0]!.buckets[0]!.start).toBe("2026-02-23");
		const month = buildPriceHistory(input, {
			range: "6m",
			today: "2026-03-15",
			timeZone: "UTC",
		});
		expect(month.bucket).toBe("month");
		expect(month.soldPrices[0]!.buckets[0]!.start).toBe("2026-03-01");
	});

	it("units-weighted bucket avg: 2 × 100 and 1 × 130 → 110", () => {
		const h = buildPriceHistory(
			{
				...empty,
				saleLines: [
					line("2026-03-03", 100, 2),
					line("2026-03-04", 130, 1),
					line("2026-03-05", 90, 1, null),
				],
			},
			{ range: "30d", today: "2026-03-20", timeZone: "UTC" }
		);
		expect(h.soldPrices.map((s) => s.tierName)).toEqual(["Retail", "No tier"]);
		expect(h.soldPrices[0]!.buckets).toEqual([
			{ start: "2026-03-02", avg: 110, min: 100, max: 130, units: 3 },
		]);
	});

	it("margin: sold 3 × 110, avg cost 80 → 27.27%", () => {
		const lines = [{ qty: 3, unitPrice: 110, averageCost: 80 }];
		expect(marginPct(lines)).toBe(27.27);
		const h = buildPriceHistory(
			{
				...empty,
				saleLines: [{ ...line("2026-03-03", 110, 3), averageCost: 80 }],
			},
			{ range: "30d", today: "2026-03-20", timeZone: "UTC" }
		);
		expect(h.stats.marginPct).toBe(27.27);
		expect(h.stats.avgSoldPrice).toBe(110);
	});

	it("margin ignores lines without an average cost, and is null with none", () => {
		expect(marginPct([{ qty: 1, unitPrice: 50, averageCost: null }])).toBeNull();
		expect(
			marginPct([
				{ qty: 1, unitPrice: 100, averageCost: 60 },
				{ qty: 9, unitPrice: 500, averageCost: null },
			])
		).toBe(40);
	});

	it("purchases are markers with no carry-in; change % compares last to first in range", () => {
		const h = buildPriceHistory(
			{
				...empty,
				purchases: [
					purchase("2026-01-01", 1, 1),
					purchase("2026-03-10", 80, 2),
					purchase("2026-03-20", 100, 3),
				],
			},
			{ range: "30d", today: "2026-03-25", timeZone: "UTC" }
		);
		expect(h.purchaseCost.map((p) => p.purchaseId)).toEqual(["p2", "p3"]);
		expect(h.stats.lastPurchaseCost).toBe(100);
		expect(h.stats.purchaseCostChangePct).toBe(25);
	});

	it("a single purchase has no change %", () => {
		const h = buildPriceHistory(
			{ ...empty, purchases: [purchase("2026-03-10", 80)] },
			{ range: "30d", today: "2026-03-25", timeZone: "UTC" }
		);
		expect(h.stats.purchaseCostChangePct).toBeNull();
	});

	it("range: 6m and 1y step back by calendar month, all starts at the earliest point", () => {
		const q = (range: "6m" | "1y" | "all") =>
			buildPriceHistory(
				{ ...empty, purchases: [purchase("2025-02-14", 1)] },
				{ range, today: "2026-08-31", timeZone: "UTC" }
			).range;
		expect(q("6m").from).toBe("2026-02-28");
		expect(q("1y").from).toBe("2025-08-31");
		expect(q("all")).toEqual({ from: "2025-02-14", to: "2026-08-31" });
	});

	it("listTrackingStartedAt ignores seed snapshots", () => {
		const h = buildPriceHistory(
			{
				...empty,
				snapshots: [
					snap("2025-01-01", 1, zeros(), "seed"),
					snap("2026-02-10", 1, zeros(), "sync"),
					snap("2026-03-10", 1, zeros(), "sync"),
				],
			},
			{ range: "all", today: "2026-04-01", timeZone: "UTC" }
		);
		expect(h.listTrackingStartedAt).toBe("2026-02-10");
		const seedOnly = buildPriceHistory(
			{ ...empty, snapshots: [snap("2025-01-01", 1, zeros(), "seed")] },
			{ range: "all", today: "2026-04-01", timeZone: "UTC" }
		);
		expect(seedOnly.listTrackingStartedAt).toBeNull();
	});
});

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const P = id(1);
const now = new Date("2026-03-01T12:00:00Z");
let seq = 0;

const mkSale = async (
	date: string,
	opts: {
		price: string;
		base?: string;
		cur?: string;
		counted?: boolean;
		avg?: string;
		tier?: string;
	}
) => {
	seq += 1;
	await testDb.sale.create({
		data: {
			id: id(2000 + seq),
			order_number: `SO-${seq}`,
			type: "Simple Sale",
			status: "AUTHORISED",
			order_status: "AUTHORISED",
			counted: opts.counted ?? true,
			customer_name: "C",
			price_tier_name: opts.tier ?? "Retail",
			order_date: new Date(`${date}T00:00:00.000Z`),
			currency: opts.cur ?? "USD",
			base_currency: "USD",
			currency_rate: "1",
			total: opts.price,
			total_base: opts.base ?? opts.price,
			cin7_updated_at: now,
			raw: {},
			synced_at: now,
			lines: {
				create: [
					{
						line_no: 1,
						product_id: P,
						sku: "x",
						name: "x",
						quantity: "1",
						unit_price: opts.price,
						discount_pct: "0",
						unit_price_base: opts.base ?? opts.price,
						average_cost: opts.avg ?? null,
						total_base: opts.price,
					},
				],
			},
		},
	});
};

const mkPurchase = async (date: string, cost: string, counted = true) => {
	seq += 1;
	await testDb.purchase.create({
		data: {
			id: id(1000 + seq),
			order_number: `PO-${seq}`,
			type: "Simple Purchase",
			status: "AUTHORISED",
			order_status: "AUTHORISED",
			counted,
			supplier_name: "Acme",
			order_date: new Date(`${date}T00:00:00.000Z`),
			currency: "USD",
			base_currency: "USD",
			currency_rate: "1",
			total: cost,
			total_base: cost,
			cin7_updated_at: now,
			raw: {},
			synced_at: now,
			lines: {
				create: [
					{
						line_no: 1,
						product_id: P,
						sku: "x",
						name: "x",
						quantity: "1",
						unit_price: cost,
						discount_pct: "0",
						unit_cost_base: cost,
						total_base: cost,
					},
				],
			},
		},
	});
};

const mkSnap = (observedAt: string, avg: string, tp: string[], source: "sync" | "seed" = "sync") =>
	testDb.product_price_snapshot.create({
		data: {
			product_id: P,
			observed_at: new Date(observedAt),
			average_cost: avg,
			tier_prices: [...tp, ...Array(10 - tp.length).fill("0")],
			source,
		},
	});

beforeEach(async () => {
	await resetDb();
	seq = 0;
	await testDb.price_tier.createMany({
		data: [{ code: 1, name: "Retail", synced_at: now }],
	});
	await testDb.product.create({
		data: {
			id: P,
			sku: "SKU-1",
			name: "Widget",
			type: "Stock",
			status: "Active",
			average_cost: "5",
			tier_prices: Array(10).fill("0"),
			raw: {},
			synced_at: now,
		},
	});
	await insertUser("v@example.com");
});
afterAll(() => testDb.$disconnect());

const get = async (qs = "", pid = P, over: Partial<AppDeps> = {}) => {
	const agent = await loginAs(
		testApp({ timeZone: "America/Los_Angeles", ...over }),
		"v@example.com"
	);
	return agent.get(`/api/products/${pid}/price-history${qs}`);
};

describe("GET /api/products/:id/price-history", () => {
	it("route excludes voided/draft orders", async () => {
		await mkPurchase("2026-02-10", "10");
		await mkPurchase("2026-02-11", "999", false);
		await mkSale("2026-02-10", { price: "20" });
		await mkSale("2026-02-11", { price: "888", counted: false });
		const res = await get("?range=30d");
		expect(res.status).toBe(200);
		expect(
			res.body.data.purchaseCost.map((p: { unitCost: number }) => p.unitCost)
		).toEqual([10]);
		expect(res.body.data.soldPrices[0].buckets).toEqual([
			{ start: "2026-02-09", avg: 20, min: 20, max: 20, units: 1 },
		]);
	});

	it("CAD sale plots at its base value, and the order date is not shifted", async () => {
		await mkSale("2026-03-01", { price: "130", base: "100", cur: "CAD" });
		const res = await get("?range=90d");
		const b = res.body.data.soldPrices[0].buckets[0];
		expect(b.avg).toBe(100);
		expect(b.start).toBe("2026-02-23");
	});

	it("today is the app-zone day; snapshots carry in and seed history is not tracking", async () => {
		// Clock is 2026-03-01T12:00Z → Mar 1 in Los Angeles; 30d starts Jan 30.
		await mkSnap("2026-01-01T10:00:00Z", "100", ["50"], "seed");
		await mkSnap("2026-02-15T10:00:00Z", "110", ["55"], "sync");
		const res = await get("?range=30d");
		const d = res.body.data;
		expect(d.range).toEqual({ from: "2026-01-30", to: "2026-03-01" });
		expect(d.averageCost).toEqual([
			{ date: "2026-01-30", value: 100 },
			{ date: "2026-02-15", value: 110 },
		]);
		expect(d.listPrices[0]).toMatchObject({ code: 1, name: "Retail" });
		expect(d.listTrackingStartedAt).toBe("2026-02-15");
	});

	it("tracking start is found even when the first live snapshot predates the range", async () => {
		await mkSnap("2025-06-01T10:00:00Z", "1", ["5"], "sync");
		await mkSnap("2026-02-20T10:00:00Z", "2", ["6"], "sync");
		const res = await get("?range=30d");
		expect(res.body.data.listTrackingStartedAt).toBe("2025-06-01");
	});

	it("keeps the newest rows of a long history", async () => {
		await testDb.sale.deleteMany();
		for (let i = 0; i < 12; i++)
			await mkSale(`2025-0${(i % 9) + 1}-10`, { price: "1" });
		await mkSale("2026-02-27", { price: "77" });
		const res = await get("?range=all");
		const last = res.body.data.soldPrices[0].buckets.at(-1);
		expect(last).toMatchObject({ start: "2026-02-01", avg: 77 });
	});

	it("unknown range → 400 VALIDATION_ERROR; unknown product → 404 NOT_FOUND; no session → 401", async () => {
		const bad = await get("?range=2y");
		expect(bad.status).toBe(400);
		expect(bad.body.error.code).toBe("VALIDATION_ERROR");
		const missing = await get("", id(99));
		expect(missing.status).toBe(404);
		expect(missing.body.error.code).toBe("NOT_FOUND");
		const anon = await (await import("supertest"))
			.default(testApp())
			.get(`/api/products/${P}/price-history`);
		expect(anon.status).toBe(401);
	});

	it("cached Cin7 time zone beats the env zone", async () => {
		// 12:00Z Mar 1 is Mar 2 01:00 in Auckland but Mar 1 04:00 in Los Angeles.
		await testDb.app_setting.create({
			data: {
				key: "cin7.me",
				value: {
					company: "C",
					currency: "USD",
					timeZone: "Pacific/Auckland",
				},
			},
		});
		await mkSnap("2026-02-20T12:30:00Z", "3", ["5"]);
		await mkSnap("2026-02-27T12:30:00Z", "4", ["5"]);
		const d = (await get("?range=30d")).body.data;
		expect(d.range.to).toBe("2026-03-02");
		expect(d.averageCost).toEqual([
			{ date: "2026-02-21", value: 3 },
			{ date: "2026-02-28", value: 4 },
		]);
	});

	it("a clock past UTC midnight is still the previous day in Los Angeles", async () => {
		await mkSnap("2026-03-02T03:00:00Z", "6", ["5"]);
		const res = await get("?range=30d", P, {
			clock: () => new Date("2026-03-02T05:00:00Z"),
		});
		expect(res.body.data.range.to).toBe("2026-03-01");
		expect(res.body.data.averageCost).toEqual([{ date: "2026-03-01", value: 6 }]);
		expect(res.body.data.listTrackingStartedAt).toBe("2026-03-01");
	});

	it("defaults to 90d", async () => {
		const res = await get();
		expect(res.body.data.range).toEqual({ from: "2025-12-01", to: "2026-03-01" });
		expect(res.body.data.bucket).toBe("week");
	});
});
