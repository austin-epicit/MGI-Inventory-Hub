import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { testApp } from "../helpers/app.js";
import { agentFor, insertUser, loginAs } from "../helpers/auth.js";
import { resetDb, testDb } from "../helpers/db.js";

const now = new Date("2026-11-01T12:00:00Z");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const P1 = id(1);
const MISSING = id(999);
const zeroTiers = ["0", "0", "0", "0", "0", "0", "0", "0", "0", "0"];

const mkProduct = (n: number, over: Record<string, unknown> = {}) =>
	testDb.product.create({
		data: {
			id: id(n),
			sku: `SKU-${n}`,
			name: `Widget ${n}`,
			category: "Servers",
			brand: "Dell",
			type: "Stock",
			status: "Active",
			uom: "Item",
			barcode: "0123",
			average_cost: "512.17264",
			tier_prices: zeroTiers,
			raw: {},
			synced_at: now,
			...over,
		},
	});

let seq = 0;
const order = (o: { date: string | null; status?: string; counted?: boolean }) => {
	seq += 1;
	return {
		n: seq,
		common: {
			type: "Simple",
			status: o.status ?? "AUTHORISED",
			order_status: o.status ?? "AUTHORISED",
			counted: o.counted ?? true,
			order_date: o.date ? new Date(`${o.date}T00:00:00.000Z`) : null,
			currency: "USD",
			base_currency: "USD",
			currency_rate: "1",
			total: "1",
			total_base: "1",
			cin7_updated_at: now,
			raw: {},
			synced_at: now,
		},
	};
};

const mkPurchase = async (
	date: string | null,
	cost: string,
	qty = "2",
	o: { status?: string; counted?: boolean } = {}
) => {
	const { n, common } = order({ date, ...o });
	await testDb.purchase.create({
		data: {
			id: id(1000 + n),
			order_number: `PO-${n}`,
			supplier_name: `Supplier ${n}`,
			...common,
			lines: {
				create: [
					{
						line_no: 1,
						product_id: P1,
						sku: "x",
						name: "x",
						quantity: qty,
						unit_price: cost,
						discount_pct: "0",
						unit_cost_base: cost,
						total_base: String(Number(cost) * Number(qty)),
					},
				],
			},
		},
	});
	return id(1000 + n);
};

const mkSale = async (
	date: string | null,
	price: string,
	o: { status?: string; counted?: boolean; tier?: string | null } = {}
) => {
	const { n, common } = order({ date, ...o });
	await testDb.sale.create({
		data: {
			id: id(2000 + n),
			order_number: `SO-${n}`,
			customer_name: `Customer ${n}`,
			price_tier_name: o.tier === undefined ? "Retail" : o.tier,
			...common,
			lines: {
				create: [
					{
						line_no: 1,
						product_id: P1,
						sku: "x",
						name: "x",
						quantity: "3",
						unit_price: price,
						discount_pct: "0",
						unit_price_base: price,
						average_cost: "400",
						total_base: String(Number(price) * 3),
					},
				],
			},
		},
	});
	return id(2000 + n);
};

const mkImage = (n: number, o: { position: number; primary?: boolean; status?: string }) =>
	testDb.product_image.create({
		data: {
			id: `cccccccc-cccc-4ccc-8ccc-${String(n).padStart(12, "0")}`,
			product_id: P1,
			file_name: `${n}.png`,
			content_type: "image/png",
			download_url: "https://x",
			position: o.position,
			is_primary: o.primary ?? false,
			status: (o.status ?? "stored") as "stored",
		},
	});

beforeEach(async () => {
	await resetDb();
	seq = 0;
	await testDb.price_tier.createMany({
		data: [
			{ code: 1, name: "Retail", synced_at: now },
			{ code: 2, name: "Wholesale", synced_at: now },
		],
	});
	await insertUser("v@example.com");
});
afterAll(() => testDb.$disconnect());

const get = async (path: string) => {
	const agent = await loginAs(testApp(), "v@example.com");
	return agent.get(path);
};

