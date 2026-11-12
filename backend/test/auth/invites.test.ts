import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { testApp } from "../helpers/app.js";
import {
	agentFor,
	clockAt,
	insertUser,
	loginAs,
	PASSWORD,
	tokenFromUrl,
	type Agent,
} from "../helpers/auth.js";
import { resetDb, testDb } from "../helpers/db.js";

beforeEach(resetDb);
afterAll(() => testDb.$disconnect());

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NEW_PASSWORD = "a brand new passphrase";
const OTHER_PASSWORD = "yet another passphrase";

const invite = (admin: Agent, email: string, role = "viewer") =>
	admin.post("/api/users/invites").send({ email, name: "New Person", role });

const spend = (app: ReturnType<typeof testApp>, path: string, token: string, password: string) =>
	agentFor(app).post(path).send({ token, password });

describe("invites", () => {
	it("invite link: single use, expires after 7 days", async () => {
		await insertUser("admin@example.com", "admin");
		const t = clockAt("2026-03-01T12:00:00Z");
		const app = testApp({ clock: t.clock });
		const admin = await loginAs(app, "admin@example.com");

		const res = await invite(admin, "New@Example.com", "viewer");
		expect(res.status).toBe(201);
		expect(res.body.data.inviteUrl).toMatch(
			/^http:\/\/localhost:5180\/invite\/[\w-]{43}$/
		);
		const token = tokenFromUrl(res.body.data.inviteUrl);

		// Only the hash is stored.
		const rows = await testDb.auth_token.findMany();
		expect(rows).toHaveLength(1);
		expect(rows[0].token_hash).not.toBe(token);

		const anon = agentFor(app);
		const ok = await anon
			.post("/api/auth/accept-invite")
			.send({ token, password: NEW_PASSWORD });
		expect(ok.status).toBe(200);
		expect(ok.body.data).toMatchObject({ email: "new@example.com", role: "viewer" });
		expect((await anon.get("/api/auth/me")).status).toBe(200);

		const reuse = await spend(app, "/api/auth/accept-invite", token, OTHER_PASSWORD);
		expect(reuse.status).toBe(400);
		expect(reuse.body.error.code).toBe("INVALID_TOKEN");

		const second = (await invite(admin, "late@example.com")).body.data.inviteUrl;
		t.advance(7 * DAY + 1000);
		const late = await spend(
			app,
			"/api/auth/accept-invite",
			tokenFromUrl(second),
			NEW_PASSWORD
		);
		expect(late.status).toBe(400);
		expect(late.body.error.code).toBe("INVALID_TOKEN");
	});

	it("still valid just inside 7 days", async () => {
		await insertUser("admin@example.com", "admin");
		const t = clockAt("2026-03-01T12:00:00Z");
		const app = testApp({ clock: t.clock });
		const admin = await loginAs(app, "admin@example.com");
		const url = (await invite(admin, "n@example.com")).body.data.inviteUrl;
		t.advance(6 * DAY + 23 * HOUR);
		const res = await spend(
			app,
			"/api/auth/accept-invite",
			tokenFromUrl(url),
			NEW_PASSWORD
		);
		expect(res.status).toBe(200);
	});

	it("re-inviting a pending user voids the old link; an active email is a 409", async () => {
		await insertUser("admin@example.com", "admin");
		const app = testApp();
		const admin = await loginAs(app, "admin@example.com");
		const first = tokenFromUrl(
			(await invite(admin, "n@example.com")).body.data.inviteUrl
		);
		const second = tokenFromUrl(
			(await invite(admin, "n@example.com", "admin")).body.data.inviteUrl
		);
		expect(await testDb.user.count({ where: { email: "n@example.com" } })).toBe(1);
		expect(
			(await spend(app, "/api/auth/accept-invite", first, NEW_PASSWORD)).status
		).toBe(400);
		const ok = await spend(app, "/api/auth/accept-invite", second, NEW_PASSWORD);
		expect(ok.body.data.role).toBe("admin");
		const taken = await invite(admin, "n@example.com");
		expect(taken.status).toBe(409);
		expect(taken.body.error.code).toBe("EMAIL_TAKEN");
	});

	it("a reset token cannot be used as an invite", async () => {
		const admin = await insertUser("admin@example.com", "admin");
		const app = testApp();
		const agent = await loginAs(app, "admin@example.com");
		const url = (await agent.post(`/api/users/${admin.id}/reset-link`)).body.data
			.resetUrl;
		const res = await spend(
			app,
			"/api/auth/accept-invite",
			tokenFromUrl(url),
			NEW_PASSWORD
		);
		expect(res.status).toBe(400);
	});

	it("rejects a short password and keeps the invite usable", async () => {
		await insertUser("admin@example.com", "admin");
		const app = testApp();
		const admin = await loginAs(app, "admin@example.com");
		const token = tokenFromUrl(
			(await invite(admin, "n@example.com")).body.data.inviteUrl
		);
		const bad = await spend(app, "/api/auth/accept-invite", token, "short");
		expect(bad.status).toBe(400);
		expect(bad.body.error.code).toBe("VALIDATION_ERROR");
		expect(
			(await spend(app, "/api/auth/accept-invite", token, NEW_PASSWORD)).status
		).toBe(200);
	});
});

