import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { testApp } from "../helpers/app.js";
import { agentFor, insertUser, loginAs } from "../helpers/auth.js";
import { resetDb, testDb } from "../helpers/db.js";

const now = new Date("2026-03-01T12:00:00Z");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const zeroTiers = ["0", "0", "0", "0", "0", "0", "0", "0", "0", "0"];
const day = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

const mkProduct = (n: number, name = `Widget ${n}`) =>
	testDb.product.create({
		data: {
			id: id(n),
			sku: `SKU-${n}`,
			name,
			type: "Stock",
			status: "Active",
			average_cost: "10",
			tier_prices: zeroTiers,
			raw: {},
			synced_at: now,
		},
	});

type Line = { productId: string | null; qty: number; price: number; avg?: number | null };
const mkSo = (n: number, date: string, lines: Line[], status = "AUTHORISED") =>
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
					average_cost: l.avg == null ? null : String(l.avg),
					total_base: String(l.qty * l.price),
				})),
			},
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

beforeEach(async () => {
	await resetDb();
	await insertUser("v@example.com");
});
afterAll(() => testDb.$disconnect());

const get = async (path: string) => {
	const agent = await loginAs(testApp(), "v@example.com");
	return agent.get(path);
};

type Row = {
	productId: string;
	name: string;
	sales: number;
	grossProfit: number | null;
	marginPct: number | null;
	units: number;
	onHand: number;
};

describe("GET /api/insights/top-products", () => {
	it("no session → 401; bad sort or range → 400", async () => {
		expect((await agentFor(testApp()).get("/api/insights/top-products")).status).toBe(
			401
		);
		expect((await get("/api/insights/top-products?sort=nope")).status).toBe(400);
		expect((await get("/api/insights/top-products?range=2w")).status).toBe(400);
	});

	it("defaults to sales order; shape, on-hand across locations, product-linked lines only", async () => {
		await mkProduct(1, "Alpha");
		await mkProduct(2, "Beta");
		await stock(1, 3, "Main");
		await stock(1, 4, "Van");
		await mkSo(1, "2026-02-12", [
			{ productId: id(1), qty: 2, price: 20, avg: 10 },
			{ productId: id(2), qty: 1, price: 100, avg: null },
			{ productId: null, qty: 1, price: 999, avg: 1 },
		]);
		await mkSo(2, "2026-02-13", [{ productId: id(1), qty: 1, price: 20, avg: 10 }]);
		const rows = (await get("/api/insights/top-products?range=30d")).body.data
			.rows as Row[];
		expect(rows.map((r) => r.name)).toEqual(["Beta", "Alpha"]);
		expect(rows[1]).toMatchObject({
			productId: id(1),
			sku: "SKU-1",
			thumbUrl: null,
			sales: 60,
			grossProfit: 30,
			marginPct: 50,
			units: 3,
			onHand: 7,
		});
		expect(rows[0]).toMatchObject({
			sales: 100,
			grossProfit: null,
			marginPct: null,
			onHand: 0,
		});
	});

	it("sort=profit orders by gross profit and skips products with no costed lines", async () => {
		await mkProduct(1, "Alpha");
		await mkProduct(2, "Beta");
		await mkProduct(3, "Gamma");
		await mkSo(1, "2026-02-12", [
			{ productId: id(1), qty: 1, price: 50, avg: 40 }, // profit 10, sales 50
			{ productId: id(2), qty: 1, price: 30, avg: 10 }, // profit 20, sales 30
			{ productId: id(3), qty: 1, price: 500, avg: null }, // biggest sales, no cost
		]);
		const rows = (await get("/api/insights/top-products?range=30d&sort=profit")).body
			.data.rows as Row[];
		expect(rows.map((r) => r.name)).toEqual(["Beta", "Alpha"]);
	});

	it("sort=units; ties break by name; capped at 10; voided and out-of-range excluded", async () => {
		for (let n = 1; n <= 12; n++)
			await mkProduct(n, `P${String(13 - n).padStart(2, "0")}`);
		await mkSo(
			1,
			"2026-02-12",
			Array.from({ length: 12 }, (_, i) => ({
				productId: id(i + 1),
				qty: 5,
				price: 1,
				avg: 0.5,
			}))
		);
		await mkSo(2, "2026-02-12", [{ productId: id(1), qty: 99, price: 1 }], "VOIDED");
		await mkSo(3, "2025-01-01", [{ productId: id(2), qty: 99, price: 1 }]);
		const rows = (await get("/api/insights/top-products?range=30d&sort=units")).body
			.data.rows as Row[];
		expect(rows).toHaveLength(10);
		expect(rows.every((r) => r.units === 5)).toBe(true);
		expect(rows.map((r) => r.name)).toEqual(
			Array.from({ length: 10 }, (_, i) => `P${String(i + 1).padStart(2, "0")}`)
		);
	});
});