describe("GET /api/products/:id", () => {
	it("no session → 401", async () => {
		const res = await agentFor(testApp()).get(`/api/products/${P1}`);
		expect(res.status).toBe(401);
	});

	it("unknown product → 404, malformed id → 400", async () => {
		expect((await get(`/api/products/${MISSING}`)).status).toBe(404);
		expect((await get(`/api/products/not-a-uuid`)).status).toBe(400);
	});

	it("returns the product with money at 4 dp and only the tiers that are set", async () => {
		await mkProduct(1, {
			tier_prices: ["899.5", "0", "0", "650", "0", "0", "0", "0", "0", "0"],
		});
		const res = await get(`/api/products/${P1}`);
		expect(res.status).toBe(200);
		expect(res.body.data.product).toMatchObject({
			id: P1,
			sku: "SKU-1",
			name: "Widget 1",
			category: "Servers",
			brand: "Dell",
			type: "Stock",
			status: "Active",
			uom: "Item",
			barcode: "0123",
			averageCost: 512.1726,
		});
		// Tier 4 has no price_tier row: its name falls back rather than disappearing.
		expect(res.body.data.tiers).toEqual([
			{ code: 1, name: "Retail", value: 899.5 },
			{ code: 4, name: "Tier 4", value: 650 },
		]);
	});

	it("stock sums bins and batches per location, sorted by location", async () => {
		await mkProduct(1);
		const row = (location_name: string, bin: string, onHand: string) => ({
			product_id: P1,
			location_name,
			bin,
			on_hand: onHand,
			allocated: "1",
			available: String(Number(onHand) - 1),
			on_order: "4",
			in_transit: "0.5",
			synced_at: now,
		});
		await testDb.stock_level.createMany({
			data: [
				row("Warehouse", "A1", "10"),
				row("Warehouse", "B2", "5"),
				row("Annex", "", "2"),
			],
		});
		const res = await get(`/api/products/${P1}`);
		expect(res.body.data.stock).toEqual([
			{
				location: "Annex",
				onHand: 2,
				allocated: 1,
				available: 1,
				onOrder: 4,
				inTransit: 0.5,
			},
			{
				location: "Warehouse",
				onHand: 15,
				allocated: 2,
				available: 13,
				onOrder: 8,
				inTransit: 1,
			},
		]);
	});

	it("images: stored only, primary first then by position, with all three URLs", async () => {
		await mkProduct(1);
		await mkImage(1, { position: 0 });
		await mkImage(2, { position: 1, primary: true });
		await mkImage(3, { position: 2, status: "pending" });
		await mkImage(4, { position: 3 });
		const res = await get(`/api/products/${P1}`);
		const img = (n: number) => `cccccccc-cccc-4ccc-8ccc-${String(n).padStart(12, "0")}`;
		expect(res.body.data.images.map((i: { id: string }) => i.id)).toEqual([
			img(2),
			img(1),
			img(4),
		]);
		expect(res.body.data.images[0]).toEqual({
			id: img(2),
			thumbUrl: `/api/images/${img(2)}/thumb`,
			mediumUrl: `/api/images/${img(2)}/medium`,
			originalUrl: `/api/images/${img(2)}/original`,
			isPrimary: true,
		});
	});

	it("a product without pictures or stock returns empty arrays", async () => {
		await mkProduct(1);
		const res = await get(`/api/products/${P1}`);
		expect(res.body.data.images).toEqual([]);
		expect(res.body.data.stock).toEqual([]);
		expect(res.body.data.tiers).toEqual([]);
	});
});

describe("GET /api/products/:id/purchases", () => {
	it("lists every order for the product newest first, voided and draft included with status", async () => {
		await mkProduct(1);
		const a = await mkPurchase("2026-01-05", "100.12345");
		const b = await mkPurchase("2026-03-01", "120", "1", {
			status: "VOIDED",
			counted: false,
		});
		const c = await mkPurchase(null, "130", "1", { status: "DRAFT", counted: false });
		const res = await get(`/api/products/${P1}/purchases`);
		expect(res.status).toBe(200);
		expect(res.body.meta.count).toBe(3);
		// Undated drafts sort after dated orders.
		expect(res.body.data.map((r: { purchaseId: string }) => r.purchaseId)).toEqual([
			b,
			a,
			c,
		]);
		expect(res.body.data[1]).toEqual({
			purchaseId: a,
			lineNo: 1,
			orderNumber: "PO-1",
			orderDate: "2026-01-05",
			supplier: "Supplier 1",
			status: "AUTHORISED",
			counted: true,
			quantity: 2,
			unitCostBase: 100.1235,
			totalBase: 200.2469,
		});
		expect(res.body.data[0]).toMatchObject({ status: "VOIDED", counted: false });
		expect(res.body.data[2]).toMatchObject({ orderDate: null, status: "DRAFT" });
	});

	it("pages with page/limit and reports the total", async () => {
		await mkProduct(1);
		for (const d of ["2026-01-01", "2026-01-02", "2026-01-03"])
			await mkPurchase(d, "10");
		const res = await get(`/api/products/${P1}/purchases?page=2&limit=2`);
		expect(res.body.meta.count).toBe(3);
		expect(res.body.data.map((r: { orderDate: string }) => r.orderDate)).toEqual([
			"2026-01-01",
		]);
	});

	it.each(["?limit=0", "?limit=101", "?page=0"])("%s → 400", async (qs) => {
		await mkProduct(1);
		const res = await get(`/api/products/${P1}/purchases${qs}`);
		expect(res.status).toBe(400);
		expect(res.body.error.code).toBe("VALIDATION_ERROR");
	});

	it("unknown product → 404", async () => {
		expect((await get(`/api/products/${MISSING}/purchases`)).status).toBe(404);
	});
});

describe("GET /api/products/:id/sales", () => {
	it("lists every order newest first with tier, average cost and status", async () => {
		await mkProduct(1);
		const a = await mkSale("2026-02-01", "650.5", { tier: null });
		const b = await mkSale("2026-02-10", "700", { status: "VOIDED", counted: false });
		const res = await get(`/api/products/${P1}/sales?limit=10`);
		expect(res.status).toBe(200);
		expect(res.body.meta.count).toBe(2);
		expect(res.body.data).toEqual([
			{
				saleId: b,
				lineNo: 1,
				orderNumber: "SO-2",
				orderDate: "2026-02-10",
				customer: "Customer 2",
				priceTierName: "Retail",
				status: "VOIDED",
				counted: false,
				quantity: 3,
				unitPriceBase: 700,
				averageCost: 400,
				totalBase: 2100,
			},
			{
				saleId: a,
				lineNo: 1,
				orderNumber: "SO-1",
				orderDate: "2026-02-01",
				customer: "Customer 1",
				priceTierName: null,
				status: "AUTHORISED",
				counted: true,
				quantity: 3,
				unitPriceBase: 650.5,
				averageCost: 400,
				totalBase: 1951.5,
			},
		]);
	});

	it("unknown product → 404", async () => {
		expect((await get(`/api/products/${MISSING}/sales`)).status).toBe(404);
	});
});
