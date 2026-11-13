import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { requireRole } from "../auth/middleware.js";
import type { Db } from "../db.js";
import { createSuccessResponse } from "../http/responses.js";
import { validate } from "../http/validate.js";
import { resolveToday } from "../sync/dates.js";
import { ALERT_KEY_RE, getAlerts } from "./compute.js";
import { getThresholds, saveThresholds, thresholdsSchema } from "./thresholds.js";

const keyBody = z.object({ key: z.string().max(200).regex(ALERT_KEY_RE, "not an alert key") });

export const createAlertRoutes = (
	deps: { db: Db; clock?: () => Date; timeZone?: string },
	requireAuth: RequestHandler
): Router => {
	const router = Router();
	router.use(requireAuth);

	router.get("/", async (req, res) => {
		const today = await resolveToday(deps);
		res.json(createSuccessResponse(await getAlerts(deps.db, req.user!.id, today)));
	});

	router.get("/settings", async (_req, res) => {
		res.json(createSuccessResponse(await getThresholds(deps.db)));
	});

	router.put(
		"/settings",
		requireRole("admin"),
		validate({ body: thresholdsSchema }),
		async (req, res) => {
			res.json(
				createSuccessResponse(await saveThresholds(deps.db, req.valid.body))
			);
		}
	);

	router.post("/dismiss", validate({ body: keyBody }), async (req, res) => {
		const { key } = req.valid.body as { key: string };
		await deps.db.alert_dismissal.upsert({
			where: { user_id_alert_key: { user_id: req.user!.id, alert_key: key } },
			create: { user_id: req.user!.id, alert_key: key },
			update: {},
		});
		res.json(createSuccessResponse({ key, dismissed: true }));
	});

	router.post("/restore", validate({ body: keyBody }), async (req, res) => {
		const { key } = req.valid.body as { key: string };
		await deps.db.alert_dismissal.deleteMany({
			where: { user_id: req.user!.id, alert_key: key },
		});
		res.json(createSuccessResponse({ key, dismissed: false }));
	});

	return router;
};
