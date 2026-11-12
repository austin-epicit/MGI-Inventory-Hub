import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AGE_BUCKETS, SLOW_MOVER_DAYS } from "../../src/insights/stockHealth.js";
import { testApp } from "../helpers/app.js";
import { agentFor, insertUser, loginAs } from "../helpers/auth.js";
import { resetDb, testDb } from "../helpers/db.js";

// helpers/app.ts fixes the clock at this day.
const TODAY = "2026-03-01";
const now = new Date(`${TODAY}T12:00:00Z`);
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const zeroTiers = ["0", "0", "0", "0", "0", "0", "0", "0", "0", "0"];
const daysAgo = (n: number) => new Date(Date.parse(`${TODAY}T00:00:00.000Z`) - n * 86_400_000);
const iso = (n: number) => daysAgo(n).toISOString().slice(0, 10);

const mkProduct = (n: number, name: string, cost = 10) =>
	testDb.product.create({
		data: {
			id: id(n),
			sku: `SKU-${n}`,
			name,
			type: "Stock",
			status: "Active",
			average_cost: String(cost),
			tier_prices: zeroTiers,
			raw: {},
			synced_at: now,
		},
	});

const stock = (n: number, onHand: number, loc = "Main") =>
	testDb.stock_level.create({
		data: {
			product_id: id(n),
			location_name: loc,
			on_hand: String(onHand),
			allocated: "0",
			available: String(onHand),
			on_order: "0",
			in_transit: "0",
			synced_at: now,
		},
	});

const order = {
	currency: "USD",
	base_currency: "USD",
	currency_rate: "1",
	total: "1",
	total_base: "1",
	cin7_updated_at: now,
	raw: {},
	synced_at: now,
};

const buy = (n: number, productId: string, ago: number, status = "AUTHORISED") =>
	testDb.purchase.create({
		data: {
			...order,
			id: id(1000 + n),
			order_number: `PO-${n}`,
			type: "Simple Purchase",
			status,
			order_status: status,
			counted: status === "AUTHORISED",
			supplier_name: "Acme",
			order_date: daysAgo(ago),
			lines: {
				create: [
					{
						line_no: 1,
						product_id: productId,
						sku: "S",
						name: "N",
						quantity: "1",
						unit_price: "1",
						discount_pct: "0",
						unit_cost_base: "1",
						total_base: "1",
					},
				],
			},
		},
	});

