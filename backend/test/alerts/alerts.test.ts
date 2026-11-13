import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { seedDemo } from "../../prisma/seed.js";
import { DEFAULT_THRESHOLDS, ALERT_THRESHOLDS_KEY } from "../../src/alerts/thresholds.js";
import { testApp } from "../helpers/app.js";
import { insertUser, loginAs, type Agent } from "../helpers/auth.js";
import { resetDb, testDb } from "../helpers/db.js";

const TODAY = "2026-11-12";
const CLOCK = new Date(`${TODAY}T12:00:00Z`);
const daysBefore = (ymd: string, n: number) =>
	new Date(Date.parse(`${ymd}T00:00:00.000Z`) - n * 86_400_000).toISOString().slice(0, 10);

type Cost = {
	key: string;
	dismissed: boolean;
	productId: string;
	changePct: number;
	latestDate: string;
	previousCost: number;
	latestCost: number;
	purchaseId: string;
};
type Slow = {
	key: string;
	dismissed: boolean;
	productId: string;
	value: number;
	lastSold: string | null;
	daysSinceSale: number | null;
};
type Payload = {
	costChanges: Cost[];
	slowMovers: Slow[];
	thresholds: typeof DEFAULT_THRESHOLDS;
	openCount: number;
};

let admin: Agent;
let viewer: Agent;
const extraPurchases: string[] = [];
let n = 0;

beforeAll(async () => {
	await resetDb();
	await seedDemo(testDb, { clock: () => CLOCK });
	await insertUser("admin@example.com", "admin");
	await insertUser("viewer@example.com", "viewer");
	const app = testApp({ clock: () => CLOCK });
	admin = await loginAs(app, "admin@example.com");
	viewer = await loginAs(app, "viewer@example.com");
}, 300_000);

afterEach(async () => {
	await testDb.alert_dismissal.deleteMany();
	await testDb.app_setting.deleteMany({ where: { key: ALERT_THRESHOLDS_KEY } });
	await testDb.purchase.deleteMany({ where: { id: { in: extraPurchases.splice(0) } } });
});
afterAll(() => testDb.$disconnect());

const get = async (a: Agent): Promise<Payload> => (await a.get("/api/alerts")).body.data;

// A product's current latest counted purchase line, by the same ordering the rule uses.
async function latestLine(productId: string) {
	const rows = await testDb.$queryRaw<
		{ purchase_id: string; line_no: number; unit_cost_base: string; order_date: Date }[]
	>`
		SELECT l.purchase_id::text, l.line_no, l.unit_cost_base::text, o.order_date
		FROM purchase_line l JOIN purchase o ON o.id = l.purchase_id
		WHERE l.product_id = ${productId}::uuid AND o.counted AND o.order_date IS NOT NULL
		ORDER BY o.order_date DESC, o.order_number DESC, l.line_no DESC LIMIT 1`;
	return rows[0]!;
}

// A counted purchase with one line for the product, dated `ago` days before TODAY.
async function buy(productId: string, ago: number, unitCost: number) {
	n += 1;
	const id = `00000000-0000-4000-8000-${String(900000 + n).padStart(12, "0")}`;
	extraPurchases.push(id);
	await testDb.purchase.create({
		data: {
			id,
			order_number: `PO-ALERT-${n}`,
			type: "Simple Purchase",
			status: "AUTHORISED",
			order_status: "AUTHORISED",
			counted: true,
			supplier_name: "Alert Supplier",
			order_date: new Date(`${daysBefore(TODAY, ago)}T00:00:00.000Z`),
			currency: "USD",
			base_currency: "USD",
			currency_rate: "1",
			total: String(unitCost),
			total_base: String(unitCost),
			cin7_updated_at: CLOCK,
			raw: {},
			synced_at: CLOCK,
			lines: {
				create: {
					line_no: 1,
					product_id: productId,
					sku: "X",
					name: "X",
					quantity: "1",
					unit_price: String(unitCost),
					discount_pct: "0",
					unit_cost_base: String(unitCost),
					total_base: String(unitCost),
				},
			},
		},
	});
	return id;
}

