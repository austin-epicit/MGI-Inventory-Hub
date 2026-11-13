import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { testApp } from "../helpers/app.js";
import { agentFor, insertUser, loginAs } from "../helpers/auth.js";
import { resetDb, testDb } from "../helpers/db.js";

const now = new Date("2026-11-01T12:00:00Z");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const zeroTiers = ["0", "0", "0", "0", "0", "0", "0", "0", "0", "0"];
const MISSING = id(999);
const CUST_A = id(601);
const CUST_B = id(602);

type SoOpts = {
	n: number;
	date: string | null;
	status?: string;
	counted?: boolean;
	customer?: string;
	customerId?: string;
	tier?: string | null;
	currency?: string;
	rate?: string;
	total?: string;
	totalBase?: string;
	lines?: {
		productId?: string | null;
		qty?: string;
		price?: string;
		priceBase?: string;
		avg?: string | null;
	}[];
};

const mkSo = (o: SoOpts) =>
	testDb.sale.create({
		data: {
			id: id(2000 + o.n),
			order_number: `SO-${o.n}`,
			type: "Simple Sale",
			status: o.status ?? "AUTHORISED",
			order_status: o.status ?? "AUTHORISED",
			counted: o.counted ?? true,
			customer_id: o.customerId ?? CUST_A,
			customer_name: o.customer ?? "Initech",
			price_tier_name: o.tier === undefined ? "Retail" : o.tier,
			order_date: o.date ? new Date(`${o.date}T00:00:00.000Z`) : null,
			invoice_date: o.date ? new Date(`${o.date}T00:00:00.000Z`) : null,
			currency: o.currency ?? "USD",
			base_currency: "USD",
			currency_rate: o.rate ?? "1",
			total: o.total ?? "100",
			total_base: o.totalBase ?? o.total ?? "100",
			cogs_base: "60",
			invoice_status: "INVOICED",
			cin7_updated_at: now,
			raw: {},
			synced_at: now,
			lines: {
				create: (o.lines ?? []).map((l, i) => ({
					line_no: i + 1,
					product_id: l.productId ?? null,
					sku: `SKU-${i + 1}`,
					name: `Line ${i + 1}`,
					quantity: l.qty ?? "2",
					unit_price: l.price ?? "10",
					discount_pct: "0",
					unit_price_base: l.priceBase ?? l.price ?? "10",
					average_cost: l.avg === undefined ? "6" : l.avg,
					total_base: String(
						Number(l.qty ?? 2) *
							Number(l.priceBase ?? l.price ?? 10)
					),
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
const numbers = (res: { body: { data: { orderNumber: string }[] } }) =>
	res.body.data.map((r) => r.orderNumber);

describe("GET /api/sales", () => {
	it("no session → 401", async () => {
		expect((await agentFor(testApp()).get("/api/sales")).status).toBe(401);
	});

	it("lists voided and draft orders with their status", async () => {
		await mkSo({ n: 1, date: "2026-03-01" });
		await mkSo({ n: 2, date: "2026-03-05", status: "VOIDED", counted: false });
		await mkSo({ n: 3, date: "2026-03-09", status: "DRAFT", counted: false });
		const res = await get("/api/sales");
		expect(numbers(res)).toEqual(["SO-3", "SO-2", "SO-1"]);
		expect(res.body.data.map((r: { status: string }) => r.status)).toEqual([
			"DRAFT",
			"VOIDED",
			"AUTHORISED",
		]);
		expect(res.body.data[0].counted).toBe(false);
	});

	it("from/to are inclusive calendar dates on order_date", async () => {
		await mkSo({ n: 1, date: "2026-02-28" });
		await mkSo({ n: 2, date: "2026-03-01" });
		await mkSo({ n: 3, date: "2026-03-31" });
		await mkSo({ n: 4, date: "2026-04-01" });
		const res = await get(
			"/api/sales?from=2026-03-01&to=2026-03-31&sort=orderNumber&dir=asc"
		);
		expect(numbers(res)).toEqual(["SO-2", "SO-3"]);
		expect(numbers(await get("/api/sales?from=2026-03-31&to=2026-03-31"))).toEqual([
			"SO-3",
		]);
		expect((await get("/api/sales?to=2026-13-01")).status).toBe(400);
	});

	it("search hits the order number and the customer name", async () => {
		await mkSo({ n: 1, date: "2026-03-01", customer: "Hooli", customerId: CUST_B });
		await mkSo({ n: 2, date: "2026-03-02" });
		expect(numbers(await get("/api/sales?search=hool"))).toEqual(["SO-1"]);
		expect(numbers(await get("/api/sales?search=SO-2"))).toEqual(["SO-2"]);
	});

	it("filters by status, customer and tier; facets are derived from the data", async () => {
		await mkSo({ n: 1, date: "2026-03-01", status: "COMPLETED", tier: "Wholesale" });
		await mkSo({
			n: 2,
			date: "2026-03-02",
			status: "VOIDED",
			counted: false,
			customer: "Hooli",
			customerId: CUST_B,
			tier: null,
		});
		expect(numbers(await get("/api/sales?status=VOIDED"))).toEqual(["SO-2"]);
		expect(numbers(await get("/api/sales?excludeStatus=VOIDED"))).toEqual(["SO-1"]);
		expect(numbers(await get(`/api/sales?customerId=${CUST_B}`))).toEqual(["SO-2"]);
		expect(numbers(await get("/api/sales?tier=Wholesale"))).toEqual(["SO-1"]);
		const f = (await get("/api/sales/facets")).body.data;
		expect(f.statuses).toEqual(["COMPLETED", "VOIDED"]);
		expect(f.tiers).toEqual(["Wholesale"]);
		expect(f.customers).toEqual([
			{ id: CUST_B, name: "Hooli" },
			{ id: CUST_A, name: "Initech" },
		]);
	});

	it("tier filter matches a stored value with stray spaces; facets trim", async () => {
		await mkSo({ n: 1, date: "2026-03-01", tier: " Wholesale " });
		await mkSo({ n: 2, date: "2026-03-02", tier: "Wholesale" });
		expect(numbers(await get("/api/sales?tier=Wholesale")).sort()).toEqual([
			"SO-1",
			"SO-2",
		]);
		expect((await get("/api/sales/facets")).body.data.tiers).toEqual(["Wholesale"]);
	});

	it("shows document total and base total on the row", async () => {
		await mkSo({
			n: 1,
			date: "2026-03-01",
			currency: "CAD",
			rate: "1.350000",
			total: "135",
			totalBase: "100",
		});
		const [row] = (await get("/api/sales")).body.data;
		expect(row).toMatchObject({
			currency: "CAD",
			baseCurrency: "USD",
			total: 135,
			totalBase: 100,
			priceTierName: "Retail",
		});
	});
});

describe("GET /api/sales/:id", () => {
	it("unknown → 404, malformed → 400", async () => {
		expect((await get(`/api/sales/${MISSING}`)).status).toBe(404);
		expect((await get("/api/sales/nope")).status).toBe(400);
	});

	it("CAD sale: document total, base total, rate, line base price, average cost and margin", async () => {
		const P = id(1);
		await testDb.product.create({
			data: {
				id: P,
				sku: "S",
				name: "Widget",
				type: "Stock",
				status: "Active",
				average_cost: "1",
				tier_prices: zeroTiers,
				raw: {},
				synced_at: now,
			},
		});
		await mkSo({
			n: 1,
			date: "2026-03-01",
			currency: "CAD",
			rate: "1.350000",
			total: "270",
			totalBase: "200",
			lines: [
				{
					productId: P,
					qty: "2",
					price: "135",
					priceBase: "100",
					avg: "60",
				},
				{
					productId: null,
					qty: "1",
					price: "0",
					priceBase: "0",
					avg: null,
				},
			],
		});
		const res = await get(`/api/sales/${id(2001)}`);
		expect(res.status).toBe(200);
		const d = res.body.data;
		expect(d.sale).toMatchObject({
			orderNumber: "SO-1",
			orderDate: "2026-03-01",
			priceTierName: "Retail",
			currency: "CAD",
			baseCurrency: "USD",
			currencyRate: 1.35,
			total: 270,
			totalBase: 200,
			cogsBase: 60,
			invoiceStatus: "INVOICED",
		});
		expect(d.lines[0]).toMatchObject({
			productId: P,
			unitPrice: 135,
			unitPriceBase: 100,
			averageCost: 60,
			marginPct: 40,
			thumbUrl: null,
		});
		// No recorded average cost: margin is unknown, not 100%.
		expect(d.lines[1]).toMatchObject({ averageCost: null, marginPct: null });
		expect(d.sale.marginPct).toBe(40);
	});

	it("returns the sale's credit notes by date then number, drafts included and not counted", async () => {
		await mkSo({ n: 3, date: "2026-03-01", lines: [{ qty: "2", price: "10" }] });
		await mkSo({ n: 4, date: "2026-03-01", lines: [{ qty: "1", price: "10" }] });
		const note = (
			n: number,
			saleN: number,
			number: string,
			date: string,
			status: string,
			counted: boolean,
			lines: { sku: string; qty: string; price: string }[]
		) =>
			testDb.sale_credit_note.create({
				data: {
					id: id(3000 + n),
					sale_id: id(2000 + saleN),
					number,
					credit_date: new Date(`${date}T00:00:00.000Z`),
					status,
					counted,
					currency_rate: "1",
					total_base: String(
						lines.reduce(
							(a, l) =>
								a + Number(l.qty) * Number(l.price),
							0
						)
					),
					lines: {
						create: lines.map((l, i) => ({
							line_no: i + 1,
							sku: l.sku,
							name: `Name ${l.sku}`,
							quantity: l.qty,
							unit_price_base: l.price,
							total_base: String(
								Number(l.qty) * Number(l.price)
							),
						})),
					},
				},
			});
		await note(2, 3, "CN-2", "2026-03-10", "DRAFT", false, [
			{ sku: "B", qty: "1", price: "5" },
		]);
		await note(1, 3, "CN-1", "2026-03-10", "AUTHORISED", true, [
			{ sku: "A1", qty: "1", price: "10" },
			{ sku: "A2", qty: "2", price: "2.5" },
		]);
		await note(3, 4, "CN-X", "2026-03-02", "AUTHORISED", true, [
			{ sku: "Z", qty: "1", price: "1" },
		]);
		const d = (await get(`/api/sales/${id(2003)}`)).body.data;
		expect(d.creditNotes).toEqual([
			{
				id: id(3001),
				number: "CN-1",
				date: "2026-03-10",
				status: "AUTHORISED",
				counted: true,
				totalBase: 15,
				lines: [
					{
						sku: "A1",
						name: "Name A1",
						quantity: 1,
						unitPriceBase: 10,
						totalBase: 10,
					},
					{
						sku: "A2",
						name: "Name A2",
						quantity: 2,
						unitPriceBase: 2.5,
						totalBase: 5,
					},
				],
			},
			{
				id: id(3002),
				number: "CN-2",
				date: "2026-03-10",
				status: "DRAFT",
				counted: false,
				totalBase: 5,
				lines: [
					{
						sku: "B",
						name: "Name B",
						quantity: 1,
						unitPriceBase: 5,
						totalBase: 5,
					},
				],
			},
		]);
	});

	it("passes a credit note's null number and date through", async () => {
		await mkSo({ n: 6, date: "2026-03-01", lines: [{}] });
		await testDb.sale_credit_note.create({
			data: {
				id: id(3010),
				sale_id: id(2006),
				number: null,
				credit_date: null,
				status: "AUTHORISED",
				counted: true,
				currency_rate: "1",
				total_base: "0",
			},
		});
		const d = (await get(`/api/sales/${id(2006)}`)).body.data;
		expect(d.creditNotes).toEqual([
			{
				id: id(3010),
				number: null,
				date: null,
				status: "AUTHORISED",
				counted: true,
				totalBase: 0,
				lines: [],
			},
		]);
	});

	it("a sale with no credit notes returns an empty list", async () => {
		await mkSo({ n: 5, date: "2026-03-01", lines: [{}] });
		expect((await get(`/api/sales/${id(2005)}`)).body.data.creditNotes).toEqual([]);
	});
});
