import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { requireRole } from "../auth/middleware.js";
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
import { validate } from "../http/validate.js";
import { getCachedMe } from "../sync/engine.js";
import { resolveToday, validTimeZone, zonedParts } from "../sync/dates.js";
import { CONDITION_GRADES, GRADE_LABELS, saveCondition } from "./condition.js";
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
	type ProductRow,
} from "./queries.js";

const text = z.string().trim().min(1).max(200);
const filterQuery = z.object({
	search: text.optional(),
	category: text.optional(),
	brand: text.optional(),
	status: z.enum(["Active", "Setup required", "Deprecated"]).optional(),
	grade: z.enum([...CONDITION_GRADES, "none"]).optional(),
	sort: z.enum(PRODUCT_SORTS).default("name"),
	dir: z.enum(["asc", "desc"]).default("asc"),
});
const listQuery = filterQuery.extend({
	page: z.coerce.number().int().min(1).default(1),
	limit: z.coerce.number().int().min(1).max(200).default(50),
});

const productColumns = (rows: ProductRow[]): CsvColumn<ProductRow>[] => {
	// One column per tier set on any exported row, ascending by code.
	const tiers = new Map<number, string>();
	for (const r of rows) for (const t of r.listPrices) tiers.set(t.code, t.name);
	const tierColumns = [...tiers]
		.sort(([a], [b]) => a - b)
		.map(
			([code, name]): CsvColumn<ProductRow> => ({
				label: name,
				value: (r) => r.listPrices.find((t) => t.code === code)?.value,
			})
		);
	return [
		{ label: "SKU", value: (r) => r.sku },
		{ label: "Name", value: (r) => r.name },
		{ label: "Category", value: (r) => r.category },
		{ label: "Brand", value: (r) => r.brand },
		{ label: "Status", value: (r) => r.status },
		{ label: "Grade", value: (r) => (r.grade ? GRADE_LABELS[r.grade] : "") },
		{ label: "On hand", value: (r) => r.onHand },
		{ label: "Available", value: (r) => r.available },
		{ label: "Average cost", value: (r) => r.averageCost },
		...tierColumns,
		{ label: "Last purchase cost", value: (r) => r.lastPurchaseCost },
		{ label: "Last purchase date", value: (r) => r.lastPurchaseDate },
		{ label: "Last sold price", value: (r) => r.lastSoldPrice },
		{ label: "Last sold date", value: (r) => r.lastSoldDate },
	];
};

const idParam = z.object({ id: z.string().uuid() });
const pageQuery = z.object({
	page: z.coerce.number().int().min(1).default(1),
	limit: z.coerce.number().int().min(1).max(100).default(10),
});
const conditionBody = z.object({
	grade: z.enum(CONDITION_GRADES).nullable(),
	notes: z
		.string()
		.transform((v) => v.trim())
		.pipe(z.string().max(2000))
		.transform((v) => (v === "" ? null : v))
		.nullable(),
});
const historyQuery = z.object({
	range: z.enum(PRICE_RANGES as [PriceRange, ...PriceRange[]]).default("90d"),
});

export const createProductRoutes = (
	deps: { db: Db; clock?: () => Date; timeZone?: string; exportRowCap?: number },
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

	// Before /:id so "export.csv" isn't read as an id.
	router.get("/export.csv", validate({ query: filterQuery }), async (req, res) => {
		const cap = deps.exportRowCap ?? EXPORT_ROW_CAP;
		const { rows, total } = await listProducts(deps.db, {
			...(req.valid.query as Omit<ProductQuery, "page" | "limit">),
			page: 1,
			limit: cap + 1,
		});
		assertWithinCap(total, cap);
		sendCsv(
			res,
			exportFilename("products", await resolveToday(deps)),
			toCsv(productColumns(rows), rows)
		);
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

	router.put(
		"/:id/condition",
		requireRole("admin"),
		validate({ params: idParam, body: conditionBody }),
		async (req, res) => {
			const { id } = req.valid.params as { id: string };
			await productExists(id);
			const body = req.valid.body as z.infer<typeof conditionBody>;
			res.json(
				createSuccessResponse(
					await saveCondition(deps.db, id, body, req.user!.id)
				)
			);
		}
	);

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
