import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { gradeFromName } from "../../src/products/condition.js";
import { testApp } from "../helpers/app.js";
import { insertUser, loginAs } from "../helpers/auth.js";
import { resetDb, testDb } from "../helpers/db.js";

const now = new Date("2026-11-01T12:00:00Z");
const PID = "00000000-0000-4000-8000-000000000001";
const MISSING = "00000000-0000-4000-8000-000000000999";

beforeEach(resetDb);
afterAll(() => testDb.$disconnect());

const mkProduct = () =>
	testDb.product.create({
		data: {
			id: PID,
			sku: "SKU-1",
			name: "Widget 1",
			type: "Stock",
			status: "Active",
			average_cost: "1",
			tier_prices: ["0", "0", "0", "0", "0", "0", "0", "0", "0", "0"],
			raw: {},
			synced_at: now,
		},
	});

const setup = async () => {
	await mkProduct();
	await insertUser("boss@example.com", "admin");
	await insertUser("view@example.com", "viewer");
	const app = testApp();
	return {
		admin: await loginAs(app, "boss@example.com"),
		viewer: await loginAs(app, "view@example.com"),
	};
};
const url = `/api/products/${PID}/condition`;
const detail = async (agent: Awaited<ReturnType<typeof setup>>["admin"]) =>
	(await agent.get(`/api/products/${PID}`)).body.data;

describe("PUT /api/products/:id/condition", () => {
	it("admin saves grade and notes", async () => {
		const { admin } = await setup();
		const res = await admin.put(url).send({ grade: "B", notes: "  Scratched lid \n" });
		expect(res.status).toBe(200);
		expect(res.body.data).toMatchObject({
			grade: "B",
			notes: "Scratched lid",
			updatedBy: "boss",
		});
		expect((await detail(admin)).condition.grade).toBe("B");
	});

	it("viewer cannot write but can read", async () => {
		const { admin, viewer } = await setup();
		await admin.put(url).send({ grade: "A", notes: null });
		expect((await viewer.put(url).send({ grade: "C", notes: null })).status).toBe(403);
		expect((await detail(viewer)).condition.grade).toBe("A");
	});

	it("limits notes to 2,000 characters", async () => {
		const { admin } = await setup();
		expect(
			(await admin.put(url).send({ grade: null, notes: "x".repeat(2000) })).status
		).toBe(200);
		const res = await admin.put(url).send({ grade: null, notes: "x".repeat(2001) });
		expect(res.status).toBe(400);
		expect(res.body.error.code).toBe("VALIDATION_ERROR");
	});

	it("trims before the length check", async () => {
		const { admin } = await setup();
		const res = await admin
			.put(url)
			.send({ grade: null, notes: ` ${"x".repeat(2000)} ` });
		expect(res.status).toBe(200);
	});

	it("whitespace notes become null", async () => {
		const { admin } = await setup();
		const res = await admin.put(url).send({ grade: "C", notes: "  \n " });
		expect(res.body.data).toMatchObject({ grade: "C", notes: null });
	});

	it("rejects an unknown grade", async () => {
		const { admin } = await setup();
		expect((await admin.put(url).send({ grade: "D", notes: null })).status).toBe(400);
	});

	it("404s for a missing product", async () => {
		const { admin } = await setup();
		const res = await admin
			.put(`/api/products/${MISSING}/condition`)
			.send({ grade: "A", notes: null });
		expect(res.status).toBe(404);
	});

	it("clearing both deletes the row", async () => {
		const { admin } = await setup();
		await admin.put(url).send({ grade: "A", notes: "x" });
		const res = await admin.put(url).send({ grade: null, notes: null });
		expect(res.status).toBe(200);
		expect(res.body.data).toBeNull();
		expect(await testDb.product_condition.count()).toBe(0);
		expect((await detail(admin)).condition).toBeNull();
	});

	it("survives a product upsert from sync", async () => {
		const { admin } = await setup();
		await admin.put(url).send({ grade: "open_box", notes: null });
		await testDb.product.update({
			where: { id: PID },
			data: { name: "Renamed", synced_at: now },
		});
		expect((await detail(admin)).condition.grade).toBe("open_box");
	});

	it("reports updatedBy null once the editor is deleted", async () => {
		const { admin } = await setup();
		await admin.put(url).send({ grade: "A", notes: null });
		await testDb.user.delete({ where: { email: "boss@example.com" } });
		const row = await testDb.product_condition.findUniqueOrThrow({
			where: { product_id: PID },
		});
		expect(row.updated_by).toBeNull();
		const viewer = await loginAs(testApp(), "view@example.com");
		expect((await detail(viewer)).condition.updatedBy).toBeNull();
	});
});

describe("gradeFromName", () => {
	it("maps names to grades", () => {
		expect(gradeFromName("Dell R740 Grade A")).toBe("A");
		expect(gradeFromName("x grade b")).toBe("B");
		expect(gradeFromName("x Grade C")).toBe("C");
		expect(gradeFromName("HP 840 open box")).toBe("open_box");
		expect(gradeFromName("Cisco switch")).toBeNull();
	});
});
