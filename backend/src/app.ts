import cookieParser from "cookie-parser";
import express, { type Express, type Router } from "express";
import pinoHttp from "pino-http";
import type { Db } from "./db.js";
import { createRequireAuth } from "./auth/middleware.js";
import { createAuthRoutes } from "./auth/routes.js";
import type { AuthConfig } from "./auth/session.js";
import { errorHandler, notFoundHandler } from "./http/errors.js";
import { requireSameOrigin } from "./http/origin.js";
import { createSuccessResponse } from "./http/responses.js";
import { createImageRoutes } from "./images/routes.js";
import { log } from "./log.js";
import { createOverviewRoutes } from "./overview/routes.js";
import { createProductRoutes } from "./products/routes.js";
import { createPurchaseRoutes } from "./purchases/routes.js";
import { createSaleRoutes } from "./sales/routes.js";
import { createSettingsRoutes, createSyncRoutes, type Cin7Wiring } from "./settings/routes.js";
import { createUserRoutes } from "./users/routes.js";
import type { WebhookRunner } from "./webhooks/receiver.js";
import {
	createDefaultRunner,
	createWebhookAdminRoutes,
	createWebhookReceiver,
} from "./webhooks/routes.js";

export type AppDeps = {
	db: Db;
	clock: () => Date;
	// Fallback zone for calendar-day math until the first sync caches Cin7's TimeZone.
	timeZone?: string;
	publicBaseUrl: string;
	auth: AuthConfig;
	uploadsDir: string;
	cin7: Cin7Wiring;
	// Proxy hops in front of the API; client IPs for rate limits come from X-Forwarded-For.
	trustProxy?: number;
	// Tests inject one to flush the debounce; production builds the 15 s one.
	webhookRunner?: WebhookRunner;
	// Seam for routes that must exist before the 404 handler; the test helper uses it.
	extraRoutes?: (api: Router) => void;
};

export const createApp = (deps: AppDeps): Express => {
	const app = express();
	app.set("trust proxy", deps.trustProxy ?? 0);
	app.use(
		pinoHttp({
			logger: log,
			redact: [
				"req.headers.authorization",
				"req.headers.cookie",
				'res.headers["set-cookie"]',
			],
		})
	);
	// Before express.json: the receiver reads raw text, since Cin7 sends trailing commas.
	const webhookDeps = { ...deps, log };
	app.use(
		"/api/webhooks",
		createWebhookReceiver(
			webhookDeps,
			deps.webhookRunner ?? createDefaultRunner(webhookDeps)
		)
	);
	app.use(express.json({ limit: "1mb" }));
	app.use(cookieParser());

	const api = express.Router();
	const sameOrigin = requireSameOrigin(deps.publicBaseUrl);
	// Webhook calls come from Cin7's servers, not a browser tab, so they carry no same-origin proof.
	api.use((req, res, next) =>
		req.path.startsWith("/webhooks") ? next() : sameOrigin(req, res, next)
	);

	api.get("/health", async (_req, res) => {
		let dbStatus: "up" | "down" = "up";
		try {
			await deps.db.$queryRaw`SELECT 1`;
		} catch {
			dbStatus = "down";
		}
		// 503 so status-code probes see a down database.
		const up = dbStatus === "up";
		res.status(up ? 200 : 503).json(
			createSuccessResponse({ status: up ? "ok" : "degraded", db: dbStatus })
		);
	});

	const requireAuth = createRequireAuth(deps.db, deps.auth, deps.clock);
	api.use("/auth", createAuthRoutes(deps, requireAuth));
	api.use("/users", createUserRoutes(deps, requireAuth));
	api.use("/settings/webhooks", createWebhookAdminRoutes(webhookDeps, requireAuth));
	api.use("/settings", createSettingsRoutes({ ...deps, log }, requireAuth));
	api.use("/sync", createSyncRoutes({ ...deps, log }, requireAuth));
	api.use("/images", createImageRoutes(deps, requireAuth));
	api.use("/products", createProductRoutes(deps, requireAuth));
	api.use("/purchases", createPurchaseRoutes(deps, requireAuth));
	api.use("/sales", createSaleRoutes(deps, requireAuth));
	api.use("/overview", createOverviewRoutes(deps, requireAuth));

	deps.extraRoutes?.(api);
	app.use("/api", api);
	app.use(notFoundHandler);
	app.use(errorHandler);
	return app;
};
