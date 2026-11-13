import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { testApp } from "../helpers/app.js";
import { agentFor, insertUser, loginAs } from "../helpers/auth.js";
import { resetDb, testDb } from "../helpers/db.js";

const now = new Date("2026-03-01T12:00:00Z");
const id = (base: number, n: number) =>
	`00000000-0000-4000-8000-${String(base + n).padStart(12, "0")}`;

const productData = (n: number, over: Record<string, unknown> = {}) => ({
	id: id(0, n),
	sku: `SKU-${String(n).padStart(4, "0")}`,
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
});

const mkOrder = (kind: "purchase" | "sale", n: number, date: string, status: string) => {
	const common = {
		id: id(kind === "purchase" ? 5000 : 6000, n),
		order_number: `${kind === "purchase" ? "PO" : "SO"}-${n}`,
		type: "Simple",
		status,
		order_status: status,
		counted: status !== "VOIDED",
		order_date: new Date(`${date}T00:00:00.000Z`),
		currency: "USD",
		base_currency: "USD",
		currency_rate: "1",
		total: "10",
		total_base: "10",
		cin7_updated_at: now,
		raw: {},
		synced_at: now,
	};
	return kind === "purchase"
		? testDb.purchase.create({ data: { ...common, supplier_name: "S" } })
		: testDb.sale.create({ data: { ...common, customer_name: "C" } });
};

// Quote-aware parse; fine for the small outputs here.
const parseCsv = (text: string): string[][] => {
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = "";
	let quoted = false;
	const body = text.startsWith("﻿") ? text.slice(1) : text;
	for (let i = 0; i < body.length; i++) {
		const c = body[i];
		if (quoted) {
			if (c === '"' && body[i + 1] === '"') {
				cell += '"';
				i++;
			} else if (c === '"') quoted = false;
			else cell += c;
		} else if (c === '"') quoted = true;
		else if (c === ",") {
			row.push(cell);
			cell = "";
		} else if (c === "\r" && body[i + 1] === "\n") {
			row.push(cell);
			rows.push(row);
			row = [];
			cell = "";
			i++;
		} else cell += c;
	}
	return rows;
};

const csvText = (res: { text?: string; body: unknown }): string =>
	typeof res.text === "string" && res.text.length > 0
		? res.text
		: Buffer.from(res.body as Buffer).toString("utf8");

beforeEach(async () => {
	await resetDb();
	await testDb.price_tier.createMany({
		data: [
			{ code: 1, name: "Retail", synced_at: now },
			{ code: 2, name: "Wholesale", synced_at: now },
		],
	});
	await insertUser("v@example.com");
});
afterAll(() => testDb.$disconnect());

const viewer = () => loginAs(testApp(), "v@example.com");
const getCsv = (agent: Awaited<ReturnType<typeof viewer>>, url: string) =>
	agent.get(url).buffer(true);

