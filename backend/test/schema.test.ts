import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db.js";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = new Date("2026-03-01T12:00:00Z");

beforeEach(resetDb);
afterAll(() => testDb.$disconnect());

const purchaseData = (id: string) => ({
	id,
	order_number: "PO-1",
	type: "Simple Purchase",
	status: "AUTHORISED",
	order_status: "AUTHORISED",
	counted: true,
	supplier_name: "Acme",
	currency: "EUR",
	base_currency: "USD",
	currency_rate: "1.081234",
	total: "10",
	total_base: "10.8123",
	cin7_updated_at: now,
	raw: {},
	synced_at: now,
});

const lineData = (purchase_id: string, line_no: number) => ({
	purchase_id,
	line_no,
	sku: "S",
	name: "N",
	quantity: "1",
	unit_price: "1",
	discount_pct: "0",
	unit_cost_base: "1",
	total_base: "1",
});

describe("mirror schema", () => {
	it("stores one row of every mirror table", async () => {
		const raw = {};
		await testDb.location.create({
			data: { id: U(1), name: "Main", raw, synced_at: now },
		});
		await testDb.price_tier.create({
			data: { code: 1, name: "Retail", synced_at: now },
		});
		const party = {
			name: "X",
			currency: "USD",
			raw,
			cin7_modified_at: now,
			synced_at: now,
		};
		await testDb.supplier.create({ data: { id: U(2), ...party } });
		await testDb.customer.create({ data: { id: U(3), ...party } });
		await testDb.product.create({
			data: {
				id: U(4),
				sku: "SKU",
				name: "P",
				type: "Stock",
				status: "Active",
				average_cost: "1.5",
				tier_prices: [],
				raw,
				synced_at: now,
			},
		});
		await testDb.product_price_snapshot.create({
			data: {
				product_id: U(4),
				observed_at: now,
				average_cost: "1.5",
				tier_prices: ["1"],
				source: "sync",
			},
		});
		await testDb.product_image.create({
			data: {
				id: U(5),
				product_id: U(4),
				file_name: "a.jpg",
				content_type: "image/jpeg",
				download_url: "https://x/a.jpg",
				position: 0,
			},
		});
		await testDb.purchase.create({ data: purchaseData(U(6)) });
		await testDb.sale.create({
			data: {
				id: U(7),
				order_number: "SO-1",
				type: "Simple Sale",
				status: "AUTHORISED",
				order_status: "AUTHORISED",
				counted: true,
				customer_name: "C",
				currency: "USD",
				base_currency: "USD",
				currency_rate: "1",
				total: "5",
				total_base: "5",
				cin7_updated_at: now,
				raw,
				synced_at: now,
				lines: {
					create: {
						line_no: 1,
						sku: "S",
						name: "N",
						quantity: "1",
						unit_price: "5",
						discount_pct: "0",
						unit_price_base: "5",
						total_base: "5",
					},
				},
			},
		});
		await testDb.stock_level.create({
			data: {
				product_id: U(4),
				location_name: "Main",
				on_hand: "1",
				allocated: "0",
				available: "1",
				on_order: "0",
				in_transit: "0",
				synced_at: now,
			},
		});
		await testDb.cin7_connection.create({
			data: { account_id_enc: "a", application_key_enc: "b" },
		});
		await testDb.sync_cursor.create({ data: { entity: "product" } });
		const run = await testDb.sync_run.create({
			data: {
				kind: "full",
				trigger: "manual",
				status: "running",
				started_at: now,
			},
		});
		expect(run.counts).toEqual({});
		expect(run.errors).toEqual([]);
		expect(await testDb.product_image.count()).toBe(1);
		expect(await testDb.sale_line.count()).toBe(1);
	});

	it("cascades purchase deletion to its lines", async () => {
		await testDb.purchase.create({
			data: {
				...purchaseData(U(6)),
				lines: {
					create: [lineData(U(6), 1)].map(
						({ purchase_id: _p, ...l }) => l
					),
				},
			},
		});
		expect(await testDb.purchase_line.count()).toBe(1);
		await testDb.purchase.delete({ where: { id: U(6) } });
		expect(await testDb.purchase_line.count()).toBe(0);
	});

	it("rejects a duplicate (purchase_id, line_no)", async () => {
		await testDb.purchase.create({ data: purchaseData(U(6)) });
		await testDb.purchase_line.create({ data: lineData(U(6), 1) });
		await expect(
			testDb.purchase_line.create({ data: lineData(U(6), 1) })
		).rejects.toThrow();
	});

	it("round-trips ten tier prices as decimals", async () => {
		const prices = Array.from({ length: 10 }, (_, i) => `${i}.1234`);
		await testDb.product.create({
			data: {
				id: U(4),
				sku: "SKU",
				name: "P",
				type: "Stock",
				status: "Active",
				average_cost: "1",
				tier_prices: prices,
				raw: {},
				synced_at: now,
			},
		});
		const row = await testDb.product.findUniqueOrThrow({ where: { id: U(4) } });
		expect(row.tier_prices.map((d) => d.toFixed(4))).toEqual(prices);
	});

	it("reads a @db.Date back as the same calendar day under America/Los_Angeles", async () => {
		expect(process.env.TZ).toBe("America/Los_Angeles");
		await testDb.purchase.create({
			data: { ...purchaseData(U(6)), order_date: new Date("2026-03-01") },
		});
		const row = await testDb.purchase.findUniqueOrThrow({ where: { id: U(6) } });
		expect(row.order_date!.toISOString().slice(0, 10)).toBe("2026-03-01");
	});
});
