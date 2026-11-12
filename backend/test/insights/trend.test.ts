import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { testApp } from "../helpers/app.js";
import { agentFor, insertUser, loginAs } from "../helpers/auth.js";
import { resetDb, testDb } from "../helpers/db.js";

// testApp's clock is 2026-03-01T12:00Z, i.e. Sunday Mar 1 in the fallback zone.
const now = new Date("2026-03-01T12:00:00Z");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const zeroTiers = ["0", "0", "0", "0", "0", "0", "0", "0", "0", "0"];
const day = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

const mkProduct = (n: number, category: string | null) =>
	testDb.product.create({
		data: {
			id: id(n),
			sku: `SKU-${n}`,
			name: `Widget ${n}`,
			type: "Stock",
			status: "Active",
			category,
			average_cost: "10",
			tier_prices: zeroTiers,
			raw: {},
			synced_at: now,
		},
	});

type PoLine = { productId: string | null; qty: number; cost: number };
const mkPo = (n: number, date: string, lines: PoLine[], counted = true) =>
	testDb.purchase.create({
		data: {
			id: id(1000 + n),
			order_number: `PO-${n}`,
			type: "Simple Purchase",
			status: counted ? "AUTHORISED" : "DRAFT",
			order_status: counted ? "AUTHORISED" : "DRAFT",
			counted,
			supplier_name: "Acme Supply",
			order_date: day(date),
			currency: "USD",
			base_currency: "USD",
			currency_rate: "1",
			total: "1",
			total_base: "1",
			cin7_updated_at: now,
			raw: {},
			synced_at: now,
			lines: {
				create: lines.map((l, i) => ({
					line_no: i + 1,
					product_id: l.productId,
					sku: "S",
					name: "N",
					quantity: String(l.qty),
					unit_price: String(l.cost),
					discount_pct: "0",
					unit_cost_base: String(l.cost),
					total_base: String(l.qty * l.cost),
				})),
			},
		},
	});

type SoLine = { productId: string | null; qty: number; price: number; avg: number | null };
const mkSo = (n: number, date: string, lines: SoLine[], status = "AUTHORISED", cad = false) =>
	testDb.sale.create({
		data: {
			id: id(2000 + n),
			order_number: `SO-${n}`,
			type: "Simple Sale",
			status,
			order_status: status,
			counted: status === "AUTHORISED",
			customer_name: "Initech",
			order_date: day(date),
			currency: cad ? "CAD" : "USD",
			base_currency: "USD",
			currency_rate: cad ? "0.5" : "1",
			total: "1",
			total_base: "1",
			cin7_updated_at: now,
			raw: {},
			synced_at: now,
			lines: {
				create: lines.map((l, i) => ({
					line_no: i + 1,
					product_id: l.productId,
					sku: "S",
					name: "N",
					quantity: String(l.qty),
					// A CAD line's unit_price is in CAD; only *_base feeds charts.
					unit_price: String(cad ? l.price * 2 : l.price),
					discount_pct: "0",
					unit_price_base: String(l.price),
					average_cost: l.avg === null ? null : String(l.avg),
					total_base: String(l.qty * l.price),
				})),
			},
		},
	});

beforeEach(async () => {
	await resetDb();
	await insertUser("v@example.com");
});
afterAll(() => testDb.$disconnect());

const get = async (path: string) => {
	const agent = await loginAs(testApp(), "v@example.com");
	return agent.get(path);
};

const baseSeed = async () => {
	await mkProduct(1, "Fans");
	await mkPo(1, "2026-02-10", [{ productId: id(1), qty: 10, cost: 8 }]);
	await mkPo(2, "2025-06-10", [{ productId: id(1), qty: 1, cost: 5 }]);
	await mkSo(1, "2026-02-12", [
		{ productId: id(1), qty: 2, price: 20, avg: 10 },
		{ productId: id(1), qty: 1, price: 30, avg: null },
	]);
	await mkSo(2, "2025-06-20", [{ productId: id(1), qty: 1, price: 50, avg: 20 }]);
};