describe("GET /api/products/export.csv", () => {
	it("has header and every filtered row", async () => {
		await testDb.product.createMany({
			data: [1, 2, 3].map((n) =>
				productData(n, {
					tier_prices: [
						"12.5",
						"0",
						"0",
						"0",
						"0",
						"0",
						"0",
						"0",
						"0",
						"0",
					],
				})
			),
		});
		const agent = await viewer();
		const list = await agent.get("/api/products");
		const res = await getCsv(agent, "/api/products/export.csv");
		expect(res.status).toBe(200);
		expect(res.headers["content-type"]).toMatch(/text\/csv/);
		expect(res.headers["content-disposition"]).toContain(
			'attachment; filename="mgi-products-2026-03-01.csv"'
		);
		expect(res.headers["cache-control"]).toBe("no-store");
		const text = csvText(res);
		expect(text.startsWith("﻿")).toBe(true);
		expect(text.endsWith("\r\n")).toBe(true);
		const rows = parseCsv(text);
		expect(rows).toHaveLength(1 + list.body.meta.count);
		expect(rows[0]).toEqual([
			"SKU",
			"Name",
			"Category",
			"Brand",
			"Status",
			"Grade",
			"On hand",
			"Available",
			"Average cost",
			"Retail",
			"Last purchase cost",
			"Last purchase date",
			"Last sold price",
			"Last sold date",
		]);
		expect(rows[1][9]).toBe("12.5");
	});

	it("honours filters and sort across all pages", async () => {
		await testDb.product.createMany({
			data: Array.from({ length: 230 }, (_, i) => productData(i + 1)),
		});
		await testDb.product_condition.createMany({
			data: [1, 2, 3].map((n) => ({
				product_id: id(0, n),
				grade: "A",
				updated_at: now,
			})),
		});
		const agent = await viewer();
		const qs = "?grade=none&sort=sku&dir=desc";
		const expected: string[] = [];
		for (let page = 1; page <= 2; page++) {
			const res = await agent.get(`/api/products${qs}&limit=200&page=${page}`);
			expected.push(...res.body.data.map((r: { sku: string }) => r.sku));
		}
		expect(expected).toHaveLength(227);
		const res = await getCsv(agent, `/api/products/export.csv${qs}`);
		const skus = parseCsv(csvText(res))
			.slice(1)
			.map((r) => r[0]);
		expect(skus).toEqual(expected);
		expect(skus[0]).toBe("SKU-0230");
	});

	it("a name with comma, quote and newline is one field; formula-like text is guarded", async () => {
		await testDb.product.createMany({
			data: [
				productData(1, { name: 'Dell 24", "Grade A"\nlot' }),
				productData(2, { name: '=HYPERLINK("x")' }),
				productData(3, { name: "-Refurb", average_cost: "-12.5000" }),
			],
		});
		const agent = await viewer();
		const res = await getCsv(agent, "/api/products/export.csv?sort=sku");
		const text = csvText(res);
		expect(text).toContain('"Dell 24"", ""Grade A""\nlot"');
		expect(text).toContain(`"'=HYPERLINK(""x"")"`);
		const rows = parseCsv(text);
		expect(rows).toHaveLength(4);
		expect(rows[1][1]).toBe('Dell 24", "Grade A"\nlot');
		expect(rows[2][1]).toBe(`'=HYPERLINK("x")`);
		expect(rows[3][1]).toBe("'-Refurb");
		expect(rows[3][8]).toBe("-12.5");
	});

	it("unauthenticated is 401; invalid filter is 400", async () => {
		expect((await agentFor(testApp()).get("/api/products/export.csv")).status).toBe(
			401
		);
		const agent = await viewer();
		expect((await agent.get("/api/products/export.csv?status=Bogus")).status).toBe(400);
	});

	it("over the cap is 422 TOO_MANY_ROWS", async () => {
		await testDb.product.createMany({ data: [1, 2, 3].map((n) => productData(n)) });
		const agent = await loginAs(testApp({ exportRowCap: 2 }), "v@example.com");
		const res = await agent.get("/api/products/export.csv");
		expect(res.status).toBe(422);
		expect(res.body.error.code).toBe("TOO_MANY_ROWS");
		expect(res.body.error.message).toBe("Too many rows to export. Narrow the filters.");
		expect((await agent.get("/api/products/export.csv?search=SKU-0001")).status).toBe(
			200
		);
	});
});

const PURCHASE_HEADER =
	"Order number,Order date,Supplier,Status,Counted,Currency,Total,Total (base),Base currency,Lines,Receiving status,Invoice status";
const SALE_HEADER =
	"Order number,Order date,Customer,Price tier,Status,Counted,Currency,Total,Total (base),Base currency,Lines,Invoice status";

describe.each([
	["purchases", "purchase", PURCHASE_HEADER],
	["sales", "sale", SALE_HEADER],
] as const)("GET /api/%s/export.csv", (path, kind, header) => {
	beforeEach(async () => {
		await mkOrder(kind, 1, "2026-01-05", "AUTHORISED");
		await mkOrder(kind, 2, "2026-02-10", "AUTHORISED");
		await mkOrder(kind, 3, "2026-02-20", "VOIDED");
		await mkOrder(kind, 4, "2025-12-01", "AUTHORISED");
	});

	it("honours from/to and status; counts match the list", async () => {
		const agent = await viewer();
		for (const qs of [
			"",
			"?from=2026-01-01&to=2026-02-28",
			"?from=2026-01-01&to=2026-02-28&status=VOIDED",
		]) {
			const list = await agent.get(`/api/${path}${qs}`);
			const res = await getCsv(agent, `/api/${path}/export.csv${qs}`);
			expect(res.status).toBe(200);
			expect(res.headers["content-disposition"]).toContain(
				`mgi-${path}-2026-03-01.csv`
			);
			const rows = parseCsv(csvText(res));
			expect(rows).toHaveLength(1 + list.body.meta.count);
			expect(rows[0].join(",")).toBe(header);
		}
		const voided = parseCsv(
			csvText(await getCsv(agent, `/api/${path}/export.csv?status=VOIDED`))
		);
		expect(voided).toHaveLength(2);
		expect(voided[1][header.split(",").indexOf("Counted")]).toBe("No");
	});

	it("401 without a session, 400 on a reversed range, 422 over the cap", async () => {
		expect((await agentFor(testApp()).get(`/api/${path}/export.csv`)).status).toBe(401);
		const agent = await viewer();
		expect(
			(await agent.get(`/api/${path}/export.csv?from=2026-03-01&to=2026-01-01`))
				.status
		).toBe(400);
		const capped = await loginAs(testApp({ exportRowCap: 2 }), "v@example.com");
		const res = await capped.get(`/api/${path}/export.csv`);
		expect(res.status).toBe(422);
		expect(res.body.error.code).toBe("TOO_MANY_ROWS");
	});
});
