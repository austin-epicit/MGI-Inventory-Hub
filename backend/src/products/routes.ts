import { Router, type RequestHandler } from "express";
import { z } from "zod";
import type { Db } from "../db.js";
import { createSuccessResponse, httpError } from "../http/responses.js";
import { validate } from "../http/validate.js";
import { getCachedMe } from "../sync/engine.js";
import { validTimeZone, zonedParts } from "../sync/dates.js";
import { buildPriceHistory, PRICE_RANGES, rangeFrom, type PriceRange } from "./priceHistory.js";
import {
	getProductDetail,
	listProductPurchases,
	listProducts,
	listProductSales,
	loadPriceHistoryInput,
	PRODUCT_SORTS,
	productFacets,
	type Paging,
	type ProductQuery,
} from "./queries.js";

const text = z.string().trim().min(1).max(200);
const listQuery = z.object({
	search: text.optional(),
	category: text.optional(),
	brand: text.optional(),
	status: z.enum(["Active", "Setup required", "Deprecated"]).optional(),
	sort: z.enum(PRODUCT_SORTS).default("name"),
	dir: z.enum(["asc", "desc"]).default("asc"),
	page: z.coerce.number().int().min(1).default(1),
	limit: z.coerce.number().int().min(1).max(200).default(50),
});

const idParam = z.object({ id: z.string().uuid() });
const pageQuery = z.object({
	page: z.coerce.number().int().min(1).default(1),
	limit: z.coerce.number().int().min(1).max(100).default(10),
});
const historyQuery = z.object({
	range: z.enum(PRICE_RANGES as [PriceRange, ...PriceRange[]]).default("90d"),
});

export const createProductRoutes = (
	deps: { db: Db; clock?: () => Date; timeZone?: string },
	requireAuth: RequestHandler
): Router => {
	const router = Router();
	router.use(requireAuth);

	router.get("/facets", async (_req, res) => {
		res.json(createSuccessResponse(await productFacets(deps.db)));
	});

	router.get("/", validate({ query: listQuery }), async (req, res) => {
		const { rows, total } = await listProducts(
			deps.db,
			req.valid.query as ProductQuery
		);
		res.json(createSuccessResponse(rows, { count: total }));
	});

	const productExists = async (id: string) => {
		const found = await deps.db.product.findUnique({
			where: { id },
			select: { id: true },
		});
		if (!found) throw httpError(404, "NOT_FOUND", "Product not found");
	};

	router.get("/:id", validate({ params: idParam }), async (req, res) => {
		const detail = await getProductDetail(
			deps.db,
			(req.valid.params as { id: string }).id
		);
		if (!detail) throw httpError(404, "NOT_FOUND", "Product not found");
		res.json(createSuccessResponse(detail));
	});

	for (const [path, list] of [
		["purchases", listProductPurchases],
		["sales", listProductSales],
	] as const) {
		router.get(
			`/:id/${path}`,
			validate({ params: idParam, query: pageQuery }),
			async (req, res) => {
				const { id } = req.valid.params as { id: string };
				await productExists(id);
				const { rows, total } = await list(
					deps.db,
					id,
					req.valid.query as Paging
				);
				res.json(createSuccessResponse(rows, { count: total }));
			}
		);
	}

	router.get(
		"/:id/price-history",
		validate({ params: idParam, query: historyQuery }),
		async (req, res) => {
			const { id } = req.valid.params as { id: string };
			const { range } = req.valid.query as { range: PriceRange };
			await productExists(id);
			const tz =
				validTimeZone((await getCachedMe(deps.db))?.timeZone) ??
				validTimeZone(deps.timeZone) ??
				"UTC";
			const today = zonedParts((deps.clock ?? (() => new Date()))(), tz).ymd;
			const input = await loadPriceHistoryInput(
				deps.db,
				id,
				rangeFrom(range, today)
			);
			res.json(
				createSuccessResponse(
					buildPriceHistory(input, { range, today, timeZone: tz })
				)
			);
		}
	);

	return router;
};
