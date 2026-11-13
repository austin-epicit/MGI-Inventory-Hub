import { Prisma } from "../../generated/prisma/client.js";
import type { Db } from "../db.js";
import { primaryImagePaths, productImages } from "../images/store.js";
import { addDays, ymdToDbDate } from "../sync/dates.js";
import { round4 } from "../sync/money.js";
import type { PriceHistoryInput } from "./priceHistory.js";

export const PRODUCT_SORTS = [
	"name",
	"sku",
	"onHand",
	"averageCost",
	"lastPurchaseDate",
	"lastSoldDate",
] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];

export type ProductQuery = {
	search?: string;
	category?: string;
	brand?: string;
	status?: string;
	sort: ProductSort;
	dir: "asc" | "desc";
	page: number;
	limit: number;
};

export type ProductRow = {
	id: string;
	sku: string;
	name: string;
	category: string | null;
	brand: string | null;
	status: string;
	onHand: number;
	available: number;
	averageCost: number;
	listPrices: TierPrice[];
	lastPurchaseCost: number | null;
	lastPurchaseDate: string | null;
	lastSoldPrice: number | null;
	lastSoldDate: string | null;
	thumbUrl: string | null;
};

// Column per sort key; never interpolated from the request.
const SORT_SQL: Record<ProductSort, Prisma.Sql> = {
	name: Prisma.sql`lower(p.name)`,
	sku: Prisma.sql`lower(p.sku)`,
	onHand: Prisma.sql`COALESCE(s.on_hand, 0)`,
	averageCost: Prisma.sql`p.average_cost`,
	lastPurchaseDate: Prisma.sql`lp.order_date`,
	lastSoldDate: Prisma.sql`ls.order_date`,
};

export const escapeLike = (s: string): string => s.replace(/[\\%_]/g, "\\$&");
export const ymd = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);
export const money = (v: Prisma.Decimal | null): number | null =>
	v === null ? null : round4(Number(v));
export const qty = (v: Prisma.Decimal): number => round4(Number(v));

export type TierPrice = { code: number; name: string; value: number };

// tier_prices[i] is Cin7 PriceTier(i+1); a 0 tier means "not set" and is left out.
const setTierPrices = (prices: Prisma.Decimal[], tierName: Map<number, string>): TierPrice[] =>
	prices.flatMap((v, i) => {
		const value = round4(Number(v));
		const code = i + 1;
		return value > 0
			? [{ code, name: tierName.get(code) ?? `Tier ${code}`, value }]
			: [];
	});

type Raw = {
	id: string;
	sku: string;
	name: string;
	category: string | null;
	brand: string | null;
	status: string;
	average_cost: Prisma.Decimal;
	tier_prices: Prisma.Decimal[];
	on_hand: Prisma.Decimal;
	available: Prisma.Decimal;
	lp_cost: Prisma.Decimal | null;
	lp_date: Date | null;
	ls_price: Prisma.Decimal | null;
	ls_date: Date | null;
};

