import { Prisma } from "../../generated/prisma/client.js";
import type { Db } from "../db.js";
import { primaryImagePaths } from "../images/store.js";
import { marginPct } from "../products/priceHistory.js";
import { money, ymd } from "../products/queries.js";
import { addDays, ymdToDbDate } from "../sync/dates.js";
import { round4 } from "../sync/money.js";
import { currentStockValue } from "../sync/snapshots.js";

export const MOVER_WINDOW_DAYS = 180;
const MOVERS_SHOWN = 10;
const RECENT_SHOWN = 5;

export type OverviewKpis = {
	stockValue: number;
	unitsOnHand: number;
	sales: number;
	purchases: number;
	grossMarginPct: number | null;
};

export type CostMover = {
	productId: string;
	name: string;
	sku: string;
	thumbUrl: string | null;
	lastCost: number;
	priorAvgCost: number;
	changePct: number;
};

export type RecentOrder = {
	id: string;
	orderNumber: string;
	orderDate: string | null;
	// Supplier on a purchase, customer on a sale.
	party: string;
	status: string;
	totalBase: number;
};

export type Overview = {
	kpis: OverviewKpis;
	costMovers: CostMover[];
	recentPurchases: RecentOrder[];
	recentSales: RecentOrder[];
	lastSyncAt: string | null;
};

// "PO-9" before "PO-10"; the caller adds a stable final key.
const numericCompare = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true });

type Window = { from: string | null; to: string };

const dateBounds = (col: Prisma.Sql, w: Window): Prisma.Sql =>
	w.from
		? Prisma.sql`${col} >= ${w.from}::date AND ${col} <= ${w.to}::date`
		: Prisma.sql`${col} IS NOT NULL AND ${col} <= ${w.to}::date`;

async function stockKpis(db: Db): Promise<Pick<OverviewKpis, "stockValue" | "unitsOnHand">> {
	const { value, units } = await currentStockValue(db);
	return { stockValue: value, unitsOnHand: units };
}

// Counted orders only: voided and draft ones never feed a KPI.
async function flowKpis(
	db: Db,
	w: Window
): Promise<Pick<OverviewKpis, "sales" | "purchases" | "grossMarginPct">> {
	const [[sales], [purchases], saleLines] = await Promise.all([
		db.$queryRaw<{ total: Prisma.Decimal }[]>`
			SELECT COALESCE(SUM(l.total_base), 0) AS total
			FROM sale_line l JOIN sale s ON s.id = l.sale_id
			WHERE s.counted AND ${dateBounds(Prisma.sql`s.order_date`, w)}`,
		db.$queryRaw<{ total: Prisma.Decimal }[]>`
			SELECT COALESCE(SUM(l.total_base), 0) AS total
			FROM purchase_line l JOIN purchase p ON p.id = l.purchase_id
			WHERE p.counted AND ${dateBounds(Prisma.sql`p.order_date`, w)}`,
		db.$queryRaw<
			{ q: Prisma.Decimal; price: Prisma.Decimal; avg: Prisma.Decimal | null }[]
		>`
			SELECT l.quantity AS q, l.unit_price_base AS price, l.average_cost AS avg
			FROM sale_line l JOIN sale s ON s.id = l.sale_id
			WHERE s.counted AND ${dateBounds(Prisma.sql`s.order_date`, w)}`,
	]);
	return {
		sales: round4(Number(sales!.total)),
		purchases: round4(Number(purchases!.total)),
		grossMarginPct: marginPct(
			saleLines.map((l) => ({
				qty: Number(l.q),
				unitPrice: Number(l.price),
				averageCost: l.avg === null ? null : Number(l.avg),
			}))
		),
	};
}

