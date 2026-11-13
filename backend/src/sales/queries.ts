import { Prisma } from "../../generated/prisma/client.js";
import type { Db } from "../db.js";
import { primaryImagePaths } from "../images/store.js";
import { marginPct } from "../products/priceHistory.js";
import { escapeLike, money, qty, ymd } from "../products/queries.js";
import { round4 } from "../sync/money.js";

export const SALE_SORTS = ["orderDate", "orderNumber", "customer", "status", "totalBase"] as const;
export type SaleSort = (typeof SALE_SORTS)[number];

export type SaleQuery = {
	search?: string;
	status?: string;
	customerId?: string;
	tier?: string;
	from?: string;
	to?: string;
	sort: SaleSort;
	dir: "asc" | "desc";
	page: number;
	limit: number;
};

export type SaleListRow = {
	id: string;
	orderNumber: string;
	orderDate: string | null;
	customerId: string | null;
	customer: string;
	priceTierName: string | null;
	status: string;
	counted: boolean;
	currency: string;
	baseCurrency: string;
	total: number;
	totalBase: number;
	lineCount: number;
	invoiceStatus: string | null;
};

// Column per sort key; never interpolated from the request.
const SORT_SQL: Record<SaleSort, Prisma.Sql> = {
	orderDate: Prisma.sql`s.order_date`,
	orderNumber: Prisma.sql`lower(s.order_number)`,
	customer: Prisma.sql`lower(s.customer_name)`,
	status: Prisma.sql`s.status`,
	totalBase: Prisma.sql`s.total_base`,
};

type Raw = {
	id: string;
	order_number: string;
	order_date: Date | null;
	customer_id: string | null;
	customer_name: string;
	price_tier_name: string | null;
	status: string;
	counted: boolean;
	currency: string;
	base_currency: string;
	total: Prisma.Decimal;
	total_base: Prisma.Decimal;
	line_count: bigint;
	invoice_status: string | null;
};

// Voided and draft orders are listed with their status; only charts and KPIs skip uncounted rows.
export async function listSales(
	db: Db,
	q: SaleQuery
): Promise<{ rows: SaleListRow[]; total: number }> {
	const where: Prisma.Sql[] = [];
	if (q.search) {
		const like = `%${escapeLike(q.search)}%`;
		where.push(
			Prisma.sql`(s.order_number ILIKE ${like} OR s.customer_name ILIKE ${like})`
		);
	}
	if (q.status) where.push(Prisma.sql`s.status = ${q.status}`);
	if (q.customerId) where.push(Prisma.sql`s.customer_id = ${q.customerId}::uuid`);
	if (q.tier) where.push(Prisma.sql`BTRIM(s.price_tier_name) = BTRIM(${q.tier})`);
	if (q.from) where.push(Prisma.sql`s.order_date >= ${q.from}::date`);
	if (q.to) where.push(Prisma.sql`s.order_date <= ${q.to}::date`);
	const whereSql = where.length
		? Prisma.sql`WHERE ${Prisma.join(where, " AND ")}`
		: Prisma.empty;
	const dir = q.dir === "desc" ? Prisma.sql`DESC` : Prisma.sql`ASC`;

	const rows = await db.$queryRaw<Raw[]>`
		SELECT s.id, s.order_number, s.order_date, s.customer_id, s.customer_name,
			s.price_tier_name, s.status, s.counted, s.currency, s.base_currency, s.total,
			s.total_base, s.invoice_status,
			(SELECT COUNT(*) FROM sale_line sl WHERE sl.sale_id = s.id) AS line_count
		FROM sale s
		${whereSql}
		ORDER BY ${SORT_SQL[q.sort]} ${dir} NULLS LAST, s.order_number DESC, s.id
		LIMIT ${q.limit} OFFSET ${(q.page - 1) * q.limit}`;
	const [{ n }] = await db.$queryRaw<{ n: bigint }[]>`
		SELECT COUNT(*) AS n FROM sale s ${whereSql}`;

	return {
		total: Number(n),
		rows: rows.map((r) => ({
			id: r.id,
			orderNumber: r.order_number,
			orderDate: ymd(r.order_date),
			customerId: r.customer_id,
			customer: r.customer_name,
			priceTierName: r.price_tier_name,
			status: r.status,
			counted: r.counted,
			currency: r.currency,
			baseCurrency: r.base_currency,
			total: round4(Number(r.total)),
			totalBase: round4(Number(r.total_base)),
			lineCount: Number(r.line_count),
			invoiceStatus: r.invoice_status,
		})),
	};
}