export async function listProducts(
	db: Db,
	q: ProductQuery
): Promise<{ rows: ProductRow[]; total: number }> {
	const where: Prisma.Sql[] = [];
	if (q.search) {
		const like = `%${escapeLike(q.search)}%`;
		where.push(Prisma.sql`(p.sku ILIKE ${like} OR p.name ILIKE ${like})`);
	}
	if (q.category) where.push(Prisma.sql`BTRIM(p.category) = BTRIM(${q.category})`);
	if (q.brand) where.push(Prisma.sql`BTRIM(p.brand) = BTRIM(${q.brand})`);
	if (q.status) where.push(Prisma.sql`p.status = ${q.status}`);
	const whereSql = where.length
		? Prisma.sql`WHERE ${Prisma.join(where, " AND ")}`
		: Prisma.empty;
	const dir = q.dir === "desc" ? Prisma.sql`DESC` : Prisma.sql`ASC`;

	// Last purchase/sale: newest counted order date; the order number breaks same-day ties.
	const rows = await db.$queryRaw<Raw[]>`
		SELECT p.id, p.sku, p.name, p.category, p.brand, p.status, p.average_cost, p.tier_prices,
			COALESCE(s.on_hand, 0) AS on_hand, COALESCE(s.available, 0) AS available,
			lp.unit_cost_base AS lp_cost, lp.order_date AS lp_date,
			ls.unit_price_base AS ls_price, ls.order_date AS ls_date
		FROM product p
		LEFT JOIN (
			SELECT product_id, SUM(on_hand) AS on_hand, SUM(available) AS available
			FROM stock_level GROUP BY product_id
		) s ON s.product_id = p.id
		LEFT JOIN LATERAL (
			SELECT pl.unit_cost_base, pu.order_date
			FROM purchase_line pl JOIN purchase pu ON pu.id = pl.purchase_id
			WHERE pl.product_id = p.id AND pu.counted AND pu.order_date IS NOT NULL
			ORDER BY pu.order_date DESC, pu.order_number DESC, pl.line_no DESC LIMIT 1
		) lp ON true
		LEFT JOIN LATERAL (
			SELECT sl.unit_price_base, sa.order_date
			FROM sale_line sl JOIN sale sa ON sa.id = sl.sale_id
			WHERE sl.product_id = p.id AND sa.counted AND sa.order_date IS NOT NULL
			ORDER BY sa.order_date DESC, sa.order_number DESC, sl.line_no DESC LIMIT 1
		) ls ON true
		${whereSql}
		ORDER BY ${SORT_SQL[q.sort]} ${dir} NULLS LAST, p.id
		LIMIT ${q.limit} OFFSET ${(q.page - 1) * q.limit}`;

	const [{ n }] = await db.$queryRaw<{ n: bigint }[]>`
		SELECT COUNT(*) AS n FROM product p ${whereSql}`;

	const [tiers, images] = await Promise.all([
		db.price_tier.findMany(),
		primaryImagePaths(
			db,
			rows.map((r) => r.id)
		),
	]);
	const tierName = new Map(tiers.map((t) => [t.code, t.name]));

	return {
		total: Number(n),
		rows: rows.map((r) => ({
			id: r.id,
			sku: r.sku,
			name: r.name,
			category: r.category,
			brand: r.brand,
			status: r.status,
			onHand: Number(r.on_hand),
			available: Number(r.available),
			averageCost: round4(Number(r.average_cost)),
			listPrices: setTierPrices(r.tier_prices, tierName),
			lastPurchaseCost: money(r.lp_cost),
			lastPurchaseDate: ymd(r.lp_date),
			lastSoldPrice: money(r.ls_price),
			lastSoldDate: ymd(r.ls_date),
			thumbUrl: images.get(r.id)?.thumbUrl ?? null,
		})),
	};
}

export async function productFacets(db: Db): Promise<{ categories: string[]; brands: string[] }> {
	const [cats, brands] = await Promise.all([
		db.product.findMany({
			where: { category: { not: null } },
			distinct: ["category"],
			select: { category: true },
		}),
		db.product.findMany({
			where: { brand: { not: null } },
			distinct: ["brand"],
			select: { brand: true },
		}),
	]);
	// Trimmed to match the filters and the breakdown keys, so a padded value is not listed twice.
	const sorted = (xs: (string | null)[]) =>
		[...new Set(xs.map((x) => x?.trim()).filter((x): x is string => !!x))].sort(
			(a, b) => a.localeCompare(b)
		);
	return {
		categories: sorted(cats.map((c) => c.category)),
		brands: sorted(brands.map((b) => b.brand)),
	};
}