describe("reset links", () => {
	it("reset link: 24 h, single use, old password stops working", async () => {
		const viewer = await insertUser("v@example.com");
		await insertUser("admin@example.com", "admin");
		const t = clockAt("2026-03-01T12:00:00Z");
		const app = testApp({ clock: t.clock });
		const admin = await loginAs(app, "admin@example.com");

		const url = (await admin.post(`/api/users/${viewer.id}/reset-link`)).body.data
			.resetUrl;
		expect(url).toMatch(/^http:\/\/localhost:5180\/reset\/[\w-]{43}$/);
		const token = tokenFromUrl(url);

		expect((await spend(app, "/api/auth/reset", token, NEW_PASSWORD)).status).toBe(200);
		const login = (password: string) =>
			agentFor(app)
				.post("/api/auth/login")
				.send({ email: "v@example.com", password });
		expect((await login(PASSWORD)).status).toBe(401);
		expect((await login(NEW_PASSWORD)).status).toBe(200);

		expect((await spend(app, "/api/auth/reset", token, OTHER_PASSWORD)).status).toBe(
			400
		);

		const fresh = (await admin.post(`/api/users/${viewer.id}/reset-link`)).body.data
			.resetUrl;
		t.advance(24 * HOUR + 1000);
		const late = await spend(
			app,
			"/api/auth/reset",
			tokenFromUrl(fresh),
			OTHER_PASSWORD
		);
		expect(late.status).toBe(400);
		expect(late.body.error.code).toBe("INVALID_TOKEN");
	});

	it("two simultaneous uses of one link: exactly one wins", async () => {
		const viewer = await insertUser("v@example.com");
		await insertUser("admin@example.com", "admin");
		const app = testApp();
		const admin = await loginAs(app, "admin@example.com");
		const url = (await admin.post(`/api/users/${viewer.id}/reset-link`)).body.data
			.resetUrl;
		const token = tokenFromUrl(url);
		const [a, b] = await Promise.all([
			spend(app, "/api/auth/reset", token, NEW_PASSWORD),
			spend(app, "/api/auth/reset", token, OTHER_PASSWORD),
		]);
		expect([a.status, b.status].sort()).toEqual([200, 400]);
	});

	it("a deactivated user does not get signed in by a reset link", async () => {
		const viewer = await insertUser("v@example.com");
		await insertUser("admin@example.com", "admin");
		const app = testApp();
		const admin = await loginAs(app, "admin@example.com");
		const url = (await admin.post(`/api/users/${viewer.id}/reset-link`)).body.data
			.resetUrl;
		await testDb.user.update({
			where: { id: viewer.id },
			data: { deactivated_at: new Date() },
		});
		const res = await spend(app, "/api/auth/reset", tokenFromUrl(url), NEW_PASSWORD);
		expect(res.status).toBe(403);
		expect(res.headers["set-cookie"]).toBeUndefined();
	});
});
