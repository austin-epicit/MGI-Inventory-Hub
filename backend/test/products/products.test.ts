import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { testApp } from "../helpers/app.js";
import { agentFor, insertUser, loginAs } from "../helpers/auth.js";
import { resetDb, testDb } from "../helpers/db.js";

const now = new Date("2026-11-01T12:00:00Z");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const P1 = id(1);
const P2 = id(2);
const P3 = id(3);
const P4 = id(4);
const ids = (res: { body: { data: { id: string }[] } }) => res.body.data.map((r) => r.id);

const mkProduct = (n: number, over: Record<string, unknown> = {}) =>
	testDb.product.create({
		data: {
			id: id(n),
			sku: `SKU-${n}`,
			name: `Widget ${n}`,
			category: "Parts",
			brand: "Acme",
			type: "Stock",
			status: "Active",
			average_cost: "5.0000",
			tier_prices: ["0", "0", "0", "0", "0", "0", "0", "0", "0", "0"],
			raw: {},
			synced_at: now,
			...over,
		},
	});

let seq = 0;
const mkPurchase = async (productId: string, date: string, cost: string, counted = true) => {
	seq += 1;
	await testDb.purchase.create({
		data: {
			id: id(1000 + seq),
			order_number: `PO-${seq}`,
			type: "Simple Purchase",
			status: "AUTHORISED",
			order_status: "AUTHORISED",
			counted,
			supplier_name: "S",
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
						product_id: productId,
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

const mkSale = async (productId: string, date: string, price: string, counted = true) => {
	seq += 1;
	await testDb.sale.create({
		data: {
			id: id(2000 + seq),
			order_number: `SO-${seq}`,
			type: "Simple Sale",
			status: "AUTHORISED",
			order_status: "AUTHORISED",
			counted,
			customer_name: "C",
			order_date: new Date(`${date}T00:00:00.000Z`),
			currency: "USD",
			base_currency: "USD",
			currency_rate: "1",
			total: price,
			total_base: price,
			cin7_updated_at: now,
			raw: {},
			synced_at: now,
			lines: {
				create: [
					{
						line_no: 1,
						product_id: productId,
						sku: "x",
						name: "x",
						quantity: "1",
						unit_price: price,
						discount_pct: "0",
						unit_price_base: price,
						total_base: price,
					},
				],
			},
		},
	});
};

beforeEach(async () => {
	await resetDb();
	seq = 0;
	await testDb.price_tier.createMany({
		data: [
			{ code: 1, name: "Retail", synced_at: now },
			{ code: 2, name: "Wholesale", synced_at: now },
			{ code: 3, name: "Trade", synced_at: now },
		],
	});
	await insertUser("v@example.com");
});
afterAll(() => testDb.$disconnect());

const list = async (qs = "") => {
	const agent = await loginAs(testApp(), "v@example.com");
	return agent.get(`/api/products${qs}`);
};

describe("GET /api/products", () => {
	it("no session → 401", async () => {
		const res = await agentFor(testApp()).get("/api/products");
		expect(res.status).toBe(401);
	});

	it("search matches SKU and name, case-insensitively, and % is literal", async () => {
		await mkProduct(1, { sku: "ABC-100", name: "Copper pipe" });
		await mkProduct(2, { sku: "ZZZ-1", name: "Brass abc fitting" });
		await mkProduct(3, { sku: "Q-9", name: "100% cotton" });
		expect(ids(await list("?search=abc-1"))).toEqual([P1]);
		const byName = await list("?search=BRASS");
		expect(ids(byName)).toEqual([P2]);
		expect(byName.body.meta.count).toBe(1);
		expect(ids(await list("?search=%25"))).toEqual([P3]);
	});

	it("status=Deprecated, category and brand filters narrow the rows", async () => {
		await mkProduct(1, { status: "Deprecated" });
		await mkProduct(2, { category: "Tools", brand: "Zed" });
		await mkProduct(3);
		expect(ids(await list("?status=Deprecated"))).toEqual([P1]);
		expect(ids(await list("?category=Tools&brand=Zed"))).toEqual([P2]);
	});

	it("sort by lastSoldDate desc puts never-sold products last; asc too", async () => {
		await mkProduct(1);
		await mkProduct(2);
		await mkProduct(3);
		await mkSale(P1, "2026-01-10", "9");
		await mkSale(P3, "2026-03-01", "9");
		const desc = await list("?sort=lastSoldDate&dir=desc");
		expect(ids(desc)).toEqual([P3, P1, P2]);
		expect(ids(await list("?sort=lastSoldDate&dir=asc"))).toEqual([P1, P3, P2]);
		expect(desc.body.data[0].lastSoldDate).toBe("2026-03-01");
	});

	it("listPrices joins tier names and omits 0 tiers", async () => {
		await mkProduct(1, {
			tier_prices: ["12.5", "0", "9", "0", "0", "0", "0", "0", "0", "0"],
		});
		await mkProduct(2);
		const res = await list("?sort=sku&dir=asc");
		expect(res.body.data[0].listPrices).toEqual([
			{ code: 1, name: "Retail", value: 12.5 },
			{ code: 3, name: "Trade", value: 9 },
		]);
		expect(res.body.data[1].listPrices).toEqual([]);
	});

	it("last purchase and last sale read only counted rows, newest date wins", async () => {
		await mkProduct(1);
		await mkPurchase(P1, "2026-02-01", "4.5");
		await mkPurchase(P1, "2026-02-20", "7", false); // voided: ignored
		await mkPurchase(P1, "2026-02-10", "5.25");
		await mkSale(P1, "2026-03-05", "11");
		await mkSale(P1, "2026-03-09", "99", false);
		const row = (await list()).body.data[0];
		expect(row.lastPurchaseCost).toBe(5.25);
		expect(row.lastPurchaseDate).toBe("2026-02-10");
		expect(row.lastSoldPrice).toBe(11);
		expect(row.lastSoldDate).toBe("2026-03-05");
	});

	it("a product with no counted orders has null last values", async () => {
		await mkProduct(1);
		await mkPurchase(P1, "2026-02-20", "7", false);
		const row = (await list()).body.data[0];
		expect(row).toMatchObject({
			lastPurchaseCost: null,
			lastPurchaseDate: null,
			lastSoldPrice: null,
			lastSoldDate: null,
		});
	});

	it("sums stock across locations; a product with no stock rows is 0", async () => {
		await mkProduct(1);
		await mkProduct(2);
		await testDb.stock_level.createMany({
			data: ["A", "B"].map((loc) => ({
				product_id: P1,
				location_name: loc,
				on_hand: "10",
				allocated: "2",
				available: "8",
				on_order: "0",
				in_transit: "0",
				synced_at: now,
			})),
		});
		const res = await list("?sort=onHand&dir=desc");
		expect(res.body.data[0]).toMatchObject({ id: P1, onHand: 20, available: 16 });
		expect(res.body.data[1]).toMatchObject({ id: P2, onHand: 0, available: 0 });
	});

	it("returns thumbUrl for a stored primary picture, null for a product without images", async () => {
		await mkProduct(1);
		await mkProduct(2);
		const img = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
		await testDb.product_image.create({
			data: {
				id: img,
				product_id: P1,
				file_name: "a.png",
				content_type: "image/png",
				download_url: "https://x",
				position: 0,
				status: "stored",
				is_primary: true,
			},
		});
		const res = await list("?sort=sku&dir=asc");
		expect(res.body.data[0].thumbUrl).toBe(`/api/images/${img}/thumb`);
		expect(res.body.data[1].thumbUrl).toBeNull();
	});

	it("paginates and reports the filtered total in meta.count", async () => {
		for (const n of [1, 2, 3, 4]) await mkProduct(n);
		const res = await list("?sort=sku&dir=asc&page=2&limit=3");
		expect(ids(res)).toEqual([P4]);
		expect(res.body.meta.count).toBe(4);
	});

	it.each([
		"?sort=bogus",
		"?dir=sideways",
		"?limit=201",
		"?limit=0",
		"?page=0",
		"?page=abc",
		"?status=Weird",
	])("%s → 400 VALIDATION_ERROR", async (qs) => {
		const res = await list(qs);
		expect(res.status).toBe(400);
		expect(res.body.error.code).toBe("VALIDATION_ERROR");
	});
});

describe("GET /api/products/facets", () => {
	it("returns distinct sorted categories and brands without nulls", async () => {
		await mkProduct(1, { category: "Tools", brand: null });
		await mkProduct(2, { category: "Parts", brand: "Zed" });
		await mkProduct(3, { category: "Parts", brand: "Acme" });
		await mkProduct(4, { category: null });
		const agent = await loginAs(testApp(), "v@example.com");
		const res = await agent.get("/api/products/facets");
		expect(res.status).toBe(200);
		expect(res.body.data).toEqual({
			categories: ["Parts", "Tools"],
			brands: ["Acme", "Zed"],
		});
	});
});