// Every counted row in range, plus the one row before `from` each step series needs as carry-in.
// Newest-first caps are never used: a long history must not lose its latest rows.
export async function loadPriceHistoryInput(
	db: Db,
	productId: string,
	from: string | null
): Promise<PriceHistoryInput> {
	const inRange = from ? { gte: ymdToDbDate(from) } : undefined;
	// observed_at is an instant; one day of slack covers every zone, the builder re-dates exactly.
	const snapFrom = from ? new Date(`${addDays(from, -1)}T00:00:00.000Z`) : undefined;
	const lineSale = { counted: true, order_date: inRange ?? { not: null } };

	const [tiers, purchases, snapshots, snapBefore, sales, saleBefore, firstTracked, credits] =
		await Promise.all([
			db.price_tier.findMany({ orderBy: { code: "asc" } }),
			db.purchase_line.findMany({
				where: {
					product_id: productId,
					purchase: {
						counted: true,
						order_date: inRange ?? { not: null },
					},
				},
				include: { purchase: true },
				orderBy: [
					{ purchase: { order_date: "asc" } },
					{ purchase_id: "asc" },
					{ line_no: "asc" },
				],
			}),
			db.product_price_snapshot.findMany({
				where: {
					product_id: productId,
					...(snapFrom ? { observed_at: { gte: snapFrom } } : {}),
				},
				orderBy: [{ observed_at: "asc" }, { id: "asc" }],
			}),
			snapFrom
				? db.product_price_snapshot.findFirst({
						where: {
							product_id: productId,
							observed_at: { lt: snapFrom },
						},
						orderBy: [{ observed_at: "desc" }, { id: "desc" }],
					})
				: null,
			db.sale_line.findMany({
				where: { product_id: productId, sale: lineSale },
				include: {
					sale: {
						select: { order_date: true, price_tier_name: true },
					},
				},
				orderBy: [
					{ sale: { order_date: "asc" } },
					{ sale_id: "asc" },
					{ line_no: "asc" },
				],
			}),
			from
				? db.sale_line.findFirst({
						where: {
							product_id: productId,
							average_cost: { not: null },
							sale: {
								counted: true,
								order_date: {
									lt: ymdToDbDate(from),
								},
							},
						},
						include: {
							sale: {
								select: {
									order_date: true,
									price_tier_name: true,
								},
							},
						},
						orderBy: [
							{ sale: { order_date: "desc" } },
							{ sale_id: "desc" },
							{ line_no: "desc" },
						],
					})
				: null,
			db.product_price_snapshot.findFirst({
				where: { product_id: productId, source: "sync" },
				orderBy: { observed_at: "asc" },
				select: { observed_at: true },
			}),
			// Same rule as netSaleLines: counted notes whose sale exists (source: src/insights/netLines.ts).
			db.$queryRaw<
				{
					d: Date;
					q: Prisma.Decimal;
					price: Prisma.Decimal;
					avg: Prisma.Decimal | null;
				}[]
			>`
				SELECT n.credit_date AS d, c.quantity AS q, c.unit_price_base AS price,
					c.average_cost AS avg
				FROM sale_credit_line c
				JOIN sale_credit_note n ON n.id = c.credit_note_id
				JOIN sale s ON s.id = n.sale_id
				WHERE c.product_id = ${productId}::uuid AND n.counted
					AND n.credit_date IS NOT NULL
					AND n.credit_date >= ${from ?? "0001-01-01"}::date`,
		]);

	const saleLine = (l: (typeof sales)[number]) => ({
		date: ymd(l.sale.order_date)!,
		tierName: l.sale.price_tier_name,
		unitPrice: Number(l.unit_price_base),
		qty: Number(l.quantity),
		averageCost: l.average_cost === null ? null : Number(l.average_cost),
	});

	return {
		tiers: tiers.map((t) => ({ code: t.code, name: t.name })),
		purchases: purchases.map((l) => ({
			date: ymd(l.purchase.order_date)!,
			unitCost: Number(l.unit_cost_base),
			qty: Number(l.quantity),
			purchaseId: l.purchase_id,
			orderNumber: l.purchase.order_number,
			supplier: l.purchase.supplier_name,
		})),
		snapshots: [...(snapBefore ? [snapBefore] : []), ...snapshots].map((s) => ({
			observedAt: s.observed_at.toISOString(),
			averageCost: Number(s.average_cost),
			tierPrices: s.tier_prices.map(Number),
			source: s.source,
		})),
		// The pre-range line only seeds the average-cost carry-in; the builder keeps it out of stats.
		saleLines: [...(saleBefore ? [saleLine(saleBefore)] : []), ...sales.map(saleLine)],
		creditLines: credits.map((c) => ({
			date: ymd(c.d)!,
			unitPrice: Number(c.price),
			qty: Number(c.q),
			averageCost: c.avg === null ? null : Number(c.avg),
		})),
		firstTrackedAt: firstTracked?.observed_at.toISOString() ?? null,
	};
}

export type ProductDetail = {
	product: {
		id: string;
		sku: string;
		name: string;
		category: string | null;
		brand: string | null;
		type: string;
		status: string;
		uom: string | null;
		barcode: string | null;
		averageCost: number;
		syncedAt: string;
	};
	images: Awaited<ReturnType<typeof productImages>>;
	stock: {
		location: string;
		onHand: number;
		allocated: number;
		available: number;
		onOrder: number;
		inTransit: number;
	}[];
	tiers: TierPrice[];
};

