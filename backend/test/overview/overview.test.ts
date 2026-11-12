import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { testApp } from "../helpers/app.js";
import { agentFor, insertUser, loginAs } from "../helpers/auth.js";
import { resetDb, testDb } from "../helpers/db.js";

// testApp's clock is 2026-03-01T12:00Z, i.e. Mar 1 in the fallback zone.
const now = new Date("2026-03-01T12:00:00Z");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const zeroTiers = ["0", "0", "0", "0", "0", "0", "0", "0", "0", "0"];
const P1 = id(1);
const P2 = id(2);
const P3 = id(3);
const day = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

const mkProduct = (n: number, avg: string) =>
	testDb.product.create({
		data: {
			id: id(n),
			sku: `SKU-${n}`,
			name: `Widget ${n}`,
			type: "Stock",
			status: "Active",
			average_cost: avg,
			tier_prices: zeroTiers,
			raw: {},
			synced_at: now,
		},
	});

const mkStock = (productId: string, location: string, onHand: string) =>
	testDb.stock_level.create({
		data: {
			product_id: productId,
			location_name: location,
			on_hand: onHand,
			allocated: "0",
			available: onHand,
			on_order: "0",
			in_transit: "0",
			synced_at: now,
		},
	});

type PoLine = { productId: string; qty: number; cost: number };
const mkPo = (n: number, date: string, lines: PoLine[], counted = true) => {
	const total = lines.reduce((s, l) => s + l.qty * l.cost, 0);
	return testDb.purchase.create({
		data: {
			id: id(1000 + n),
			order_number: `PO-${n}`,
			type: "Simple Purchase",
			status: counted ? "AUTHORISED" : "VOIDED",
			order_status: counted ? "AUTHORISED" : "VOIDED",
			counted,
			supplier_name: "Acme Supply",
			order_date: day(date),
			currency: "USD",
			base_currency: "USD",
			currency_rate: "1",
			total: String(total),
			total_base: String(total),
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
};

type SoLine = { productId: string; qty: number; price: number; avg: number | null };
const mkSo = (n: number, date: string, lines: SoLine[], status = "AUTHORISED") =>
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
					unit_price: String(l.price),
					discount_pct: "0",
					unit_price_base: String(l.price),
					average_cost: l.avg === null ? null : String(l.avg),
					total_base: String(l.qty * l.price),
				})),
			},
		},
	});

// Hand-built: stock value 8×10 + 4×20 + 10×5 = 210 over 22 units.
const seed = async () => {
	await mkProduct(1, "10");
	await mkProduct(2, "20");
	await mkProduct(3, "5");
	await mkStock(P1, "Main", "5");
	await mkStock(P1, "Annex", "3");
	await mkStock(P2, "Main", "4");
	await mkStock(P3, "Main", "10");
	// P1: Dec 1 (6), Feb 10 (8), Feb 20 (10). P2: one purchase in 180 d. P3: Feb 1 (10), Feb 5 (5).
	await mkPo(0, "2025-12-01", [{ productId: P1, qty: 1, cost: 6 }]);
	await mkPo(1, "2026-02-10", [{ productId: P1, qty: 10, cost: 8 }]);
	await mkPo(2, "2026-02-20", [{ productId: P1, qty: 10, cost: 10 }]);
	await mkPo(3, "2026-02-15", [{ productId: P2, qty: 2, cost: 20 }]);
	await mkPo(4, "2026-02-25", [{ productId: P1, qty: 10, cost: 99 }], false);
	await mkPo(5, "2026-02-01", [{ productId: P3, qty: 1, cost: 10 }]);
	await mkPo(6, "2026-02-05", [{ productId: P3, qty: 2, cost: 5 }]);
	await mkPo(7, "2025-01-01", [{ productId: P2, qty: 1, cost: 1 }]);
	await mkSo(1, "2026-02-12", [
		{ productId: P1, qty: 2, price: 20, avg: 10 },
		{ productId: P1, qty: 1, price: 30, avg: null },
	]);
	await mkSo(2, "2026-02-22", [{ productId: P2, qty: 1, price: 50, avg: 20 }]);
	await mkSo(3, "2026-02-24", [{ productId: P1, qty: 100, price: 1000, avg: 1 }], "VOIDED");
	await mkSo(4, "2026-02-26", [{ productId: P1, qty: 100, price: 1000, avg: 1 }], "DRAFT");
};

beforeEach(async () => {
	await resetDb();
	await insertUser("v@example.com");
});
afterAll(() => testDb.$disconnect());

const get = async (path: string) => {
	const agent = await loginAs(testApp(), "v@example.com");
	return agent.get(path);
};

