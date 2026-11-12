import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { TEST_BASE_URL, testApp } from "../helpers/app.js";
import { clockAt, insertUser, PASSWORD } from "../helpers/auth.js";
import { resetDb, testDb } from "../helpers/db.js";

beforeEach(resetDb);
afterAll(() => testDb.$disconnect());

const login = (app: ReturnType<typeof testApp>, email: string, password: string) =>
	request(app).post("/api/auth/login").set("Origin", TEST_BASE_URL).send({ email, password });

describe("login", () => {
	it("logs in case-insensitively and never returns the hash", async () => {
		await insertUser("a@example.com");
		const res = await login(testApp(), "A@Example.com", PASSWORD);
		expect(res.status).toBe(200);
		expect(res.body.data).toMatchObject({ email: "a@example.com", role: "viewer" });
		expect(JSON.stringify(res.body)).not.toContain("password");
	});

	it("same 401 INVALID_CREDENTIALS for unknown email and wrong password", async () => {
		await insertUser("a@example.com");
		const app = testApp();
		const unknown = await login(app, "nobody@example.com", PASSWORD);
		const wrong = await login(app, "a@example.com", "wrong password here");
		expect(unknown.status).toBe(401);
		expect(wrong.status).toBe(401);
		expect(unknown.body.error).toEqual(wrong.body.error);
		expect(wrong.body.error.code).toBe("INVALID_CREDENTIALS");
	});

	it("an invited user without a password cannot log in", async () => {
		await insertUser("p@example.com", "viewer", { password: null });
		const res = await login(testApp(), "p@example.com", PASSWORD);
		expect(res.status).toBe(401);
	});

	it("5 failed logins lock the email for 15 min", async () => {
		await insertUser("a@example.com");
		const t = clockAt("2026-03-01T12:00:00Z");
		const app = testApp({ clock: t.clock });
		for (let i = 0; i < 5; i++) {
			expect(
				(await login(app, "a@example.com", "wrong password here")).status
			).toBe(401);
		}
		const locked = await login(app, "A@example.com", PASSWORD);
		expect(locked.status).toBe(429);
		expect(locked.body.error.code).toBe("TOO_MANY_ATTEMPTS");

		t.advance(14 * 60_000);
		expect((await login(app, "a@example.com", PASSWORD)).status).toBe(429);
		t.advance(61_000);
		expect((await login(app, "a@example.com", PASSWORD)).status).toBe(200);
	});

	it("a success resets the failure count", async () => {
		await insertUser("a@example.com");
		const app = testApp();
		for (let i = 0; i < 4; i++)
			await login(app, "a@example.com", "wrong password here");
		expect((await login(app, "a@example.com", PASSWORD)).status).toBe(200);
		for (let i = 0; i < 4; i++)
			await login(app, "a@example.com", "wrong password here");
		expect((await login(app, "a@example.com", PASSWORD)).status).toBe(200);
	});

	it("unknown emails lock too, so lockout does not reveal accounts", async () => {
		const app = testApp();
		for (let i = 0; i < 5; i++)
			await login(app, "ghost@example.com", "wrong password here");
		expect((await login(app, "ghost@example.com", PASSWORD)).status).toBe(429);
	});

	it("failures from IP A do not lock the same email for IP B", async () => {
		await insertUser("a@example.com");
		const app = testApp({ trustProxy: 1 });
		const from = (ip: string, password: string) =>
			request(app)
				.post("/api/auth/login")
				.set("Origin", TEST_BASE_URL)
				.set("X-Forwarded-For", ip)
				.send({ email: "a@example.com", password });
		for (let i = 0; i < 5; i++) await from("203.0.113.1", "wrong password here");
		expect((await from("203.0.113.1", PASSWORD)).status).toBe(429);
		expect((await from("203.0.113.2", PASSWORD)).status).toBe(200);
	});

	it("per-IP limiter: 429 after 30 requests, separate bucket per forwarded IP", async () => {
		const app = testApp({ trustProxy: 1 });
		const from = (ip: string) =>
			request(app)
				.post("/api/auth/login")
				.set("Origin", TEST_BASE_URL)
				.set("X-Forwarded-For", ip)
				.send({}); // fails validation fast; the limiter still counts it
		for (let i = 0; i < 30; i++) expect((await from("203.0.113.1")).status).toBe(400);
		const limited = await from("203.0.113.1");
		expect(limited.status).toBe(429);
		expect(limited.body.error.code).toBe("TOO_MANY_ATTEMPTS");
		expect((await from("203.0.113.2")).status).toBe(400);
	});
});
