import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { testApp } from "../helpers/app.js";
import { insertUser, loginAs } from "../helpers/auth.js";
import { resetDb, testDb } from "../helpers/db.js";

// testApp's clock is 2026-03-01T12:00Z: 1y starts 2025-03-01, 30d starts 2026-01-30.
const now = new Date("2026-03-01T12:00:00Z");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const zeroTiers = ["0", "0", "0", "0", "0", "0", "0", "0", "0", "0"];
const day = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
const RANGES = ["30d", "90d", "6m", "1y", "all"] as const;

const mkProduct = (n: number, category: string | null) =>
	testDb.product.create({
		data: {
			id: id(n),
			sku: `SKU-${n}`,
			name: `Widget ${n}`,
			type: "Stock",
			status: "Active",
			category,
			average_cost: "60",
			tier_prices: zeroTiers,
			raw: {},
			synced_at: now,
		},
	});

const mkPo = (n: number, date: string, total: number) =>
	testDb.purchase.create({
		data: {
			id: id(1000 + n),
			order_number: `PO-${n}`,
			type: "Simple Purchase",
			status: "AUTHORISED",
			order_status: "AUTHORISED",
			counted: true,
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
				create: [
					{
						line_no: 1,
						product_id: null,
						sku: "S",
						name: "N",
						quantity: "1",
						unit_price: String(total),
						discount_pct: "0",
						unit_cost_base: String(total),
						total_base: String(total),
					},
				],
			},
		},
	});

type Line = { productId: string | null; qty: number; price: number; avg: number | null };
type SoOpts = { status?: string; counted?: boolean; customer?: string; tier?: string | null };
const mkSo = (n: number, date: string, lines: Line[], o: SoOpts = {}) => {
	const status = o.status ?? "AUTHORISED";
	return testDb.sale.create({
		data: {
			id: id(2000 + n),
			order_number: `SO-${n}`,
			type: "Simple Sale",
			status,
			order_status: status,
			counted: o.counted ?? status === "AUTHORISED",
			customer_id: id(5000 + n),
			customer_name: o.customer ?? `Customer ${n}`,
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
					average_cost: l.avg === null ? null : String(l.avg),
					total_base: String(l.qty * l.price),
				})),
			},
		},
	});
};

// `counted` mirrors the writer's rule (AUTHORISED and sale not VOIDED); tests set it directly.
const mkCredit = (
	n: number,
	saleN: number,
	date: string,
	lines: Line[],
	o: { status?: string; counted?: boolean } = {}
) => {
	const status = o.status ?? "AUTHORISED";
	return testDb.sale_credit_note.create({
		data: {
			id: id(3000 + n),
			sale_id: id(2000 + saleN),
			number: `CN-${n}`,
			credit_date: day(date),
			status,
			counted: o.counted ?? status === "AUTHORISED",
			currency_rate: "1",
			total_base: String(lines.reduce((s, l) => s + l.qty * l.price, 0)),
			lines: {
				create: lines.map((l, i) => ({
					line_no: i + 1,
					product_id: l.productId,
					sku: "S",
					name: "N",
					quantity: String(l.qty),
					unit_price_base: String(l.price),
					total_base: String(l.qty * l.price),
					average_cost: l.avg === null ? null : String(l.avg),
				})),
			},
		},
	});
};

beforeEach(async () => {
	await resetDb();
	await insertUser("v@example.com");
});
afterAll(() => testDb.$disconnect());

const get = async (path: string) => {
	const agent = await loginAs(testApp(), "v@example.com");
	const res = await agent.get(path);
	expect(res.status).toBe(200);
	return res.body.data;
};

// 10 × $100 at $60 cost in March 2025; 2 units credited in April 2025.
const marchSaleAprilCredit = async () => {
	await mkProduct(1, "Fans");
	await mkSo(1, "2025-03-10", [{ productId: id(1), qty: 10, price: 100, avg: 60 }]);
	await mkCredit(1, 1, "2025-04-05", [{ productId: id(1), qty: 2, price: 100, avg: 60 }]);
};

