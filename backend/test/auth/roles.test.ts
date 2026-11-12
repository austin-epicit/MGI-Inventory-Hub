import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { testApp } from "../helpers/app.js";
import { agentFor, insertUser, loginAs } from "../helpers/auth.js";
import { resetDb, testDb } from "../helpers/db.js";

beforeEach(resetDb);
afterAll(() => testDb.$disconnect());

describe("roles", () => {
	it.each([
		["get", "/api/users", undefined],
		[
			"post",
			"/api/users/invites",
			{ email: "x@example.com", name: "X", role: "viewer" },
		],
		["patch", "/api/users/:id", { role: "admin" }],
		["post", "/api/users/:id/reset-link", undefined],
	] as const)("viewer → 403 on %s %s", async (method, path, body) => {
		const viewer = await insertUser("v@example.com");
		const agent = await loginAs(testApp(), "v@example.com");
		const res = await agent[method](path.replace(":id", viewer.id)).send(body);
		expect(res.status).toBe(403);
		expect(res.body.error.code).toBe("FORBIDDEN");
	});

	it("anonymous → 401 on the admin routes", async () => {
		const res = await agentFor(testApp()).get("/api/users");
		expect(res.status).toBe(401);
	});

	it("admin lists users without secrets", async () => {
		await insertUser("admin@example.com", "admin");
		await insertUser("p@example.com", "viewer", { password: null });
		const agent = await loginAs(testApp(), "admin@example.com");
		const res = await agent.get("/api/users");
		expect(res.status).toBe(200);
		expect(res.body.meta.count).toBe(2);
		expect(res.body.data.map((u: { email: string }) => u.email)).toEqual([
			"admin@example.com",
			"p@example.com",
		]);
		expect(res.body.data[1].pendingInvite).toBe(true);
		expect(JSON.stringify(res.body)).not.toContain("hash");
	});

	it("admin changes a role and deactivates / reactivates a user", async () => {
		await insertUser("admin@example.com", "admin");
		const v = await insertUser("v@example.com");
		const agent = await loginAs(testApp(), "admin@example.com");
		const promoted = await agent.patch(`/api/users/${v.id}`).send({ role: "admin" });
		expect(promoted.body.data.role).toBe("admin");
		const off = await agent.patch(`/api/users/${v.id}`).send({ deactivated: true });
		expect(off.body.data.deactivated).toBe(true);
		const on = await agent.patch(`/api/users/${v.id}`).send({ deactivated: false });
		expect(on.body.data.deactivated).toBe(false);
	});

	it("the last active admin cannot be demoted or deactivated", async () => {
		const admin = await insertUser("admin@example.com", "admin");
		const agent = await loginAs(testApp(), "admin@example.com");
		for (const body of [{ role: "viewer" }, { deactivated: true }]) {
			const res = await agent.patch(`/api/users/${admin.id}`).send(body);
			expect(res.status).toBe(409);
			expect(res.body.error.code).toBe("LAST_ADMIN");
		}
	});

	it("PATCH validates the id and body; an unknown user is 404", async () => {
		await insertUser("admin@example.com", "admin");
		const v = await insertUser("v@example.com");
		const agent = await loginAs(testApp(), "admin@example.com");
		expect(
			(await agent.patch("/api/users/not-a-uuid").send({ role: "admin" })).status
		).toBe(400);
		const missing = "00000000-0000-4000-8000-000000000000";
		expect(
			(await agent.patch(`/api/users/${missing}`).send({ role: "admin" })).status
		).toBe(404);
		expect((await agent.patch(`/api/users/${v.id}`).send({})).status).toBe(400);
		expect(
			(await agent.patch(`/api/users/${v.id}`).send({ role: "root" })).status
		).toBe(400);
	});

	it("reset-link for a deactivated user is refused", async () => {
		await insertUser("admin@example.com", "admin");
		const v = await insertUser("v@example.com", "viewer", { deactivated: true });
		const agent = await loginAs(testApp(), "admin@example.com");
		const res = await agent.post(`/api/users/${v.id}/reset-link`);
		expect(res.status).toBe(409);
	});
});
