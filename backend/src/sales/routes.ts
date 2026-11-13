import { Router, type RequestHandler } from "express";
import { z } from "zod";
import type { Db } from "../db.js";
import {
	assertWithinCap,
	type CsvColumn,
	EXPORT_ROW_CAP,
	exportFilename,
	sendCsv,
	toCsv,
} from "../http/csv.js";
import { createSuccessResponse, httpError } from "../http/responses.js";
import { validate, ymdParam } from "../http/validate.js";
import { resolveToday } from "../sync/dates.js";
import {
	getSaleDetail,
	listSales,
	saleFacets,
	SALE_SORTS,
	type SaleListRow,
	type SaleQuery,
} from "./queries.js";

const text = z.string().trim().min(1).max(200);
const filterQuery = z.object({
	search: text.optional(),
	status: text.optional(),
	customerId: z.string().uuid().optional(),
	tier: text.optional(),
	from: ymdParam.optional(),
	to: ymdParam.optional(),
	sort: z.enum(SALE_SORTS).default("orderDate"),
	dir: z.enum(["asc", "desc"]).default("desc"),
});
const rangeOk = (q: { from?: string; to?: string }) => !q.from || !q.to || q.from <= q.to;
const rangeIssue = { message: "from must not be after to", path: ["from"] };
const exportQuery = filterQuery.refine(rangeOk, rangeIssue);
const listQuery = filterQuery
	.extend({
		page: z.coerce.number().int().min(1).default(1),
		limit: z.coerce.number().int().min(1).max(200).default(50),
	})
	.refine(rangeOk, rangeIssue);
const idParam = z.object({ id: z.string().uuid() });

const saleColumns: CsvColumn<SaleListRow>[] = [
	{ label: "Order number", value: (r) => r.orderNumber },
	{ label: "Order date", value: (r) => r.orderDate },
	{ label: "Customer", value: (r) => r.customer },
	{ label: "Price tier", value: (r) => r.priceTierName },
	{ label: "Status", value: (r) => r.status },
	{ label: "Counted", value: (r) => (r.counted ? "Yes" : "No") },
	{ label: "Currency", value: (r) => r.currency },
	{ label: "Total", value: (r) => r.total },
	{ label: "Total (base)", value: (r) => r.totalBase },
	{ label: "Base currency", value: (r) => r.baseCurrency },
	{ label: "Lines", value: (r) => r.lineCount },
	{ label: "Invoice status", value: (r) => r.invoiceStatus },
];

export const createSaleRoutes = (
	deps: { db: Db; clock?: () => Date; timeZone?: string; exportRowCap?: number },
	requireAuth: RequestHandler
): Router => {
	const router = Router();
	router.use(requireAuth);

	router.get("/facets", async (_req, res) => {
		res.json(createSuccessResponse(await saleFacets(deps.db)));
	});

	router.get("/", validate({ query: listQuery }), async (req, res) => {
		const { rows, total } = await listSales(deps.db, req.valid.query as SaleQuery);
		res.json(createSuccessResponse(rows, { count: total }));
	});

	// Before /:id so "export.csv" isn't read as an id.
	router.get("/export.csv", validate({ query: exportQuery }), async (req, res) => {
		const cap = deps.exportRowCap ?? EXPORT_ROW_CAP;
		const { rows, total } = await listSales(deps.db, {
			...(req.valid.query as Omit<SaleQuery, "page" | "limit">),
			page: 1,
			limit: cap + 1,
		});
		assertWithinCap(total, cap);
		sendCsv(
			res,
			exportFilename("sales", await resolveToday(deps)),
			toCsv(saleColumns, rows)
		);
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