const sell = (n: number, productId: string, ago: number, status = "AUTHORISED") =>
	testDb.sale.create({
		data: {
			...order,
			id: id(2000 + n),
			order_number: `SO-${n}`,
			type: "Simple Sale",
			status,
			order_status: status,
			counted: status === "AUTHORISED",
			customer_name: "Initech",
			order_date: daysAgo(ago),
			lines: {
				create: [
					{
						line_no: 1,
						product_id: productId,
						sku: "S",
						name: "N",
						quantity: "1",
						unit_price: "1",
						discount_pct: "0",
						unit_price_base: "1",
						total_base: "1",
					},
				],
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

type Bucket = { bucket: string; value: number; units: number; products: number };
type Mover = {
	productId: string;
	name: string;
	onHand: number;
	value: number;
	lastSold: string | null;
};

describe("GET /api/insights/stock", () => {
	it("exports the constants", () => {
		expect(SLOW_MOVER_DAYS).toBe(90);
		expect(AGE_BUCKETS).toEqual(["0-30", "31-90", "91-180", "181-365", "365+", "none"]);
	});

	it("no session → 401", async () => {
		expect((await agentFor(testApp()).get("/api/insights/stock")).status).toBe(401);
	});

	it("empty store: no history, six zero buckets in order, no movers", async () => {
		const d = (await get("/api/insights/stock")).body.data;
		expect(d.valueHistory).toEqual([]);
		expect(d.trackingSince).toBeNull();
		expect(d.slowMovers).toEqual([]);
		expect(d.age.map((b: Bucket) => b.bucket)).toEqual([...AGE_BUCKETS]);
		expect(
			d.age.every(
				(b: Bucket) => b.value === 0 && b.units === 0 && b.products === 0
			)
		).toBe(true);
	});

	it("buckets by days since the latest counted purchase; Σ value = Overview stockValue", async () => {
		const cases: [number, number | null][] = [
			[1, 0],
			[2, 30],
			[3, 31],
			[4, 90],
			[5, 91],
			[6, 180],
			[7, 181],
			[8, 365],
			[9, 366],
			[10, null],
		];
		for (const [n, ago] of cases) {
			await mkProduct(n, `P${n}`, 2);
			await stock(n, 5, "Main");
			await stock(n, 5, "Van");
			if (ago !== null) await buy(n, id(n), ago);
		}
		// P3 (31 days) keeps its bucket: an older purchase is ignored, a voided newer one too.
		await buy(50, id(3), 400);
		await buy(51, id(3), 1, "VOIDED");
		const agent = await loginAs(testApp(), "v@example.com");
		const d = (await agent.get("/api/insights/stock")).body.data;
		const by = Object.fromEntries(d.age.map((b: Bucket) => [b.bucket, b]));
		expect(by["0-30"]).toMatchObject({ products: 2, units: 20, value: 40 });
		expect(by["31-90"]).toMatchObject({ products: 2 });
		expect(by["91-180"]).toMatchObject({ products: 2 });
		expect(by["181-365"]).toMatchObject({ products: 2 });
		expect(by["365+"]).toMatchObject({ products: 1 });
		expect(by["none"]).toMatchObject({ products: 1, value: 20 });
		const ov = (await agent.get("/api/overview")).body.data.kpis.stockValue;
		expect(d.age.reduce((s: number, b: Bucket) => s + b.value, 0)).toBeCloseTo(ov, 4);
	});

	it("excludes products with nothing on hand from age and slow movers", async () => {
		await mkProduct(1, "Empty");
		await stock(1, 0);
		await mkProduct(2, "Negative");
		await stock(2, -3);
		const d = (await get("/api/insights/stock")).body.data;
		expect(d.age.reduce((s: number, b: Bucket) => s + b.products, 0)).toBe(0);
		expect(d.slowMovers).toEqual([]);
	});

	it("slow movers: sold 91 days ago yes, 89 no, never sold yes, on-hand 0 no; value desc", async () => {
		await mkProduct(1, "Old sale", 10);
		await stock(1, 2); // value 20
		await sell(1, id(1), 91);
		await sell(11, id(1), 200); // an earlier sale doesn't change lastSold
		await mkProduct(2, "Recent sale", 10);
		await stock(2, 9);
		await sell(2, id(2), 89);
		await mkProduct(3, "Never sold", 10);
		await stock(3, 3); // value 30
		await mkProduct(4, "No stock", 10);
		await stock(4, 0);
		await sell(4, id(4), 200);
		await mkProduct(5, "Voided recent", 10);
		await stock(5, 1); // value 10; a voided recent sale doesn't count
		await sell(5, id(5), 5, "VOIDED");
		const movers = (await get("/api/insights/stock")).body.data.slowMovers as Mover[];
		expect(movers.map((m) => m.name)).toEqual([
			"Never sold",
			"Old sale",
			"Voided recent",
		]);
		expect(movers[0]).toMatchObject({
			productId: id(3),
			sku: "SKU-3",
			thumbUrl: null,
			onHand: 3,
			value: 30,
			lastSold: null,
		});
		expect(movers[1]).toMatchObject({ lastSold: iso(91) });
		expect(movers[2]).toMatchObject({ lastSold: null });
	});

	it("slow cut-off: a sale exactly 90 days ago is not slow, 91 days ago is", async () => {
		await mkProduct(1, "Ninety", 10);
		await stock(1, 1);
		await sell(1, id(1), 90);
		await mkProduct(2, "Ninety-one", 10);
		await stock(2, 1);
		await sell(2, id(2), 91);
		const movers = (await get("/api/insights/stock")).body.data.slowMovers as Mover[];
		expect(movers.map((m) => m.name)).toEqual(["Ninety-one"]);
	});

	it("slow movers capped at 10", async () => {
		for (let n = 1; n <= 12; n++) {
			await mkProduct(n, `P${n}`, n);
			await stock(n, 1);
		}
		const movers = (await get("/api/insights/stock")).body.data.slowMovers as Mover[];
		expect(movers).toHaveLength(10);
		expect(movers[0]!.name).toBe("P12");
	});

	it("valueHistory returns the last 180 recorded days ascending; trackingSince is the first ever", async () => {
		for (let i = 0; i < 200; i++)
			await testDb.stock_value_snapshot.create({
				data: {
					day: daysAgo(199 - i),
					value: String(100 + i),
					units: String(i),
					source: "seed",
					recorded_at: now,
				},
			});
		const d = (await get("/api/insights/stock")).body.data;
		expect(d.valueHistory).toHaveLength(180);
		expect(d.valueHistory[0]).toEqual({ day: iso(179), value: 120, units: 20 });
		expect(d.valueHistory[179]).toEqual({ day: iso(0), value: 299, units: 199 });
		expect(d.trackingSince).toBe(iso(199));
	});
});
