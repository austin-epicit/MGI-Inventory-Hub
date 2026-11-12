import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { TEST_BASE_URL, testApp } from "../helpers/app.js";
import { agentFor, clockAt, insertUser, loginAs, PASSWORD } from "../helpers/auth.js";
import { resetDb, testDb } from "../helpers/db.js";

beforeEach(resetDb);
afterAll(() => testDb.$disconnect());

const HOUR = 3_600_000;
const credentials = { email: "a@example.com", password: PASSWORD };

describe("session", () => {
	it("cookie is httpOnly + SameSite=Strict, and /me works with it", async () => {
		await insertUser("a@example.com");
		const app = testApp();
		const res = await request(app)
			.post("/api/auth/login")
			.set("Origin", TEST_BASE_URL)
			.send(credentials);
		const cookie = res.headers["set-cookie"]![0];
		expect(cookie).toMatch(/HttpOnly/i);
		expect(cookie).toMatch(/SameSite=Strict/i);
		expect(cookie).toMatch(/Path=\//);
		expect(cookie).not.toMatch(/Secure/i);
		const me = await request(app).get("/api/auth/me").set("Cookie", cookie);
		expect(me.body.data).toMatchObject({ email: "a@example.com", role: "viewer" });
	});

	it("cookie is Secure in production", async () => {
		await insertUser("a@example.com");
		const app = testApp({
			auth: {
				jwtSecret: "test-secret-test-secret-0123456789",
				sessionTtlHours: 12,
				setupToken: "x",
				secureCookie: true,
			},
		});
		const res = await request(app)
			.post("/api/auth/login")
			.set("Origin", TEST_BASE_URL)
			.send(credentials);
		expect(res.headers["set-cookie"]![0]).toMatch(/Secure/i);
	});

	it("no cookie → 401 UNAUTHENTICATED; tampered cookie → 401", async () => {
		const app = testApp();
		expect((await request(app).get("/api/auth/me")).status).toBe(401);
		const res = await request(app)
			.get("/api/auth/me")
			.set("Cookie", "mgi_session=abc.def.ghi");
		expect(res.status).toBe(401);
		expect(res.body.error.code).toBe("UNAUTHENTICATED");
	});

	it("expires after SESSION_TTL_HOURS", async () => {
		await insertUser("a@example.com");
		const t = clockAt("2026-03-01T12:00:00Z");
		const app = testApp({ clock: t.clock });
		const agent = await loginAs(app, "a@example.com");
		t.advance(13 * HOUR); // no request in between, so no sliding re-issue
		expect((await agent.get("/api/auth/me")).status).toBe(401);
	});

	it("re-issued past half its life, not before", async () => {
		await insertUser("a@example.com");
		const t = clockAt("2026-03-01T12:00:00Z");
		const app = testApp({ clock: t.clock });
		const agent = await loginAs(app, "a@example.com");
		t.advance(5 * HOUR);
		expect((await agent.get("/api/auth/me")).headers["set-cookie"]).toBeUndefined();
		t.advance(2 * HOUR); // 7h of 12h used: less than half remains
		const res = await agent.get("/api/auth/me");
		expect(res.headers["set-cookie"]?.[0]).toMatch(/^mgi_session=/);
		t.advance(8 * HOUR); // 15h after login: alive only because of the re-issue
		expect((await agent.get("/api/auth/me")).status).toBe(200);
	});

	it("logout clears the cookie", async () => {
		await insertUser("a@example.com");
		const agent = await loginAs(testApp(), "a@example.com");
		const out = await agent.post("/api/auth/logout");
		expect(out.status).toBe(200);
		expect(out.headers["set-cookie"]![0]).toMatch(/^mgi_session=;/);
		expect((await agent.get("/api/auth/me")).status).toBe(401);
	});

	it("deactivated user: login 401 and an existing session → 401", async () => {
		const u = await insertUser("a@example.com");
		const app = testApp();
		const agent = await loginAs(app, "a@example.com");
		await testDb.user.update({
			where: { id: u.id },
			data: { deactivated_at: new Date() },
		});
		const me = await agent.get("/api/auth/me");
		expect(me.status).toBe(401);
		const login = await agentFor(app).post("/api/auth/login").send(credentials);
		expect(login.status).toBe(401);
		expect(login.body.error.code).toBe("INVALID_CREDENTIALS");
	});

	it("a session issued before a password reset is rejected after it", async () => {
		const u = await insertUser("a@example.com", "admin");
		const app = testApp();
		const old = await loginAs(app, "a@example.com");
		const admin = await loginAs(app, "a@example.com");
		const url = (await admin.post(`/api/users/${u.id}/reset-link`)).body.data.resetUrl;
		const token = url.split("/").pop();
		const spent = await agentFor(app)
			.post("/api/auth/reset")
			.send({ token, password: "a brand new passphrase" });
		expect(spent.status).toBe(200);
		expect((await old.get("/api/auth/me")).status).toBe(401);
		expect((await admin.get("/api/auth/me")).status).toBe(401);
		// The session the reset itself issued carries the new version.
		const fresh = agentFor(app);
		await fresh
			.post("/api/auth/login")
			.send({ email: "a@example.com", password: "a brand new passphrase" });
		expect((await fresh.get("/api/auth/me")).status).toBe(200);
	});

	it("accepting an invite bumps the session version", async () => {
		await insertUser("admin@example.com", "admin");
		const app = testApp();
		const admin = await loginAs(app, "admin@example.com");
		const res = await admin
			.post("/api/users/invites")
			.send({ email: "n@example.com", name: "N", role: "viewer" });
		const token = res.body.data.inviteUrl.split("/").pop();
		await agentFor(app)
			.post("/api/auth/accept-invite")
			.send({ token, password: "a brand new passphrase" });
		const row = await testDb.user.findUniqueOrThrow({
			where: { email: "n@example.com" },
		});
		expect(row.session_version).toBe(1);
	});

	it("a role change applies to the live session", async () => {
		const u = await insertUser("a@example.com", "admin");
		const agent = await loginAs(testApp(), "a@example.com");
		await testDb.user.update({ where: { id: u.id }, data: { role: "viewer" } });
		expect((await agent.get("/api/users")).status).toBe(403);
	});

	it("rejects a cross-origin login attempt", async () => {
		const res = await request(testApp())
			.post("/api/auth/login")
			.set("Origin", "http://evil.example")
			.send(credentials);
		expect(res.status).toBe(403);
	});
});