describe("GET /api/insights/trend", () => {
	it("no session → 401; bad range → 400", async () => {
		expect((await agentFor(testApp()).get("/api/insights/trend")).status).toBe(401);
		expect((await get("/api/insights/trend?range=2w")).status).toBe(400);
	});

	it("totals equal /api/overview for 30d, 1y and all", async () => {
		await baseSeed();
		for (const range of ["30d", "1y", "all"]) {
			const t = (await get(`/api/insights/trend?range=${range}`)).body.data
				.totals;
			const k = (await get(`/api/overview?range=${range}`)).body.data.kpis;
			expect(t.sales).toBe(k.sales);
			expect(t.purchases).toBe(k.purchases);
			expect(t.grossMarginPct).toBe(k.grossMarginPct);
		}
		const t30 = (await get("/api/insights/trend?range=30d")).body.data.totals;
		expect(t30).toEqual({
			sales: 70,
			purchases: 80,
			grossProfit: 20,
			grossMarginPct: 50,
		});
	});

	it("a week with no orders is a zero bar with a null margin", async () => {
		// 90d from Mar 1 starts Dec 1 (Mon).
		await mkProduct(1, "Fans");
		await mkSo(1, "2025-12-02", [{ productId: id(1), qty: 1, price: 10, avg: 4 }]); // week 1
		await mkSo(2, "2025-12-16", [{ productId: id(1), qty: 1, price: 10, avg: 4 }]); // week 3
		const { period, points, from, to } = (await get("/api/insights/trend?range=90d"))
			.body.data;
		expect(period).toBe("week");
		expect([from, to]).toEqual(["2025-12-01", "2026-03-01"]);
		expect(points[0].start).toBe("2025-12-01");
		expect(points[0].sales).toBe(10);
		expect(points[0].grossMarginPct).toBe(60);
		expect(points[1]).toMatchObject({
			start: "2025-12-08",
			sales: 0,
			purchases: 0,
			grossProfit: 0,
			grossMarginPct: null,
		});
		expect(points[2].start).toBe("2025-12-15");
		expect(points[2].sales).toBe(10);
	});

	it("voided sales and draft purchases are excluded", async () => {
		await mkProduct(1, "Fans");
		await mkSo(1, "2026-02-12", [{ productId: id(1), qty: 1, price: 10, avg: 4 }]);
		await mkSo(
			2,
			"2026-02-12",
			[{ productId: id(1), qty: 9, price: 100, avg: 1 }],
			"VOIDED"
		);
		await mkPo(1, "2026-02-12", [{ productId: id(1), qty: 1, cost: 3 }]);
		await mkPo(2, "2026-02-12", [{ productId: id(1), qty: 9, cost: 100 }], false);
		const { totals } = (await get("/api/insights/trend?range=30d")).body.data;
		expect(totals.sales).toBe(10);
		expect(totals.purchases).toBe(3);
	});

	it("a CAD sale counts at its base total", async () => {
		await mkProduct(1, "Fans");
		await mkSo(
			1,
			"2026-02-12",
			[{ productId: id(1), qty: 2, price: 10, avg: 4 }],
			"AUTHORISED",
			true
		);
		const { totals } = (await get("/api/insights/trend?range=30d")).body.data;
		expect(totals.sales).toBe(20);
	});

	it("7 categories → 5 named + Other + Uncategorised; mix sums to sales", async () => {
		for (let n = 1; n <= 7; n++) await mkProduct(n, `Cat ${n}`);
		await mkProduct(8, null);
		// Cat n sells n × 10, so Cat 1 and Cat 2 fall outside the top 5.
		for (let n = 1; n <= 7; n++)
			await mkSo(n, "2026-02-12", [
				{ productId: id(n), qty: n, price: 10, avg: 1 },
			]);
		await mkSo(8, "2026-02-12", [
			{ productId: id(8), qty: 1, price: 7.3333, avg: 1 },
			{ productId: null, qty: 1, price: 2.1111, avg: 1 },
		]);
		const { mixKeys, points, totals } = (await get("/api/insights/trend?range=30d"))
			.body.data;
		expect(mixKeys).toEqual([
			"Cat 7",
			"Cat 6",
			"Cat 5",
			"Cat 4",
			"Cat 3",
			"Other",
			"Uncategorised",
		]);
		const p = points.find((x: { sales: number }) => x.sales > 0);
		expect(Object.keys(p.mix)).toEqual(mixKeys);
		expect(p.mix.Other).toBe(30);
		expect(p.mix.Uncategorised).toBe(9.4444);
		const sum = Object.values(p.mix as Record<string, number>).reduce(
			(s, v) => s + v,
			0
		);
		expect(sum).toBeCloseTo(p.sales, 4);
		expect(totals.sales).toBe(p.sales);
		// Empty weeks still carry every key at 0.
		const empty = points.find((x: { sales: number }) => x.sales === 0);
		expect(empty.mix).toEqual(Object.fromEntries(mixKeys.map((k: string) => [k, 0])));
	});

	it.each(["Other", "Uncategorised"])(
		"a real category named %s merges into the synthetic bucket: unique keys, mix = sales",
		async (name) => {
			// Real `name` is the top seller; Cat 1..5 follow, so Cat 5 is the 6th category (the tail).
			await mkProduct(1, name);
			for (let n = 2; n <= 7; n++) await mkProduct(n, `Cat ${n}`);
			await mkProduct(8, null);
			await mkSo(1, "2026-02-12", [
				{ productId: id(1), qty: 100, price: 10, avg: 1 },
			]);
			for (let n = 2; n <= 7; n++)
				await mkSo(n, "2026-02-12", [
					{ productId: id(n), qty: 8 - n, price: 10, avg: 1 },
				]);
			await mkSo(8, "2026-02-12", [
				{ productId: id(8), qty: 1, price: 5, avg: 1 },
			]);
			const { mixKeys, points, totals } = (
				await get("/api/insights/trend?range=30d")
			).body.data;
			expect(new Set(mixKeys).size).toBe(mixKeys.length);
			expect(mixKeys.filter((k: string) => k === name)).toHaveLength(1);
			expect(mixKeys).toContain("Other");
			expect(mixKeys).toContain("Uncategorised");
			const p = points.find((x: { sales: number }) => x.sales > 0);
			expect(Object.keys(p.mix)).toEqual(mixKeys);
			const sum = Object.values(p.mix as Record<string, number>).reduce(
				(s, v) => s + v,
				0
			);
			expect(sum).toBeCloseTo(p.sales, 4);
			expect(p.sales).toBe(totals.sales);
			// Cat 2..7 sell 60,50,40,30,20,10: the real category plus the top 4 hold named slots.
			if (name === "Other") expect(p.mix.Other).toBe(1000 + 20 + 10);
			else expect(p.mix.Uncategorised).toBe(1000 + 5);
		}
	);

	it("range=all starts at the earliest counted order; empty data starts at today", async () => {
		const empty = (await get("/api/insights/trend?range=all")).body.data;
		expect(empty.from).toBe("2026-03-01");
		expect(empty.points).toHaveLength(1);
		await baseSeed();
		await mkSo(
			9,
			"2024-01-05",
			[{ productId: id(1), qty: 1, price: 1, avg: 1 }],
			"VOIDED"
		);
		const all = (await get("/api/insights/trend?range=all")).body.data;
		expect(all.from).toBe("2025-06-10");
		expect(all.period).toBe("month");
		expect(all.points[0].start).toBe("2025-06-01");
	});
});