export async function getProductDetail(db: Db, id: string): Promise<ProductDetail | null> {
	const p = await db.product.findUnique({ where: { id } });
	if (!p) return null;
	const [tiers, images, stock] = await Promise.all([
		db.price_tier.findMany(),
		productImages(db, id),
		// Bins and batches roll up into their location.
		db.stock_level.groupBy({
			by: ["location_name"],
			where: { product_id: id },
			_sum: {
				on_hand: true,
				allocated: true,
				available: true,
				on_order: true,
				in_transit: true,
			},
			orderBy: { location_name: "asc" },
		}),
	]);
	const sum = (v: Prisma.Decimal | null) => (v === null ? 0 : qty(v));
	return {
		product: {
			id: p.id,
			sku: p.sku,
			name: p.name,
			category: p.category,
			brand: p.brand,
			type: p.type,
			status: p.status,
			uom: p.uom,
			barcode: p.barcode,
			averageCost: round4(Number(p.average_cost)),
			syncedAt: p.synced_at.toISOString(),
		},
		images,
		stock: stock.map((s) => ({
			location: s.location_name,
			onHand: sum(s._sum.on_hand),
			allocated: sum(s._sum.allocated),
			available: sum(s._sum.available),
			onOrder: sum(s._sum.on_order),
			inTransit: sum(s._sum.in_transit),
		})),
		tiers: setTierPrices(p.tier_prices, new Map(tiers.map((t) => [t.code, t.name]))),
	};
}

export type Paging = { page: number; limit: number };

export type ProductPurchaseRow = {
	purchaseId: string;
	lineNo: number;
	orderNumber: string;
	orderDate: string | null;
	supplier: string;
	status: string;
	counted: boolean;
	quantity: number;
	unitCostBase: number;
	totalBase: number;
};

// Every order line for the product, voided and draft included: the table shows their status,
// only charts and KPIs skip uncounted rows.
export async function listProductPurchases(
	db: Db,
	productId: string,
	{ page, limit }: Paging
): Promise<{ rows: ProductPurchaseRow[]; total: number }> {
	const where = { product_id: productId };
	const [lines, total] = await Promise.all([
		db.purchase_line.findMany({
			where,
			include: { purchase: true },
			orderBy: [
				{ purchase: { order_date: { sort: "desc", nulls: "last" } } },
				{ purchase: { order_number: "desc" } },
				{ line_no: "asc" },
			],
			skip: (page - 1) * limit,
			take: limit,
		}),
		db.purchase_line.count({ where }),
	]);
	return {
		total,
		rows: lines.map((l) => ({
			purchaseId: l.purchase_id,
			lineNo: l.line_no,
			orderNumber: l.purchase.order_number,
			orderDate: ymd(l.purchase.order_date),
			supplier: l.purchase.supplier_name,
			status: l.purchase.status,
			counted: l.purchase.counted,
			quantity: qty(l.quantity),
			unitCostBase: round4(Number(l.unit_cost_base)),
			totalBase: round4(Number(l.total_base)),
		})),
	};
}

export type ProductSaleRow = {
	saleId: string;
	lineNo: number;
	orderNumber: string;
	orderDate: string | null;
	customer: string;
	priceTierName: string | null;
	status: string;
	counted: boolean;
	quantity: number;
	unitPriceBase: number;
	averageCost: number | null;
	totalBase: number;
};

export async function listProductSales(
	db: Db,
	productId: string,
	{ page, limit }: Paging
): Promise<{ rows: ProductSaleRow[]; total: number }> {
	const where = { product_id: productId };
	const [lines, total] = await Promise.all([
		db.sale_line.findMany({
			where,
			include: { sale: true },
			orderBy: [
				{ sale: { order_date: { sort: "desc", nulls: "last" } } },
				{ sale: { order_number: "desc" } },
				{ line_no: "asc" },
			],
			skip: (page - 1) * limit,
			take: limit,
		}),
		db.sale_line.count({ where }),
	]);
	return {
		total,
		rows: lines.map((l) => ({
			saleId: l.sale_id,
			lineNo: l.line_no,
			orderNumber: l.sale.order_number,
			orderDate: ymd(l.sale.order_date),
			customer: l.sale.customer_name,
			priceTierName: l.sale.price_tier_name,
			status: l.sale.status,
			counted: l.sale.counted,
			quantity: qty(l.quantity),
			unitPriceBase: round4(Number(l.unit_price_base)),
			averageCost: money(l.average_cost),
			totalBase: round4(Number(l.total_base)),
		})),
	};
}
