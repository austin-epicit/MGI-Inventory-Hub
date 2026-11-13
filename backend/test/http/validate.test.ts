import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { fieldLabel } from "../../src/http/fieldLabels.js";
import { TEST_BASE_URL, testApp } from "../helpers/app.js";
import { insertUser, loginAs } from "../helpers/auth.js";
import { resetDb, testDb } from "../helpers/db.js";

beforeEach(resetDb);
afterAll(() => testDb.$disconnect());

const post = (path: string, body: object) =>
	request(testApp()).post(path).set("Origin", TEST_BASE_URL).send(body);

describe("validation messages", () => {
	it("empty login body names every missing field and points at the first", async () => {
		const res = await post("/api/auth/login", {});
		expect(res.status).toBe(400);
		expect(res.body.error.code).toBe("VALIDATION_ERROR");
		expect(res.body.error.message).toBe("Check these fields: Email, Password.");
		expect(res.body.error.field).toBe("email");
		expect(res.body.error.details).toHaveLength(2);
	});

	it("a bad invite email reads as one sentence", async () => {
		await insertUser("admin@example.com", "admin");
		const admin = await loginAs(testApp(), "admin@example.com");
		const res = await admin
			.post("/api/users/invites")
			.send({ email: "a@b", name: "Pat", role: "viewer" });
		expect(res.status).toBe(400);
		expect(res.body.error.message).toBe("Email: enter a valid email address.");
		expect(res.body.error.field).toBe("email");
	});

	it("a short password on accept-invite states the minimum", async () => {
		const res = await post("/api/auth/accept-invite", {
			token: "t",
			password: "short",
		});
		expect(res.status).toBe(400);
		expect(res.body.error.message).toBe("Password: must be at least 12 characters.");
		expect(res.body.error.field).toBe("password");
	});

	it("a too-long value states the maximum; an empty required string says required", async () => {
		const long = await post("/api/auth/setup", {
			setupToken: "x",
			name: "n".repeat(201),
			email: "a@example.com",
			password: "correct horse battery",
		});
		expect(long.body.error.message).toBe("Name: must be at most 200 characters.");
		const empty = await post("/api/auth/setup", {
			setupToken: "",
			name: "Ada",
			email: "a@example.com",
			password: "correct horse battery",
		});
		expect(empty.body.error.message).toBe("Setup token: required.");
		expect(empty.body.error.field).toBe("setupToken");
	});

	it("custom refinement messages are kept, lower-cased first", async () => {
		const res = await post("/api/auth/reset", { token: "t", password: "p".repeat(80) });
		expect(res.body.error.message).toBe("Password: must be at most 72 bytes.");
	});

	it("a custom regex message is kept", async () => {
		await insertUser("admin@example.com", "admin");
		const admin = await loginAs(testApp(), "admin@example.com");
		const res = await admin.get("/api/purchases?from=abc");
		expect(res.status).toBe(400);
		expect(res.body.error.message).toBe("From date: must be YYYY-MM-DD.");
	});

	it("a query error has no body/query prefix in field", async () => {
		await insertUser("admin@example.com", "admin");
		const admin = await loginAs(testApp(), "admin@example.com");
		const res = await admin.get("/api/purchases?from=2026-02-31");
		expect(res.status).toBe(400);
		expect(res.body.error.field).toBe("from");
		expect(res.body.error.message).toBe("From date: not a real date.");
	});
});

describe("fieldLabel", () => {
	it("uses the map, then splits camelCase", () => {
		expect(fieldLabel("setupToken")).toBe("Setup token");
		expect(fieldLabel("reorderPoint")).toBe("Reorder point");
		expect(fieldLabel("qty")).toBe("Qty");
	});
});

describe("generic error bodies", () => {
	it("unknown route -> friendly 404, no method or path", async () => {
		const res = await request(testApp()).get("/api/nope");
		expect(res.status).toBe(404);
		expect(res.body.error.code).toBe("NOT_FOUND");
		expect(res.body.error.message).toBe(
			"This action isn't available. Reload the page."
		);
	});

	it("a deliberate 502 httpError keeps its own message and code", async () => {
		const res = await request(testApp()).get("/api/_test/bad-gateway");
		expect(res.status).toBe(502);
		expect(res.body.error.code).toBe("UPSTREAM_DOWN");
		expect(res.body.error.message).toBe("Couldn't reach the thing. Try again.");
	});

	it.each(["test", "production"])(
		"a thrown 500 never leaks its text in message (NODE_ENV=%s)",
		async (env) => {
			const prev = process.env.NODE_ENV;
			process.env.NODE_ENV = env;
			try {
				const res = await request(testApp()).get("/api/_test/boom");
				expect(res.status).toBe(500);
				expect(res.body.error.code).toBe("SERVER_ERROR");
				expect(res.body.error.message).toBe(
					"Something went wrong on our side. Try again."
				);
				expect(res.body.error.details).toBe(
					env === "production" ? undefined : "secret detail"
				);
			} finally {
				process.env.NODE_ENV = prev;
			}
		}
	);
});
