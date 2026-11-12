import os from "node:os";
import path from "node:path";
import type { Express } from "express";
import { z } from "zod";
import { getCin7Source, type SourceOpts } from "../../src/cin7/sourceFactory.js";
import { createApp, type AppDeps } from "../../src/app.js";
import { httpError } from "../../src/http/responses.js";
import { validate } from "../../src/http/validate.js";
import type { Env } from "../../src/env.js";
import type { Cin7Wiring } from "../../src/settings/routes.js";
import { testDb } from "./db.js";

export const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
export const TEST_BASE_URL = "http://localhost:5180";
export const TEST_SETUP_TOKEN = "test-setup-token";

export const testCin7Wiring = (
	over: Partial<Pick<Env, "CIN7_SOURCE" | "CIN7_BASE_URL">> = {},
	httpOpts: SourceOpts = {}
): Cin7Wiring => {
	const env = {
		CIN7_SOURCE: "fixture" as const,
		CIN7_BASE_URL: "http://localhost:1/ExternalApi/v2/",
		ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
		BACKFILL_MONTHS: 24,
		...over,
	};
	return { env, resolveSource: () => getCin7Source(testDb, env, httpOpts), httpOpts };
};

export const testApp = (overrides: Partial<AppDeps> = {}): Express =>
	createApp({
		db: testDb,
		clock: () => new Date("2026-03-01T12:00:00Z"),
		uploadsDir: path.join(os.tmpdir(), "mgi-test-uploads"),
		publicBaseUrl: TEST_BASE_URL,
		cin7: testCin7Wiring(),
		auth: {
			jwtSecret: "test-secret-test-secret-0123456789",
			sessionTtlHours: 12,
			setupToken: TEST_SETUP_TOKEN,
			secureCookie: false,
		},
		...overrides,
		// Test-only routes exercising the error pipeline; never part of the real app.
		extraRoutes: (api) => {
			api.post(
				"/_test/echo",
				validate({ body: z.object({ n: z.number() }) }),
				(req, res) => {
					res.json({
						success: true,
						data: req.valid.body,
						error: null,
					});
				}
			);
			api.get("/_test/conflict", () => {
				throw httpError(409, "CONFLICT", "x");
			});
			api.get("/_test/boom", () => {
				throw new Error("secret detail");
			});
			overrides.extraRoutes?.(api);
		},
	});