describe("GET /api/overview", () => {
	it("no session → 401; bad range → 400", async () => {
		expect((await agentFor(testApp()).get("/api/overview")).status).toBe(401);
		expect((await get("/api/overview?range=2w")).status).toBe(400);
	});

	it("KPIs equal the hand-computed values; voided and draft orders are not counted", async () => {
		await seed();
		const res = await get("/api/overview?range=30d");
		expect(res.status).toBe(200);
		// Purchases: 80 + 100 + 40 + 10 + 10 (PO-0 predates the window, PO-4 is voided).
		// Sales: 40 + 30 + 50. Margin ignores the line without an average cost: (90-40)/90.
		expect(res.body.data.kpis).toEqual({
			stockValue: 210,
			unitsOnHand: 22,
			sales: 120,
			purchases: 240,
			grossMarginPct: 55.56,
		});
	});

	it("range boundaries are inclusive calendar dates", async () => {
		await seed();
		const p = async (range: string) =>
			(await get(`/api/overview?range=${range}`)).body.data.kpis.purchases;
		expect(await p("30d")).toBe(240);
		expect(await p("90d")).toBe(246); // Dec 1 is exactly 90 days before Mar 1
		expect(await p("all")).toBe(247);
		expect((await get("/api/overview")).body.data.kpis.purchases).toBe(240); // default 30d
	});

	it("empty data → zeros and a null margin", async () => {
		const res = await get("/api/overview");
		expect(res.body.data).toEqual({
			kpis: {
				stockValue: 0,
				unitsOnHand: 0,
				sales: 0,
				purchases: 0,
				grossMarginPct: null,
			},
			costMovers: [],
			recentPurchases: [],
			recentSales: [],
			lastSyncAt: null,
		});
	});

	it("cost movers: last cost vs the average of the earlier purchases, ≥ 2 purchases in 180 d", async () => {
		await seed();
		const { costMovers } = (await get("/api/overview")).body.data;
		// P1: 10 vs avg(6, 8) = 7 → +42.86%. P3: 5 vs 10 → -50%. P2 has one purchase in the window.
		expect(costMovers).toEqual([
			{
				productId: P3,
				name: "Widget 3",
				sku: "SKU-3",
				thumbUrl: null,
				lastCost: 5,
				priorAvgCost: 10,
				changePct: -50,
			},
			{
				productId: P1,
				name: "Widget 1",
				sku: "SKU-1",
				thumbUrl: null,
				lastCost: 10,
				priorAvgCost: 7,
				changePct: 42.86,
			},
		]);
	});

	it("cost movers ignore a product with a single purchase", async () => {
		await mkProduct(1, "10");
		await mkPo(1, "2026-02-10", [{ productId: P1, qty: 1, cost: 8 }]);
		await mkPo(2, "2026-02-12", [{ productId: P1, qty: 1, cost: 10 }], false);
		expect((await get("/api/overview")).body.data.costMovers).toEqual([]);
	});

	it("cost movers keep only the 10 largest moves", async () => {
		for (let n = 1; n <= 12; n++) {
			await mkProduct(n, "1");
			await mkPo(n * 2, "2026-02-01", [{ productId: id(n), qty: 1, cost: 10 }]);
			await mkPo(n * 2 + 1, "2026-02-02", [
				{ productId: id(n), qty: 1, cost: 10 + n },
			]);
		}
		const { costMovers } = (await get("/api/overview")).body.data;
		expect(costMovers).toHaveLength(10);
		expect(costMovers[0].productId).toBe(id(12));
		expect(costMovers[9].productId).toBe(id(3));
	});

	it("cost movers: on a tie day the higher-numbered PO (PO-10 over PO-9) is the latest", async () => {
		await mkProduct(1, "10");
		await mkPo(9, "2026-02-10", [{ productId: P1, qty: 1, cost: 10 }]);
		await mkPo(10, "2026-02-10", [{ productId: P1, qty: 1, cost: 20 }]);
		await mkPo(8, "2026-02-01", [{ productId: P1, qty: 1, cost: 10 }]);
		const { costMovers } = (await get("/api/overview")).body.data;
		// Latest = PO-10 (20) against avg(10, 10); plain string order would pick PO-9.
		expect(costMovers[0]).toMatchObject({
			lastCost: 20,
			priorAvgCost: 10,
			changePct: 100,
		});
	});

	it("recent orders are counted ones, newest first, five at most", async () => {
		await seed();
		const { recentPurchases, recentSales } = (await get("/api/overview")).body.data;
		expect(recentPurchases.map((r: { orderNumber: string }) => r.orderNumber)).toEqual([
			"PO-2",
			"PO-3",
			"PO-1",
			"PO-6",
			"PO-5",
		]);
		expect(recentPurchases[0]).toEqual({
			id: id(1002),
			orderNumber: "PO-2",
			orderDate: "2026-02-20",
			party: "Acme Supply",
			status: "AUTHORISED",
			totalBase: 100,
		});
		expect(recentSales.map((r: { orderNumber: string }) => r.orderNumber)).toEqual([
			"SO-2",
			"SO-1",
		]);
		expect(recentSales[0].party).toBe("Initech");
	});

	it("lastSyncAt is the last successful sync's finish time", async () => {
		const finished = new Date("2026-02-28T09:30:00.000Z");
		await testDb.sync_run.create({
			data: {
				kind: "incremental",
				trigger: "schedule",
				status: "ok",
				started_at: new Date("2026-02-28T09:29:00.000Z"),
				finished_at: finished,
			},
		});
		await testDb.sync_run.create({
			data: {
				kind: "incremental",
				trigger: "schedule",
				status: "failed",
				started_at: new Date("2026-02-28T10:00:00.000Z"),
				finished_at: new Date("2026-02-28T10:01:00.000Z"),
			},
		});
		expect((await get("/api/overview")).body.data.lastSyncAt).toBe(
			finished.toISOString()
		);
	});
});