// A product with a purchase history, so its cost can be moved by one new line.
const anyBoughtProduct = async () => {
	const l = await testDb.purchase_line.findFirstOrThrow({
		where: {
			product_id: { not: null },
			unit_cost_base: { gt: 0 },
			purchase: { counted: true },
		},
	});
	return l.product_id!;
};

describe("GET /api/alerts", () => {
	it("defaults produce cost changes and slow movers", async () => {
		const p = await get(viewer);
		expect(p.thresholds).toEqual(DEFAULT_THRESHOLDS);
		expect(p.costChanges.length).toBeGreaterThan(0);
		expect(p.slowMovers.length).toBeGreaterThan(0);
		const earliest = daysBefore(TODAY, 90);
		for (const c of p.costChanges) {
			expect(Math.abs(c.changePct)).toBeGreaterThanOrEqual(15);
			expect(c.latestDate >= earliest).toBe(true);
			expect(c.dismissed).toBe(false);
		}
		for (const s of p.slowMovers) {
			expect(s.value).toBeGreaterThanOrEqual(1000);
			expect(s.lastSold === null || s.lastSold < earliest).toBe(true);
			if (s.lastSold === null) expect(s.daysSinceSale).toBeNull();
			else expect(s.daysSinceSale).toBeGreaterThanOrEqual(90);
		}
		expect(p.openCount).toBe(p.costChanges.length + p.slowMovers.length);
		const pcts = p.costChanges.map((c) => Math.abs(c.changePct));
		expect(pcts).toEqual([...pcts].sort((a, b) => b - a));
		const values = p.slowMovers.map((s) => s.value);
		expect(values).toEqual([...values].sort((a, b) => b - a));
	});

	it("cost alert matches the two latest purchase lines", async () => {
		const pid = await anyBoughtProduct();
		const prev = await latestLine(pid);
		const newId = await buy(pid, 1, Number(prev.unit_cost_base) * 2);
		const c = (await get(viewer)).costChanges.find((a) => a.productId === pid)!;
		expect(c.changePct).toBe(100);
		expect(c.key).toBe(`cost:${pid}:${newId}:1`);
		expect(c.latestDate).toBe(daysBefore(TODAY, 1));
		expect(c.latestCost).toBe(Number(prev.unit_cost_base) * 2);
		expect(c.previousCost).toBe(Number(prev.unit_cost_base));
		expect(c.purchaseId).toBe(newId);
	});

	it("zero previous cost never alerts", async () => {
		const pid = await anyBoughtProduct();
		const prev = await latestLine(pid);
		await buy(pid, 1, 50);
		await testDb.purchase_line.update({
			where: {
				purchase_id_line_no: {
					purchase_id: prev.purchase_id,
					line_no: prev.line_no,
				},
			},
			data: { unit_cost_base: "0" },
		});
		try {
			const res = await viewer.get("/api/alerts");
			expect(res.status).toBe(200);
			expect(
				res.body.data.costChanges.some((a: Cost) => a.productId === pid)
			).toBe(false);
		} finally {
			await testDb.purchase_line.update({
				where: {
					purchase_id_line_no: {
						purchase_id: prev.purchase_id,
						line_no: prev.line_no,
					},
				},
				data: { unit_cost_base: prev.unit_cost_base },
			});
		}
	});

	it("dismiss is per user and survives threshold change", async () => {
		const before = await get(admin);
		const key = before.costChanges[0]!.key;
		expect((await admin.post("/api/alerts/dismiss").send({ key })).status).toBe(200);
		const again = await admin.post("/api/alerts/dismiss").send({ key });
		expect(again.status).toBe(200);
		expect(again.body.data).toEqual({ key, dismissed: true });

		const adminView = await get(admin);
		expect(adminView.costChanges.find((c) => c.key === key)!.dismissed).toBe(true);
		expect(adminView.openCount).toBe(before.openCount - 1);
		expect((await get(viewer)).costChanges.find((c) => c.key === key)!.dismissed).toBe(
			false
		);

		const put = await admin
			.put("/api/alerts/settings")
			.send({ ...DEFAULT_THRESHOLDS, costChangePct: 10 });
		expect(put.status).toBe(200);
		expect((await get(admin)).costChanges.find((c) => c.key === key)!.dismissed).toBe(
			true
		);

		const restored = await admin.post("/api/alerts/restore").send({ key });
		expect(restored.body.data).toEqual({ key, dismissed: false });
		expect((await admin.post("/api/alerts/restore").send({ key })).status).toBe(200);
		expect((await get(admin)).costChanges.find((c) => c.key === key)!.dismissed).toBe(
			false
		);
	});

	it("new purchase makes a fresh alert", async () => {
		const pid = await anyBoughtProduct();
		const prev = await latestLine(pid);
		await buy(pid, 2, Number(prev.unit_cost_base) * 2);
		const first = (await get(admin)).costChanges.find((c) => c.productId === pid)!;
		await admin.post("/api/alerts/dismiss").send({ key: first.key });
		const newerId = await buy(pid, 1, Number(prev.unit_cost_base) * 4);
		const next = (await get(admin)).costChanges.find((c) => c.productId === pid)!;
		expect(next.key).toBe(`cost:${pid}:${newerId}:1`);
		expect(next.key).not.toBe(first.key);
		expect(next.dismissed).toBe(false);
	});

	it("slow mover keys carry the last sold day or never", async () => {
		const p = await get(viewer);
		for (const s of p.slowMovers) {
			expect(s.key).toBe(`slow:${s.productId}:${s.lastSold ?? "never"}`);
		}
	});

	it("thresholds validation and roles", async () => {
		const ok = { ...DEFAULT_THRESHOLDS };
		expect((await viewer.put("/api/alerts/settings").send(ok)).status).toBe(403);
		expect((await viewer.get("/api/alerts/settings")).body.data).toEqual(ok);
		expect(
			(await admin.put("/api/alerts/settings").send({ ...ok, costChangePct: 0 }))
				.status
		).toBe(400);
		expect(
			(
				await admin
					.put("/api/alerts/settings")
					.send({ ...ok, slowMoverDays: 1.5 })
			).status
		).toBe(400);
		expect(
			(
				await admin
					.put("/api/alerts/settings")
					.send({ ...ok, slowMoverMinValue: -1 })
			).status
		).toBe(400);
		const saved = {
			costChangePct: 25,
			costChangeDays: 30,
			slowMoverDays: 120,
			slowMoverMinValue: 0,
		};
		const put = await admin.put("/api/alerts/settings").send(saved);
		expect(put.status).toBe(200);
		expect(put.body.data).toEqual(saved);
		expect((await viewer.get("/api/alerts/settings")).body.data).toEqual(saved);
		expect((await get(viewer)).thresholds).toEqual(saved);

		await testDb.app_setting.update({
			where: { key: ALERT_THRESHOLDS_KEY },
			data: { value: "garbage" },
		});
		expect((await viewer.get("/api/alerts/settings")).body.data).toEqual(ok);
		await testDb.app_setting.update({
			where: { key: ALERT_THRESHOLDS_KEY },
			data: {
				value: {
					costChangePct: 40,
					costChangeDays: "x",
					slowMoverDays: 9999999,
				},
			},
		});
		expect((await viewer.get("/api/alerts/settings")).body.data).toEqual({
			...ok,
			costChangePct: 40,
		});
	});

	it("bad key is 400", async () => {
		for (const key of ["cost:../x", "", `slow:${"a".repeat(300)}`]) {
			expect((await admin.post("/api/alerts/dismiss").send({ key })).status).toBe(
				400
			);
			expect((await admin.post("/api/alerts/restore").send({ key })).status).toBe(
				400
			);
		}
	});

	it("needs a session", async () => {
		const { agentFor } = await import("../helpers/auth.js");
		const anon = agentFor(testApp({ clock: () => CLOCK }));
		expect((await anon.get("/api/alerts")).status).toBe(401);
	});
});