// Latest purchase's cost against the mean of the earlier purchases' costs; a purchase's cost is the
// quantity-weighted unit cost of its lines for that product.
async function costMovers(db: Db, today: string): Promise<CostMover[]> {
	const from = ymdToDbDate(addDays(today, -MOVER_WINDOW_DAYS));
	const lines = await db.purchase_line.findMany({
		where: {
			product_id: { not: null },
			purchase: {
				counted: true,
				order_date: { gte: from, lte: ymdToDbDate(today) },
			},
		},
		select: {
			product_id: true,
			purchase_id: true,
			quantity: true,
			unit_cost_base: true,
			purchase: { select: { order_date: true, order_number: true } },
		},
	});

	type Purchase = { id: string; date: string; number: string; qty: number; cost: number };
	const byProduct = new Map<string, Map<string, Purchase>>();
	for (const l of lines) {
		const perPurchase = byProduct.get(l.product_id!) ?? new Map<string, Purchase>();
		const p = perPurchase.get(l.purchase_id) ?? {
			id: l.purchase_id,
			date: ymd(l.purchase.order_date)!,
			number: l.purchase.order_number,
			qty: 0,
			cost: 0,
		};
		const q = Number(l.quantity);
		p.qty += q;
		p.cost += q * Number(l.unit_cost_base);
		perPurchase.set(l.purchase_id, p);
		byProduct.set(l.product_id!, perPurchase);
	}

	const moves: Omit<CostMover, "name" | "sku" | "thumbUrl">[] = [];
	for (const [productId, perPurchase] of byProduct) {
		if (perPurchase.size < 2) continue;
		const unit = (p: Purchase) => (p.qty > 0 ? p.cost / p.qty : 0);
		const ordered = [...perPurchase.values()].sort(
			(a, b) =>
				a.date.localeCompare(b.date) ||
				numericCompare(a.number, b.number) ||
				a.id.localeCompare(b.id)
		);
		const last = ordered.pop()!;
		const prior = ordered.reduce((s, p) => s + unit(p), 0) / ordered.length;
		if (prior <= 0) continue; // no base to measure a change against
		const lastCost = unit(last);
		moves.push({
			productId,
			lastCost: round4(lastCost),
			priorAvgCost: round4(prior),
			changePct: Math.round(((lastCost - prior) / prior) * 10_000) / 100,
		});
	}
	const top = moves
		.sort(
			(a, b) =>
				Math.abs(b.changePct) - Math.abs(a.changePct) ||
				a.productId.localeCompare(b.productId)
		)
		.slice(0, MOVERS_SHOWN);
	if (top.length === 0) return [];

	const ids = top.map((m) => m.productId);
	const [products, images] = await Promise.all([
		db.product.findMany({
			where: { id: { in: ids } },
			select: { id: true, name: true, sku: true },
		}),
		primaryImagePaths(db, ids),
	]);
	const info = new Map(products.map((p) => [p.id, p]));
	return top.flatMap((m) => {
		const p = info.get(m.productId);
		return p
			? [
					{
						...m,
						name: p.name,
						sku: p.sku,
						thumbUrl: images.get(m.productId)?.thumbUrl ?? null,
					},
				]
			: [];
	});
}

async function recentPurchases(db: Db): Promise<RecentOrder[]> {
	const rows = await db.purchase.findMany({
		where: { counted: true },
		orderBy: [
			{ order_date: { sort: "desc", nulls: "last" } },
			{ order_number: "desc" },
		],
		take: RECENT_SHOWN,
	});
	return rows.map((r) => ({
		id: r.id,
		orderNumber: r.order_number,
		orderDate: ymd(r.order_date),
		party: r.supplier_name,
		status: r.status,
		totalBase: money(r.total_base)!,
	}));
}

async function recentSales(db: Db): Promise<RecentOrder[]> {
	const rows = await db.sale.findMany({
		where: { counted: true },
		orderBy: [
			{ order_date: { sort: "desc", nulls: "last" } },
			{ order_number: "desc" },
		],
		take: RECENT_SHOWN,
	});
	return rows.map((r) => ({
		id: r.id,
		orderNumber: r.order_number,
		orderDate: ymd(r.order_date),
		party: r.customer_name,
		status: r.status,
		totalBase: money(r.total_base)!,
	}));
}

export async function getOverview(db: Db, w: Window): Promise<Overview> {
	const [stock, flow, movers, purchases, sales, lastOk] = await Promise.all([
		stockKpis(db),
		flowKpis(db, w),
		costMovers(db, w.to),
		recentPurchases(db),
		recentSales(db),
		// Same source as the sync status the header freshness chip reads.
		db.sync_run.findFirst({
			where: { status: "ok" },
			orderBy: { started_at: "desc" },
			select: { finished_at: true },
		}),
	]);
	return {
		kpis: { ...stock, ...flow },
		costMovers: movers,
		recentPurchases: purchases,
		recentSales: sales,
		lastSyncAt: lastOk?.finished_at?.toISOString() ?? null,
	};
}