// Credits in every range, a credit-only window, a null-cost line, an unlinked line, a draft, an
// orphan note, and a counted credit on a sale whose own order is not counted and predates the rest.
const paritySeed = async () => {
	await mkProduct(1, "Fans");
	await mkProduct(2, "Pumps");
	await mkPo(1, "2025-05-01", 500);
	await mkPo(2, "2026-02-15", 120);
	await mkSo(1, "2025-03-10", [{ productId: id(1), qty: 10, price: 100, avg: 60 }], {
		customer: "Initech",
		tier: "Retail",
	});
	await mkCredit(1, 1, "2025-04-05", [{ productId: id(1), qty: 2, price: 100, avg: 60 }]);
	await mkSo(
		2,
		"2026-01-05",
		[
			{ productId: id(2), qty: 4, price: 50.25, avg: 30 },
			{ productId: null, qty: 1, price: 19.99, avg: null },
		],
		{ customer: "Globex", tier: "Wholesale" }
	);
	await mkCredit(2, 2, "2026-02-20", [
		{ productId: id(2), qty: 1, price: 50.25, avg: null },
		{ productId: null, qty: 1, price: 19.99, avg: null },
	]);
	await mkSo(3, "2026-02-25", [{ productId: id(1), qty: 3, price: 110, avg: 61 }]);
	await mkCredit(3, 3, "2026-02-27", [{ productId: id(1), qty: 1, price: 110, avg: 61 }]);
	await mkCredit(4, 3, "2026-02-28", [{ productId: id(1), qty: 2, price: 110, avg: 61 }], {
		status: "DRAFT",
	});
	await mkCredit(5, 99, "2026-02-28", [{ productId: id(1), qty: 5, price: 1000, avg: 1 }]);
	await mkSo(4, "2024-06-01", [{ productId: id(2), qty: 2, price: 40, avg: 25 }], {
		status: "ESTIMATED",
		counted: false,
	});
	await mkCredit(6, 4, "2024-07-01", [{ productId: id(2), qty: 1, price: 40, avg: 25 }]);
};

