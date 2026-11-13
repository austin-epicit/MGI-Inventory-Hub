import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { marginPct } from "../../src/products/priceHistory.js";
import { testApp } from "../helpers/app.js";
import { agentFor, insertUser, loginAs } from "../helpers/auth.js";
import { resetDb, testDb } from "../helpers/db.js";

const now = new Date("2026-03-01T12:00:00Z");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const zeroTiers = ["0", "0", "0", "0", "0", "0", "0", "0", "0", "0"];
const day = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

const mkProduct = (n: number, category: string | null, brand: string | null = null) =>
	testDb.product.create({
		data: {
			id: id(n),
			sku: `SKU-${n}`,
			name: `Widget ${n}`,
			type: "Stock",
			status: "Active",
			category,
			brand,
			average_cost: "10",
			tier_prices: zeroTiers,
			raw: {},
			synced_at: now,
		},
	});

type Line = { productId: string | null; qty: number; price: number; avg?: number | null };
type SoOpts = {
	customerId?: string | null;
	customer?: string;
	tier?: string | null;
	status?: string;
};
const mkSo = (n: number, date: string, lines: Line[], o: SoOpts = {}) =>
	testDb.sale.create({
		data: {
			id: id(2000 + n),
			order_number: `SO-${n}`,
			type: "Simple Sale",
			status: o.status ?? "AUTHORISED",
			order_status: o.status ?? "AUTHORISED",
			counted: (o.status ?? "AUTHORISED") === "AUTHORISED",
			customer_id: o.customerId ?? null,
			customer_name: o.customer ?? "Initech",
			price_tier_name: o.tier ?? null,
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

const mkPo = (
	n: number,
	date: string,
	supplierId: string | null,
	supplier: string,
	lines: Line[]
) =>
	testDb.purchase.create({
		data: {
			id: id(1000 + n),
			order_number: `PO-${n}`,
			type: "Simple Purchase",
			status: "AUTHORISED",
			order_status: "AUTHORISED",
			counted: true,
			supplier_id: supplierId,
			supplier_name: supplier,
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
					unit_cost_base: String(l.price),
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

type R = { key: string | null; label: string; amount: number };
const sum = (rows: R[]) => rows.reduce((s, r) => s + r.amount, 0);

describe("GET /api/insights/breakdown", () => {
	it("no session → 401; by=nope and bad range → 400", async () => {
		expect((await agentFor(testApp()).get("/api/insights/breakdown")).status).toBe(401);
		expect((await get("/api/insights/breakdown?by=nope")).status).toBe(400);
		expect((await get("/api/insights/breakdown?range=2w")).status).toBe(400);
	});

	it("defaults to category; rows sum to the trend total", async () => {
		await mkProduct(1, "Fans");
		await mkProduct(2, "Motors");
		await mkSo(1, "2026-02-12", [
			{ productId: id(1), qty: 2, price: 20, avg: 10 },
			{ productId: id(2), qty: 1, price: 30, avg: null },
			{ productId: null, qty: 1, price: 5, avg: 1 },
		]);
		const b = (await get("/api/insights/breakdown?range=30d")).body.data;
		const t = (await get("/api/insights/trend?range=30d")).body.data.totals;
		expect(b.by).toBe("category");
		expect(b.kind).toBe("sales");
		expect(b.total).toBe(t.sales);
		expect(sum(b.rows)).toBeCloseTo(t.sales, 4);
		expect(b.rows.map((r: R) => r.label)).toEqual(["Fans", "Motors", "Uncategorised"]);
		expect(b.rows[0]).toMatchObject({
			key: "Fans",
			amount: 40,
			grossProfit: 20,
			marginPct: 50,
			units: 2,
			orders: 1,
			products: 1,
		});
		expect(b.rows[1]).toMatchObject({ grossProfit: null, marginPct: null });
		expect(b.other).toBeNull();
	});

	it("a sale line without a product lands in Uncategorised and No brand", async () => {
		await mkProduct(1, "Fans", "Acme");
		await mkSo(1, "2026-02-12", [
			{ productId: id(1), qty: 1, price: 10, avg: 4 },
			{ productId: null, qty: 1, price: 7, avg: null },
		]);
		const cat = (await get("/api/insights/breakdown?by=category&range=30d")).body.data;
		expect(cat.rows.find((r: R) => r.key === null)).toMatchObject({
			label: "Uncategorised",
			amount: 7,
			products: 0,
		});
		const brand = (await get("/api/insights/breakdown?by=brand&range=30d")).body.data;
		expect(brand.rows.map((r: R) => r.label)).toEqual(["Acme", "No brand"]);
		expect(brand.total).toBe(17);
	});

	it("by grade: graded and Not graded rows, net of credit notes, sum to total", async () => {
		await mkProduct(1, "Fans");
		await mkProduct(2, "Fans");
		await testDb.product_condition.create({
			data: { product_id: id(1), grade: "A", updated_at: now },
		});
		await mkSo(1, "2026-02-12", [
			{ productId: id(1), qty: 2, price: 20, avg: 10 },
			{ productId: id(2), qty: 1, price: 30, avg: 10 },
		]);
		await testDb.sale_credit_note.create({
			data: {
				id: id(3001),
				sale_id: id(2001),
				number: "CN-1",
				credit_date: day("2026-02-14"),
				status: "AUTHORISED",
				counted: true,
				currency_rate: "1",
				total_base: "20",
				lines: {
					create: [
						{
							line_no: 1,
							product_id: id(1),
							sku: "S",
							name: "N",
							quantity: "1",
							unit_price_base: "20",
							total_base: "20",
							average_cost: "10",
						},
					],
				},
			},
		});
		const b = (await get("/api/insights/breakdown?by=grade&range=30d")).body.data;
		const t = (await get("/api/insights/trend?range=30d")).body.data.totals;
		expect(b.by).toBe("grade");
		expect(b.rows).toHaveLength(2);
		expect(b.rows.find((r: R) => r.key === "A")).toMatchObject({
			label: "Grade A",
			amount: 20,
		});
		expect(b.rows.find((r: R) => r.key === null)).toMatchObject({
			label: "Not graded",
			amount: 30,
		});
		expect(b.total).toBe(t.sales);
		expect(sum(b.rows)).toBeCloseTo(b.total, 4);
	});

	it("17 customers → 15 rows plus Other (2), orders distinct across merged rows", async () => {
		await mkProduct(1, "Fans");
		for (let n = 1; n <= 17; n++)
			await mkSo(
				n,
				"2026-02-12",
				[{ productId: id(1), qty: 1, price: 100 - n, avg: 50 }],
				{
					customerId: id(500 + n),
					customer: `Cust ${String(n).padStart(2, "0")}`,
				}
			);
		// A second order for customer 16 so the merged row's distinct-order count is 3, not 2.
		await mkSo(18, "2026-02-13", [{ productId: id(1), qty: 1, price: 1, avg: 0 }], {
			customerId: id(516),
			customer: "Cust 16",
		});
		const b = (await get("/api/insights/breakdown?by=customer&range=30d")).body.data;
		const t = (await get("/api/insights/trend?range=30d")).body.data.totals;
		expect(b.rows).toHaveLength(15);
		expect(b.other).toMatchObject({
			key: null,
			label: "Other (2)",
			orders: 3,
			products: 1,
		});
		expect(b.rows[0]).toMatchObject({ key: id(501), label: "Cust 01" });
		expect(sum(b.rows) + b.other.amount).toBeCloseTo(b.total, 4);
		expect(b.total).toBe(t.sales);
	});

	it("a customer's margin equals marginPct over its lines; unlinked customers key null", async () => {
		await mkProduct(1, "Fans");
		const lines = [
			{ productId: id(1), qty: 2, price: 20, avg: 10 },
			{ productId: id(1), qty: 3, price: 15, avg: 12 },
			{ productId: id(1), qty: 1, price: 9, avg: null },
		];
		await mkSo(1, "2026-02-12", lines.slice(0, 2), {
			customerId: id(501),
			customer: "Globex",
		});
		await mkSo(2, "2026-02-13", lines.slice(2), {
			customerId: id(501),
			customer: "Globex",
		});
		await mkSo(3, "2026-02-13", [{ productId: id(1), qty: 1, price: 4, avg: 1 }], {
			customer: "Walk-in",
		});
		const b = (await get("/api/insights/breakdown?by=customer&range=30d")).body.data;
		const globex = b.rows.find((r: R) => r.key === id(501));
		expect(globex.marginPct).toBe(
			marginPct(
				lines.map((l) => ({
					qty: l.qty,
					unitPrice: l.price,
					averageCost: l.avg ?? null,
				}))
			)
		);
		expect(globex).toMatchObject({ orders: 2, units: 6, grossProfit: 29 });
		expect(b.rows.find((r: R) => r.label === "Walk-in").key).toBeNull();
	});

	it("tier rows and the No tier fallback; voided sales excluded", async () => {
		await mkProduct(1, "Fans");
		await mkSo(1, "2026-02-12", [{ productId: id(1), qty: 1, price: 10, avg: 4 }], {
			tier: "Wholesale",
		});
		await mkSo(2, "2026-02-12", [{ productId: id(1), qty: 1, price: 6, avg: 4 }]);
		await mkSo(3, "2026-02-12", [{ productId: id(1), qty: 9, price: 99, avg: 1 }], {
			tier: "Wholesale",
			status: "VOIDED",
		});
		const b = (await get("/api/insights/breakdown?by=tier&range=30d")).body.data;
		expect(b.rows.map((r: R) => [r.label, r.amount])).toEqual([
			["Wholesale", 10],
			["No tier", 6],
		]);
	});

	it("supplier kind uses purchases, has no profit, and matches trend purchases", async () => {
		await mkProduct(1, "Fans");
		await mkPo(1, "2026-02-10", id(700), "Acme Supply", [
			{ productId: id(1), qty: 10, price: 8 },
		]);
		await mkPo(2, "2026-02-11", id(700), "Acme Supply", [
			{ productId: id(1), qty: 1, price: 5 },
		]);
		await mkPo(3, "2026-02-11", null, "Cash vendor", [
			{ productId: null, qty: 2, price: 3 },
		]);
		await mkSo(1, "2026-02-12", [{ productId: id(1), qty: 1, price: 10, avg: 4 }]);
		const b = (await get("/api/insights/breakdown?by=supplier&range=30d")).body.data;
		const t = (await get("/api/insights/trend?range=30d")).body.data.totals;
		expect(b.kind).toBe("purchases");
		expect(b.total).toBe(t.purchases);
		expect(b.rows[0]).toMatchObject({
			key: id(700),
			label: "Acme Supply",
			amount: 85,
			grossProfit: null,
			marginPct: null,
			units: 11,
			orders: 2,
			products: 1,
		});
		expect(b.rows[1]).toMatchObject({
			key: null,
			label: "Cash vendor",
			amount: 6,
			products: 0,
		});
	});
});
