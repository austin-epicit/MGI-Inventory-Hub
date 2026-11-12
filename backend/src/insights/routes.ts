import { Router, type RequestHandler } from "express";
import { z } from "zod";
import type { Db } from "../db.js";
import { createSuccessResponse } from "../http/responses.js";
import { validate } from "../http/validate.js";
import { PRICE_RANGES, type PriceRange } from "../products/priceHistory.js";
import { resolveToday } from "../sync/dates.js";
import { BREAKDOWN_DIMENSIONS, getBreakdown, type BreakdownBy } from "./breakdown.js";
import { getStockHealth } from "./stockHealth.js";
import { getTopProducts, TOP_PRODUCT_SORTS, type TopProductSort } from "./topProducts.js";
import { getTrend } from "./trend.js";

const trendQuery = z.object({
	range: z.enum(PRICE_RANGES as [PriceRange, ...PriceRange[]]).default("1y"),
});

const breakdownQuery = trendQuery.extend({
	by: z.enum(BREAKDOWN_DIMENSIONS).default("category"),
});

const topProductsQuery = trendQuery.extend({
	sort: z.enum(TOP_PRODUCT_SORTS).default("sales"),
});

export const createInsightsRoutes = (
	deps: { db: Db; clock?: () => Date; timeZone?: string },
	requireAuth: RequestHandler
): Router => {
	const router = Router();
	router.use(requireAuth);

	router.get("/trend", validate({ query: trendQuery }), async (req, res) => {
		const { range } = req.valid.query as { range: PriceRange };
		res.json(
			createSuccessResponse(
				await getTrend(deps.db, range, await resolveToday(deps))
			)
		);
	});

	router.get("/breakdown", validate({ query: breakdownQuery }), async (req, res) => {
		const { range, by } = req.valid.query as { range: PriceRange; by: BreakdownBy };
		res.json(
			createSuccessResponse(
				await getBreakdown(deps.db, range, by, await resolveToday(deps))
			)
		);
	});

	router.get("/top-products", validate({ query: topProductsQuery }), async (req, res) => {
		const { range, sort } = req.valid.query as {
			range: PriceRange;
			sort: TopProductSort;
		};
		res.json(
			createSuccessResponse(
				await getTopProducts(deps.db, range, sort, await resolveToday(deps))
			)
		);
	});

	router.get("/stock", async (_req, res) => {
		res.json(
			createSuccessResponse(
				await getStockHealth(deps.db, await resolveToday(deps))
			)
		);
	});

	return router;
};
