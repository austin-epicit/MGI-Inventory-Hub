import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { parseEnv } from "../src/env.js";
import { validate } from "../src/http/validate.js";
import { getSetting, setSetting } from "../src/settings/appSettings.js";
import { TEST_BASE_URL, testApp } from "./helpers/app.js";
import { resetDb, testDb } from "./helpers/db.js";

const b64 = (bytes: number) => Buffer.alloc(bytes, 7).toString("base64");
const validEnv = {
	DATABASE_URL: "postgresql://x@localhost/x",
	JWT_SECRET: "j".repeat(32),
	ENCRYPTION_KEY: b64(32),
	SETUP_TOKEN: "setup-token-1",
	PUBLIC_BASE_URL: TEST_BASE_URL,
};

beforeEach(resetDb);
afterAll(() => testDb.$disconnect());

describe("api foundation", () => {
	it("GET /api/health reports ok", async () => {
		const res = await request(testApp()).get("/api/health");
		expect(res.status).toBe(200);
		expect(res.body).toMatchObject({
			success: true,
			data: { status: "ok", db: "up" },
			error: null,
		});
		expect(typeof res.body.meta.timestamp).toBe("string");
	});

	it("GET /api/health -> 503 degraded when the database query fails", async () => {
		const brokenDb = {
			$queryRaw: () => Promise.reject(new Error("down")),
		} as unknown as typeof testDb;
		const res = await request(testApp({ db: brokenDb })).get("/api/health");
		expect(res.status).toBe(503);
		expect(res.body.data).toEqual({ status: "degraded", db: "down" });
	});

	it("unknown route -> 404 envelope", async () => {
		const res = await request(testApp()).get("/api/nope");
		expect(res.status).toBe(404);
		expect(res.body).toMatchObject({ success: false, data: null });
		expect(res.body.error.code).toBe("NOT_FOUND");
	});

	it("zod failure -> 400 VALIDATION_ERROR naming the field", async () => {
		const res = await request(testApp()).post("/api/_test/echo").send({ n: "x" });
		expect(res.status).toBe(400);
		expect(res.body.error.code).toBe("VALIDATION_ERROR");
		expect(res.body.error.message).toContain("body.n");
	});

	it("a bad query param is a 400, not silently dropped", async () => {
		const app = testApp({
			extraRoutes: (api) => {
				api.get(
					"/_test/page",
					validate({
						query: z.object({
							page: z.coerce
								.number()
								.int()
								.min(0)
								.default(0),
						}),
					}),
					(req, res) =>
						res.json({
							success: true,
							data: req.valid.query,
							error: null,
						})
				);
			},
		});
		const ok = await request(app).get("/api/_test/page?page=2");
		expect(ok.body.data).toEqual({ page: 2 });
		const bad = await request(app).get("/api/_test/page?page=abc");
		expect(bad.status).toBe(400);
		expect(bad.body.error.message).toContain("query.page");
	});

	it("thrown httpError -> its status and code", async () => {
		const res = await request(testApp()).get("/api/_test/conflict");
		expect(res.status).toBe(409);
		expect(res.body.error).toMatchObject({ code: "CONFLICT", message: "x" });
	});

	it("an unexpected throw -> 500 SERVER_ERROR envelope", async () => {
		const res = await request(testApp()).get("/api/_test/boom");
		expect(res.status).toBe(500);
		expect(res.body.error.code).toBe("SERVER_ERROR");
	});

	it("POST with a foreign Origin -> 403 BAD_ORIGIN; same origin passes", async () => {
		const app = testApp();
		const foreign = await request(app)
			.post("/api/_test/echo")
			.set("Origin", "https://evil.example")
			.send({ n: 1 });
		expect(foreign.status).toBe(403);
		expect(foreign.body.error.code).toBe("BAD_ORIGIN");

		const same = await request(app)
			.post("/api/_test/echo")
			.set("Origin", TEST_BASE_URL)
			.send({ n: 1 });
		expect(same.status).toBe(200);

		const referer = await request(app)
			.post("/api/_test/echo")
			.set("Referer", "https://evil.example/page")
			.send({ n: 1 });
		expect(referer.status).toBe(403);

		const get = await request(app)
			.get("/api/health")
			.set("Origin", "https://evil.example");
		expect(get.status).toBe(200);
	});

	it("webhook paths skip the origin check", async () => {
		const app = testApp({
			extraRoutes: (api) => {
				api.post("/webhooks/ping", (_req, res) => res.sendStatus(204));
			},
		});
		const res = await request(app)
			.post("/api/webhooks/ping")
			.set("Origin", "https://evil.example")
			.send({});
		expect(res.status).toBe(204);
	});
});

