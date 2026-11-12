import { Router, type RequestHandler } from "express";
import { z } from "zod";
import type { Db } from "../db.js";
import { createSuccessResponse, httpError } from "../http/responses.js";
import { validate, ymdParam } from "../http/validate.js";
import { getSaleDetail, listSales, saleFacets, SALE_SORTS, type SaleQuery } from "./queries.js";

const text = z.string().trim().min(1).max(200);
const listQuery = z
	.object({
		search: text.optional(),
		status: text.optional(),
		customerId: z.string().uuid().optional(),
		tier: text.optional(),
		from: ymdParam.optional(),
		to: ymdParam.optional(),
		sort: z.enum(SALE_SORTS).default("orderDate"),
		dir: z.enum(["asc", "desc"]).default("desc"),
		page: z.coerce.number().int().min(1).default(1),
		limit: z.coerce.number().int().min(1).max(200).default(50),
	})
	.refine((q) => !q.from || !q.to || q.from <= q.to, {
		message: "from must not be after to",
		path: ["from"],
	});
const idParam = z.object({ id: z.string().uuid() });

export const createSaleRoutes = (deps: { db: Db }, requireAuth: RequestHandler): Router => {
	const router = Router();
	router.use(requireAuth);

	router.get("/facets", async (_req, res) => {
		res.json(createSuccessResponse(await saleFacets(deps.db)));
	});

	router.get("/", validate({ query: listQuery }), async (req, res) => {
		const { rows, total } = await listSales(deps.db, req.valid.query as SaleQuery);
		res.json(createSuccessResponse(rows, { count: total }));
	});

	router.get("/:id", validate({ params: idParam }), async (req, res) => {
		const detail = await getSaleDetail(
			deps.db,
			(req.valid.params as { id: string }).id
		);
		if (!detail) throw httpError(404, "NOT_FOUND", "Sale not found");
		res.json(createSuccessResponse(detail));
	});

	return router;
};