describe("credit-note netting", () => {
	it("(a) nets a credit in the month it is dated; 1y totals are net", async () => {
		await marchSaleAprilCredit();
		const t = await get("/api/insights/trend?range=1y");
		const mar = t.points.find((p: { start: string }) => p.start === "2025-03-01");
		const apr = t.points.find((p: { start: string }) => p.start === "2025-04-01");
		expect(mar).toMatchObject({ sales: 1000, grossProfit: 400, grossMarginPct: 40 });
		expect(apr).toMatchObject({ sales: -200, grossProfit: -80, grossMarginPct: null });
		expect(apr.mix).toEqual({ Fans: -200 });
		expect(t.totals).toEqual({
			sales: 800,
			purchases: 0,
			grossProfit: 320,
			grossMarginPct: 40,
		});
		const k = (await get("/api/overview?range=1y")).kpis;
		expect(k.sales).toBe(800);
		expect(k.grossMarginPct).toBe(40);
	});

	it("(b) a draft, an uncounted or an orphan credit note changes nothing", async () => {
		await mkProduct(1, "Fans");
		await mkSo(1, "2025-03-10", [{ productId: id(1), qty: 10, price: 100, avg: 60 }]);
		await mkCredit(
			1,
			1,
			"2025-04-05",
			[{ productId: id(1), qty: 2, price: 100, avg: 60 }],
			{
				status: "DRAFT",
			}
		);
		await mkCredit(
			2,
			1,
			"2025-04-06",
			[{ productId: id(1), qty: 3, price: 100, avg: 60 }],
			{
				status: "AUTHORISED",
				counted: false,
			}
		);
		await mkCredit(3, 42, "2025-04-07", [
			{ productId: id(1), qty: 4, price: 100, avg: 60 },
		]);
		const t = await get("/api/insights/trend?range=1y");
		expect(t.totals).toMatchObject({
			sales: 1000,
			grossProfit: 400,
			grossMarginPct: 40,
		});
		expect(
			t.points.find((p: { start: string }) => p.start === "2025-04-01").sales
		).toBe(0);
		const k = (await get("/api/overview?range=1y")).kpis;
		expect(k.sales).toBe(1000);
		const top = (await get("/api/insights/top-products?range=1y")).rows;
		expect(top[0]).toMatchObject({ units: 10, sales: 1000 });
	});

	it("(c) Overview = Insights in every range on a fixture with credit notes", async () => {
		await paritySeed();
		const expected: Record<string, number> = {
			// SO-2 (220.99) and SO-3 (330) less CN-2 (70.24) and CN-3 (110).
			"30d": 330 - 110 - 70.24,
			"90d": 201 + 19.99 + 330 - 70.24 - 110,
			"6m": 201 + 19.99 + 330 - 70.24 - 110,
			"1y": 1000 - 200 + 201 + 19.99 + 330 - 70.24 - 110,
			all: 1000 - 200 + 201 + 19.99 + 330 - 70.24 - 110 - 40,
		};
		for (const range of RANGES) {
			const t = (await get(`/api/insights/trend?range=${range}`)).totals;
			const k = (await get(`/api/overview?range=${range}`)).kpis;
			expect(t.sales, range).toBe(k.sales);
			expect(t.purchases, range).toBe(k.purchases);
			expect(t.grossMarginPct, range).toBe(k.grossMarginPct);
			expect(k.sales, range).toBeCloseTo(expected[range]!, 4);
		}
	});

	it("(d) breakdown totals equal trend sales; customer rows and the category mix net", async () => {
		await paritySeed();
		for (const range of RANGES) {
			const t = await get(`/api/insights/trend?range=${range}`);
			for (const by of ["category", "brand", "customer", "tier"]) {
				const b = await get(
					`/api/insights/breakdown?range=${range}&by=${by}`
				);
				expect(b.total, `${range} ${by}`).toBe(t.totals.sales);
			}
			for (const p of t.points) {
				const mix = Object.values(p.mix as Record<string, number>).reduce(
					(s, v) => s + v,
					0
				);
				expect(mix, `${range} ${p.start}`).toBeCloseTo(p.sales, 4);
			}
		}

		const customers = (await get("/api/insights/breakdown?range=1y&by=customer")).rows;
		const initech = customers.find((r: { label: string }) => r.label === "Initech");
		expect(initech).toMatchObject({
			amount: 800,
			grossProfit: 320,
			marginPct: 40,
			units: 8,
			orders: 1,
		});
		// SO-2 sold in January, credited in February: 30d sees only the credit.
		const c30 = (await get("/api/insights/breakdown?range=30d&by=customer")).rows;
		const globex = c30.find((r: { label: string }) => r.label === "Globex");
		expect(globex).toMatchObject({
			amount: -70.24,
			grossProfit: null,
			marginPct: null,
			units: -2,
			orders: 0,
		});

		const t1y = await get("/api/insights/trend?range=1y");
		const apr = t1y.points.find((p: { start: string }) => p.start === "2025-04-01");
		expect(apr.mix.Fans).toBe(-200);
		const feb = t1y.points.find((p: { start: string }) => p.start === "2026-02-01");
		expect(feb.mix).toMatchObject({ Fans: 220, Pumps: -50.25, Uncategorised: -19.99 });
	});

	it("(e) top products net units, sales and profit", async () => {
		await paritySeed();
		const rows = (await get("/api/insights/top-products?range=1y")).rows;
		const fans = rows.find((r: { productId: string }) => r.productId === id(1));
		// SO-1 10 × 100 @ 60 less CN-1 2; SO-3 3 × 110 @ 61 less CN-3 1.
		expect(fans).toMatchObject({
			units: 10,
			sales: 1020,
			grossProfit: 320 + 98,
			marginPct: 40.98,
		});
		const pumps = rows.find((r: { productId: string }) => r.productId === id(2));
		// The credited Pump line has no cost, so it nets sales and units but not profit.
		expect(pumps).toMatchObject({ units: 3, sales: 150.75, grossProfit: 81 });

		const r30 = (await get("/api/insights/top-products?range=30d&sort=units")).rows;
		expect(
			r30.map((r: { productId: string; units: number }) => [r.productId, r.units])
		).toEqual([
			[id(1), 2],
			[id(2), -1],
		]);
	});

	it("(f) a credit line with no product lands in Uncategorised", async () => {
		await paritySeed();
		const t = await get("/api/insights/trend?range=30d");
		expect(t.mixKeys).toContain("Uncategorised");
		const mixU = t.points.reduce(
			(s: number, p: { mix: Record<string, number> }) =>
				s + (p.mix.Uncategorised ?? 0),
			0
		);
		expect(mixU).toBeCloseTo(-19.99, 4);
		const cats = (await get("/api/insights/breakdown?range=30d&by=category")).rows;
		expect(
			cats.find((r: { label: string }) => r.label === "Uncategorised")
		).toMatchObject({
			key: null,
			amount: -19.99,
			units: -1,
		});
		const brands = (await get("/api/insights/breakdown?range=30d&by=brand")).rows;
		expect(
			brands.find((r: { label: string }) => r.label === "No brand").amount
		).toBeCloseTo(330 - 110 - 70.24, 4);
	});

	it("the product KPI margin nets credit lines; sold prices stay the sale-line prices", async () => {
		await marchSaleAprilCredit();
		await mkSo(2, "2025-05-01", [{ productId: id(1), qty: 1, price: 160, avg: 60 }]);
		const h = await get(`/api/products/${id(1)}/price-history?range=1y`);
		// Revenue 1000 − 200 + 160 = 960, cost 600 − 120 + 60 = 540.
		expect(h.stats.marginPct).toBe(43.75);
		expect(h.stats.avgSoldPrice).toBe(105.4545);
		expect(
			h.soldPrices.flatMap((t: { buckets: { units: number }[] }) =>
				t.buckets.map((b) => b.units)
			)
		).toEqual([10, 1]);
	});
});