export async function saleFacets(db: Db): Promise<{
	statuses: string[];
	customers: { id: string; name: string }[];
	tiers: string[];
}> {
	const [statuses, customers, tiers] = await Promise.all([
		db.sale.findMany({ distinct: ["status"], select: { status: true } }),
		db.sale.findMany({
			where: { customer_id: { not: null } },
			distinct: ["customer_id"],
			select: { customer_id: true, customer_name: true },
		}),
		db.sale.findMany({
			where: { price_tier_name: { not: null } },
			distinct: ["price_tier_name"],
			select: { price_tier_name: true },
		}),
	]);
	const byText = (a: string, b: string) => a.localeCompare(b);
	return {
		statuses: statuses.map((s) => s.status).sort(byText),
		customers: customers
			.map((c) => ({ id: c.customer_id!, name: c.customer_name }))
			.sort((a, b) => byText(a.name, b.name)),
		// Trimmed to match the tier filter, so a padded value is not listed twice.
		tiers: [
			...new Set(tiers.map((t) => t.price_tier_name!.trim()).filter(Boolean)),
		].sort(byText),
	};
}

export type SaleLine = {
	lineNo: number;
	productId: string | null;
	sku: string;
	name: string;
	quantity: number;
	unitPrice: number;
	discountPct: number;
	unitPriceBase: number;
	averageCost: number | null;
	marginPct: number | null;
	totalBase: number;
	thumbUrl: string | null;
};

export type SaleCreditNote = {
	id: string;
	number: string | null;
	date: string | null;
	status: string;
	counted: boolean;
	totalBase: number;
	lines: {
		sku: string;
		name: string;
		quantity: number;
		unitPriceBase: number;
		totalBase: number;
	}[];
};

export type SaleDetail = {
	sale: {
		id: string;
		orderNumber: string;
		type: string;
		status: string;
		counted: boolean;
		orderDate: string | null;
		invoiceDate: string | null;
		customerId: string | null;
		customer: string;
		priceTierName: string | null;
		currency: string;
		baseCurrency: string;
		currencyRate: number;
		total: number;
		totalBase: number;
		cogsBase: number | null;
		marginPct: number | null;
		invoiceStatus: string | null;
		syncedAt: string;
	};
	lines: SaleLine[];
	creditNotes: SaleCreditNote[];
};

export async function getSaleDetail(db: Db, id: string): Promise<SaleDetail | null> {
	const s = await db.sale.findUnique({
		where: { id },
		include: { lines: { orderBy: { line_no: "asc" } } },
	});
	if (!s) return null;
	const notes = await db.sale_credit_note.findMany({
		where: { sale_id: id },
		orderBy: [{ credit_date: "asc" }, { number: "asc" }, { id: "asc" }],
		include: { lines: { orderBy: { line_no: "asc" } } },
	});
	const productIds = [
		...new Set(s.lines.flatMap((l) => (l.product_id ? [l.product_id] : []))),
	];
	const images = await primaryImagePaths(db, productIds);
	const marginLine = (l: (typeof s.lines)[number]) => ({
		qty: Number(l.quantity),
		unitPrice: Number(l.unit_price_base),
		averageCost: l.average_cost === null ? null : Number(l.average_cost),
	});
	return {
		sale: {
			id: s.id,
			orderNumber: s.order_number,
			type: s.type,
			status: s.status,
			counted: s.counted,
			orderDate: ymd(s.order_date),
			invoiceDate: ymd(s.invoice_date),
			customerId: s.customer_id,
			customer: s.customer_name,
			priceTierName: s.price_tier_name,
			currency: s.currency,
			baseCurrency: s.base_currency,
			currencyRate: Number(s.currency_rate),
			total: round4(Number(s.total)),
			totalBase: round4(Number(s.total_base)),
			cogsBase: money(s.cogs_base),
			marginPct: marginPct(s.lines.map(marginLine)),
			invoiceStatus: s.invoice_status,
			syncedAt: s.synced_at.toISOString(),
		},
		lines: s.lines.map((l) => ({
			lineNo: l.line_no,
			productId: l.product_id,
			sku: l.sku,
			name: l.name,
			quantity: qty(l.quantity),
			unitPrice: money(l.unit_price)!,
			discountPct: Number(l.discount_pct),
			unitPriceBase: money(l.unit_price_base)!,
			averageCost: money(l.average_cost),
			marginPct: marginPct([marginLine(l)]),
			totalBase: money(l.total_base)!,
			thumbUrl: (l.product_id && images.get(l.product_id)?.thumbUrl) || null,
		})),
		creditNotes: notes.map((n) => ({
			id: n.id,
			number: n.number,
			date: ymd(n.credit_date),
			status: n.status,
			counted: n.counted,
			totalBase: money(n.total_base)!,
			lines: n.lines.map((l) => ({
				sku: l.sku,
				name: l.name,
				quantity: qty(l.quantity),
				unitPriceBase: money(l.unit_price_base)!,
				totalBase: money(l.total_base)!,
			})),
		})),
	};
}
