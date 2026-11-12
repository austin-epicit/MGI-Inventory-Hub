import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { TEST_BASE_URL, TEST_SETUP_TOKEN, testApp } from "../helpers/app.js";
import { resetDb, testDb } from "../helpers/db.js";

beforeEach(resetDb);
afterAll(() => testDb.$disconnect());

const body = {
	setupToken: TEST_SETUP_TOKEN,
	name: "Ada",
	email: "Ada@Example.com ",
	password: "correct horse battery",
};
const post = (app: ReturnType<typeof testApp>, b: object) =>
	request(app).post("/api/auth/setup").set("Origin", TEST_BASE_URL).send(b);

describe("first admin setup", () => {
	it("reports needsSetup until a user exists", async () => {
		const app = testApp();
		const before = await request(app).get("/api/auth/setup-status");
		expect(before.body.data).toEqual({ needsSetup: true });
		await post(app, body);
		const after = await request(app).get("/api/auth/setup-status");
		expect(after.body.data).toEqual({ needsSetup: false });
	});

	it("setup creates the first admin once", async () => {
		const app = testApp();
		const bad = await post(app, { ...body, setupToken: "nope-nope" });
		expect(bad.status).toBe(403);
		expect(bad.body.error.code).toBe("BAD_SETUP_TOKEN");

		const ok = await post(app, body);
		expect(ok.status).toBe(201);
		expect(ok.body.data).toMatchObject({ email: "ada@example.com", role: "admin" });
		expect(ok.body.data.password_hash).toBeUndefined();
		expect(ok.headers["set-cookie"]?.[0]).toMatch(/^mgi_session=/);

		const again = await post(app, { ...body, email: "other@example.com" });
		expect(again.status).toBe(409);
		expect(again.body.error.code).toBe("ALREADY_SET_UP");
		expect(await testDb.user.count()).toBe(1);
	});

	it("two simultaneous setups create one admin", async () => {
		const app = testApp();
		const [a, b] = await Promise.all([
			post(app, body),
			post(app, { ...body, email: "other@example.com" }),
		]);
		expect([a.status, b.status].sort()).toEqual([201, 409]);
		expect(await testDb.user.count()).toBe(1);
	});

	it("password under 12 chars → 400 VALIDATION_ERROR", async () => {
		const res = await post(testApp(), { ...body, password: "short" });
		expect(res.status).toBe(400);
		expect(res.body.error.code).toBe("VALIDATION_ERROR");
		expect(res.body.error.message).toContain("body.password");
	});
});
