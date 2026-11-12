import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { testApp } from "../helpers/app.js";
import { agentFor, insertUser, loginAs } from "../helpers/auth.js";
import { resetDb, testDb } from "../helpers/db.js";

const now = new Date("2026-11-01T12:00:00Z");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const zeroTiers = ["0", "0", "0", "0", "0", "0", "0", "0", "0", "0"];
const MISSING = id(999);
const SUP_A = id(501);
const SUP_B = id(502);

type PoOpts = {
	n: number;
	date: string | null;
	status?: string;
	counted?: boolean;
	supplier?: string;
	supplierId?: string;
	currency?: string;
	rate?: string;
	total?: string;
	totalBase?: string;
	lines?: { productId?: string | null; qty?: string; cost?: string }[];
};

const mkPo = (o: PoOpts) =>
	testDb.purchase.create({
		data: {
			id: id(1000 + o.n),
			order_number: `PO-${o.n}`,
			type: "Simple Purchase",
			status: o.status ?? "AUTHORISED",
			order_status: o.status ?? "AUTHORISED",
			counted: o.counted ?? true,
			supplier_id: o.supplierId ?? SUP_A,
			supplier_name: o.supplier ?? "Acme Supply",
			order_date: o.date ? new Date(`${o.date}T00:00:00.000Z`) : null,
			currency: o.currency ?? "USD",
			base_currency: "USD",
			currency_rate: o.rate ?? "1",
			total: o.total ?? "100",
			total_base: o.totalBase ?? o.total ?? "100",
			receiving_status: "FULLY RECEIVED",
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
					unit_price: l.cost ?? "10",
					discount_pct: "0",
					unit_cost_base: l.cost ?? "10",
					total_base: String(
						Number(l.qty ?? 2) * Number(l.cost ?? 10)
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

describe("GET /api/purchases", () => {
	it("no session → 401", async () => {
		expect((await agentFor(testApp()).get("/api/purchases")).status).toBe(401);
	});

	it("lists voided and draft orders with their status, newest first", async () => {
		await mkPo({ n: 1, date: "2026-03-01" });
		await mkPo({ n: 2, date: "2026-03-05", status: "VOIDED", counted: false });
		await mkPo({ n: 3, date: "2026-03-09", status: "DRAFT", counted: false });
		const res = await get("/api/purchases");
		expect(res.status).toBe(200);
		expect(numbers(res)).toEqual(["PO-3", "PO-2", "PO-1"]);
		expect(res.body.meta.count).toBe(3);
		expect(res.body.data.map((r: { status: string }) => r.status)).toEqual([
			"DRAFT",
			"VOIDED",
			"AUTHORISED",
		]);
		expect(res.body.data[1]).toMatchObject({ counted: false, orderDate: "2026-03-05" });
	});

	it("from/to are inclusive calendar dates on order_date", async () => {
		await mkPo({ n: 1, date: "2026-02-28" });
		await mkPo({ n: 2, date: "2026-03-01" });
		await mkPo({ n: 3, date: "2026-03-31" });
		await mkPo({ n: 4, date: "2026-04-01" });
		await mkPo({ n: 5, date: null });
		const res = await get(
			"/api/purchases?from=2026-03-01&to=2026-03-31&sort=orderNumber&dir=asc"
		);
		expect(numbers(res)).toEqual(["PO-2", "PO-3"]);
		expect(res.body.meta.count).toBe(2);
	});

	it("rejects a bad date and a reversed range", async () => {
		expect((await get("/api/purchases?from=2026-02-31")).status).toBe(400);
		expect((await get("/api/purchases?from=2026-03-02&to=2026-03-01")).status).toBe(
			400
		);
	});

	it("search hits the order number and the supplier name, and treats % literally", async () => {
		await mkPo({
			n: 1,
			date: "2026-03-01",
			supplier: "Globex Corp",
			supplierId: SUP_B,
		});
		await mkPo({ n: 2, date: "2026-03-02", supplier: "Acme Supply" });
		expect(numbers(await get("/api/purchases?search=globex"))).toEqual(["PO-1"]);
		expect(numbers(await get("/api/purchases?search=PO-2"))).toEqual(["PO-2"]);
		expect(numbers(await get("/api/purchases?search=%25"))).toEqual([]);
	});

	it("filters by status and supplier, and facets list what exists", async () => {
		await mkPo({ n: 1, date: "2026-03-01", status: "RECEIVED" });
		await mkPo({
			n: 2,
			date: "2026-03-02",
			status: "VOIDED",
			counted: false,
			supplier: "Globex",
			supplierId: SUP_B,
		});
		expect(numbers(await get("/api/purchases?status=VOIDED"))).toEqual(["PO-2"]);
		expect(numbers(await get(`/api/purchases?supplierId=${SUP_A}`))).toEqual(["PO-1"]);
		const f = await get("/api/purchases/facets");
		expect(f.body.data.statuses).toEqual(["RECEIVED", "VOIDED"]);
		expect(f.body.data.suppliers).toEqual([
			{ id: SUP_A, name: "Acme Supply" },
			{ id: SUP_B, name: "Globex" },
		]);
	});

	it("pages and sorts by total", async () => {
		await mkPo({ n: 1, date: "2026-03-01", totalBase: "50" });
		await mkPo({ n: 2, date: "2026-03-02", totalBase: "300" });
		await mkPo({ n: 3, date: "2026-03-03", totalBase: "200" });
		const res = await get("/api/purchases?sort=totalBase&dir=desc&limit=2&page=2");
		expect(numbers(res)).toEqual(["PO-1"]);
		expect(res.body.meta.count).toBe(3);
		expect((await get("/api/purchases?sort=bogus")).status).toBe(400);
		expect((await get("/api/purchases?page=0")).status).toBe(400);
	});

	it("returns document and base totals and the line count", async () => {
		await mkPo({
			n: 1,
			date: "2026-03-01",
			currency: "EUR",
			rate: "0.92",
			total: "100",
			totalBase: "108.6957",
			lines: [{}, {}],
		});
		const [row] = (await get("/api/purchases")).body.data;
		expect(row).toMatchObject({
			id: id(1001),
			orderNumber: "PO-1",
			supplier: "Acme Supply",
			supplierId: SUP_A,
			currency: "EUR",
			total: 100,
			totalBase: 108.6957,
			lineCount: 2,
			receivingStatus: "FULLY RECEIVED",
			invoiceStatus: "INVOICED",
		});
	});
});

describe("GET /api/purchases/:id", () => {
	it("unknown → 404, malformed → 400", async () => {
		expect((await get(`/api/purchases/${MISSING}`)).status).toBe(404);
		expect((await get("/api/purchases/nope")).status).toBe(400);
	});

	it("returns the header with currency and rate, lines with thumbUrl and unit cost in base", async () => {
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
		await testDb.product_image.create({
			data: {
				id: "cccccccc-cccc-4ccc-8ccc-000000000001",
				product_id: P,
				file_name: "a.png",
				content_type: "image/png",
				download_url: "https://x",
				position: 0,
				is_primary: true,
				status: "stored",
			},
		});
		await mkPo({
			n: 1,
			date: "2026-03-01",
			currency: "EUR",
			rate: "0.920000",
			total: "40",
			totalBase: "43.4783",
			lines: [
				{ productId: P, qty: "2", cost: "21.7391" },
				{ productId: null, qty: "1", cost: "0" },
			],
		});
		const res = await get(`/api/purchases/${id(1001)}`);
		expect(res.status).toBe(200);
		const d = res.body.data;
		expect(d.purchase).toMatchObject({
			orderNumber: "PO-1",
			orderDate: "2026-03-01",
			currency: "EUR",
			baseCurrency: "USD",
			currencyRate: 0.92,
			total: 40,
			totalBase: 43.4783,
			receivingStatus: "FULLY RECEIVED",
			invoiceStatus: "INVOICED",
		});
		expect(d.lines).toHaveLength(2);
		expect(d.lines[0]).toMatchObject({
			productId: P,
			quantity: 2,
			unitCostBase: 21.7391,
			thumbUrl: expect.stringContaining("cccccccc-cccc-4ccc-8ccc-000000000001"),
		});
		expect(d.lines[1]).toMatchObject({ productId: null, thumbUrl: null });
	});
});
