import { Prisma } from "../../generated/prisma/client.js";
import type { Db } from "../db.js";
import { primaryImagePaths } from "../images/store.js";
import { escapeLike, money, qty, ymd } from "../products/queries.js";
import { round4 } from "../sync/money.js";

export const PURCHASE_SORTS = [
	"orderDate",
	"orderNumber",
	"supplier",
	"status",
	"totalBase",
] as const;
export type PurchaseSort = (typeof PURCHASE_SORTS)[number];

export type PurchaseQuery = {
	search?: string;
	status?: string;
	supplierId?: string;
	from?: string;
	to?: string;
	sort: PurchaseSort;
	dir: "asc" | "desc";
	page: number;
	limit: number;
};

export type PurchaseListRow = {
	id: string;
	orderNumber: string;
	orderDate: string | null;
	supplierId: string | null;
	supplier: string;
	status: string;
	counted: boolean;
	currency: string;
	baseCurrency: string;
	total: number;
	totalBase: number;
	lineCount: number;
	receivingStatus: string | null;
	invoiceStatus: string | null;
};

// Column per sort key; never interpolated from the request.
const SORT_SQL: Record<PurchaseSort, Prisma.Sql> = {
	orderDate: Prisma.sql`p.order_date`,
	orderNumber: Prisma.sql`lower(p.order_number)`,
	supplier: Prisma.sql`lower(p.supplier_name)`,
	status: Prisma.sql`p.status`,
	totalBase: Prisma.sql`p.total_base`,
};

type Raw = {
	id: string;
	order_number: string;
	order_date: Date | null;
	supplier_id: string | null;
	supplier_name: string;
	status: string;
	counted: boolean;
	currency: string;
	base_currency: string;
	total: Prisma.Decimal;
	total_base: Prisma.Decimal;
	line_count: bigint;
	receiving_status: string | null;
	invoice_status: string | null;
};

// Voided and draft orders are listed with their status; only charts and KPIs skip uncounted rows.
export async function listPurchases(
	db: Db,
	q: PurchaseQuery
): Promise<{ rows: PurchaseListRow[]; total: number }> {
	const where: Prisma.Sql[] = [];
	if (q.search) {
		const like = `%${escapeLike(q.search)}%`;
		where.push(
			Prisma.sql`(p.order_number ILIKE ${like} OR p.supplier_name ILIKE ${like})`
		);
	}
	if (q.status) where.push(Prisma.sql`p.status = ${q.status}`);
	if (q.supplierId) where.push(Prisma.sql`p.supplier_id = ${q.supplierId}::uuid`);
	if (q.from) where.push(Prisma.sql`p.order_date >= ${q.from}::date`);
	if (q.to) where.push(Prisma.sql`p.order_date <= ${q.to}::date`);
	const whereSql = where.length
		? Prisma.sql`WHERE ${Prisma.join(where, " AND ")}`
		: Prisma.empty;
	const dir = q.dir === "desc" ? Prisma.sql`DESC` : Prisma.sql`ASC`;

	const rows = await db.$queryRaw<Raw[]>`
		SELECT p.id, p.order_number, p.order_date, p.supplier_id, p.supplier_name, p.status,
			p.counted, p.currency, p.base_currency, p.total, p.total_base,
			p.receiving_status, p.invoice_status,
			(SELECT COUNT(*) FROM purchase_line pl WHERE pl.purchase_id = p.id) AS line_count
		FROM purchase p
		${whereSql}
		ORDER BY ${SORT_SQL[q.sort]} ${dir} NULLS LAST, p.order_number DESC, p.id
		LIMIT ${q.limit} OFFSET ${(q.page - 1) * q.limit}`;
	const [{ n }] = await db.$queryRaw<{ n: bigint }[]>`
		SELECT COUNT(*) AS n FROM purchase p ${whereSql}`;

	return {
		total: Number(n),
		rows: rows.map((r) => ({
			id: r.id,
			orderNumber: r.order_number,
			orderDate: ymd(r.order_date),
			supplierId: r.supplier_id,
			supplier: r.supplier_name,
			status: r.status,
			counted: r.counted,
			currency: r.currency,
			baseCurrency: r.base_currency,
			total: round4(Number(r.total)),
			totalBase: round4(Number(r.total_base)),
			lineCount: Number(r.line_count),
			receivingStatus: r.receiving_status,
			invoiceStatus: r.invoice_status,
		})),
	};
}

export async function purchaseFacets(
	db: Db
): Promise<{ statuses: string[]; suppliers: { id: string; name: string }[] }> {
	const [statuses, suppliers] = await Promise.all([
		db.purchase.findMany({ distinct: ["status"], select: { status: true } }),
		db.purchase.findMany({
			where: { supplier_id: { not: null } },
			distinct: ["supplier_id"],
			select: { supplier_id: true, supplier_name: true },
		}),
	]);
	return {
		statuses: statuses.map((s) => s.status).sort((a, b) => a.localeCompare(b)),
		suppliers: suppliers
			.map((s) => ({ id: s.supplier_id!, name: s.supplier_name }))
			.sort((a, b) => a.name.localeCompare(b.name)),
	};
}

export type PurchaseLine = {
	lineNo: number;
	productId: string | null;
	sku: string;
	name: string;
	quantity: number;
	unitPrice: number;
	discountPct: number;
	unitCostBase: number;
	totalBase: number;
	thumbUrl: string | null;
};

export type PurchaseDetail = {
	purchase: {
		id: string;
		orderNumber: string;
		type: string;
		status: string;
		counted: boolean;
		orderDate: string | null;
		supplierId: string | null;
		supplier: string;
		currency: string;
		baseCurrency: string;
		currencyRate: number;
		total: number;
		totalBase: number;
		receivingStatus: string | null;
		invoiceStatus: string | null;
		syncedAt: string;
	};
	lines: PurchaseLine[];
};

export async function getPurchaseDetail(db: Db, id: string): Promise<PurchaseDetail | null> {
	const p = await db.purchase.findUnique({
		where: { id },
		include: { lines: { orderBy: { line_no: "asc" } } },
	});
	if (!p) return null;
	const productIds = [
		...new Set(p.lines.flatMap((l) => (l.product_id ? [l.product_id] : []))),
	];
	const images = await primaryImagePaths(db, productIds);
	return {
		purchase: {
			id: p.id,
			orderNumber: p.order_number,
			type: p.type,
			status: p.status,
			counted: p.counted,
			orderDate: ymd(p.order_date),
			supplierId: p.supplier_id,
			supplier: p.supplier_name,
			currency: p.currency,
			baseCurrency: p.base_currency,
			currencyRate: Number(p.currency_rate),
			total: round4(Number(p.total)),
			totalBase: round4(Number(p.total_base)),
			receivingStatus: p.receiving_status,
			invoiceStatus: p.invoice_status,
			syncedAt: p.synced_at.toISOString(),
		},
		lines: p.lines.map((l) => ({
			lineNo: l.line_no,
			productId: l.product_id,
			sku: l.sku,
			name: l.name,
			quantity: qty(l.quantity),
			unitPrice: money(l.unit_price)!,
			discountPct: Number(l.discount_pct),
			unitCostBase: money(l.unit_cost_base)!,
			totalBase: money(l.total_base)!,
			thumbUrl: (l.product_id && images.get(l.product_id)?.thumbUrl) || null,
		})),
	};
}