describe("parseEnv", () => {
	it("rejects a missing JWT_SECRET and a 16-byte ENCRYPTION_KEY", () => {
		expect(() => parseEnv({ ...validEnv, JWT_SECRET: undefined })).toThrow(
			/JWT_SECRET/
		);
		expect(() => parseEnv({ ...validEnv, ENCRYPTION_KEY: b64(16) })).toThrow(
			/ENCRYPTION_KEY/
		);
	});

	it("applies the documented defaults", () => {
		expect(parseEnv(validEnv)).toMatchObject({
			PORT: 3100,
			SESSION_TTL_HOURS: 12,
			APP_TIMEZONE: "America/Los_Angeles",
			CIN7_SOURCE: "fixture",
			CIN7_BASE_URL: "https://inventory.dearsystems.com/ExternalApi/v2/",
			UPLOADS_DIR: "/data/uploads",
			BACKFILL_MONTHS: 24,
			ALLOW_DEMO_DATA: false,
		});
	});

	it("production requires an https CIN7_BASE_URL", () => {
		const prod = { ...validEnv, NODE_ENV: "production", CIN7_SOURCE: "http" };
		expect(() =>
			parseEnv({ ...prod, CIN7_BASE_URL: "http://cin7.example/api/" })
		).toThrow(/CIN7_BASE_URL/);
		expect(
			parseEnv({ ...prod, CIN7_BASE_URL: "https://cin7.example/api/" })
				.CIN7_BASE_URL
		).toBe("https://cin7.example/api/");
		// Development and tests may point at a local fake over http.
		expect(
			parseEnv({ ...validEnv, CIN7_BASE_URL: "http://localhost:9/x/" })
		).toBeTruthy();
	});

	it("production refuses demo (fixture) data unless ALLOW_DEMO_DATA=true", () => {
		const prod = { ...validEnv, NODE_ENV: "production" };
		// CIN7_SOURCE defaults to fixture, so a production deploy that forgot it fails loudly.
		expect(() => parseEnv(prod)).toThrow(/ALLOW_DEMO_DATA/);
		expect(() => parseEnv({ ...prod, ALLOW_DEMO_DATA: "false" })).toThrow(
			/ALLOW_DEMO_DATA/
		);
		expect(parseEnv({ ...prod, CIN7_SOURCE: "http" })).toMatchObject({
			CIN7_SOURCE: "http",
			ALLOW_DEMO_DATA: false,
		});
	});

	it("a deliberate hosted demo opts in with ALLOW_DEMO_DATA=true", () => {
		const demo = { ...validEnv, NODE_ENV: "production", ALLOW_DEMO_DATA: "true" };
		expect(parseEnv(demo)).toMatchObject({
			CIN7_SOURCE: "fixture",
			ALLOW_DEMO_DATA: true,
		});
		// Only the literal values: a typo must not silently allow (or forbid) demo data.
		expect(() => parseEnv({ ...demo, ALLOW_DEMO_DATA: "yes" })).toThrow(
			/ALLOW_DEMO_DATA/
		);
	});
});

describe("app_setting", () => {
	it("round-trips and overwrites a JSON value", async () => {
		expect(await getSetting(testDb, "k")).toBeNull();
		await setSetting(testDb, "k", { tz: "America/Los_Angeles" });
		expect(await getSetting(testDb, "k")).toEqual({ tz: "America/Los_Angeles" });
		await setSetting(testDb, "k", "v2");
		expect(await getSetting(testDb, "k")).toBe("v2");
	});
});
