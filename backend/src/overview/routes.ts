import { Router, type RequestHandler } from "express";
import { z } from "zod";
import type { Db } from "../db.js";
import { createSuccessResponse } from "../http/responses.js";
import { validate } from "../http/validate.js";
import { PRICE_RANGES, rangeFrom, type PriceRange } from "../products/priceHistory.js";
import { resolveToday } from "../sync/dates.js";
import { getOverview } from "./queries.js";

const overviewQuery = z.object({
	range: z.enum(PRICE_RANGES as [PriceRange, ...PriceRange[]]).default("30d"),
});

export const createOverviewRoutes = (
	deps: { db: Db; clock?: () => Date; timeZone?: string },
	requireAuth: RequestHandler
): Router => {
	const router = Router();
	router.use(requireAuth);

	router.get("/", validate({ query: overviewQuery }), async (req, res) => {
		const { range } = req.valid.query as { range: PriceRange };
		const today = await resolveToday(deps);
		res.json(
			createSuccessResponse(
				await getOverview(deps.db, {
					from: rangeFrom(range, today),
					to: today,
				})
			)
		);
	});

	return router;
};
