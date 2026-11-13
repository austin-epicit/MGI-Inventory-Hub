import { Prisma } from "../../generated/prisma/client.js";
import type { Db } from "../db.js";
import {
	marginPct,
	rangeFrom,
	type MarginLine,
	type PriceRange,
} from "../products/priceHistory.js";
import { ymd } from "../products/queries.js";
import { round4 } from "../sync/money.js";
import { earliestNetSaleDate, netSaleLines } from "./netLines.js";
import { between, grossProfit, type Window } from "./shared.js";
import { fillPeriods, periodFor, periodStart, type Period } from "./periods.js";

export const OTHER = "Other";
export const UNCATEGORISED = "Uncategorised";
const TOP_CATEGORIES = 5;

export type TrendPoint = {
	start: string;
	label: string;
	sales: number;
	purchases: number;
	grossProfit: number;
	grossMarginPct: number | null;
	mix: Record<string, number>;
};

export type Trend = {
	period: Period;
	from: string;
	to: string;
	totals: {
		sales: number;
		purchases: number;
		grossProfit: number;
		grossMarginPct: number | null;
	};
	points: TrendPoint[];
	mixKeys: string[];
};

async function earliestOrder(db: Db): Promise<string | null> {
	const [r] = await db.$queryRaw<{ d: Date | null }[]>`
		SELECT LEAST(
			(${earliestNetSaleDate}),
			(SELECT MIN(order_date) FROM purchase WHERE counted)
		) AS d`;
	return ymd(r!.d);
}

export async function getTrend(db: Db, range: PriceRange, today: string): Promise<Trend> {
	const period = periodFor(range);
	let from = rangeFrom(range, today);
	if (from === null) {
		const first = await earliestOrder(db);
		from = first && first <= today ? first : today;
	}
	const w: Window = { from, to: today };

	// Counted orders only, net of counted credit notes; voided and draft ones never feed a chart.
	const [saleRows, purchaseRows] = await Promise.all([
		db.$queryRaw<
			{
				d: Date;
				cat: string | null;
				q: Prisma.Decimal;
				price: Prisma.Decimal;
				avg: Prisma.Decimal | null;
				total: Prisma.Decimal;
			}[]
		>`
			SELECT l.d, NULLIF(BTRIM(p.category), '') AS cat, l.qty AS q, l.unit_price AS price,
				l.avg_cost AS avg, l.total_base AS total
			FROM (${netSaleLines(w)}) l
			LEFT JOIN product p ON p.id = l.product_id`,
		db.$queryRaw<{ d: Date; total: Prisma.Decimal }[]>`
			SELECT p.order_date AS d, SUM(l.total_base) AS total
			FROM purchase_line l JOIN purchase p ON p.id = l.purchase_id
			WHERE p.counted AND ${between(Prisma.sql`p.order_date`, w)}
			GROUP BY p.order_date`,
	]);

	// Top categories by sales over the whole range; the rest fold into Other.
	const byCategory = new Map<string, number>();
	let hasUncategorised = false;
	for (const r of saleRows) {
		if (r.cat === null) hasUncategorised = true;
		else byCategory.set(r.cat, (byCategory.get(r.cat) ?? 0) + Number(r.total));
	}
	const ranked = [...byCategory.entries()].sort(
		(a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
	);
	const named = ranked.slice(0, TOP_CATEGORIES).map(([name]) => name);
	const namedSet = new Set(named);
	// A real category named "Other" or "Uncategorised" shares the synthetic bucket's key, so the Set
	// keeps keys unique and the amounts merge.
	const mixKeys = [
		...new Set([
			...named,
			...(ranked.length > TOP_CATEGORIES ? [OTHER] : []),
			...(hasUncategorised ? [UNCATEGORISED] : []),
		]),
	];

	type Bucket = {
		sales: number;
		purchases: number;
		lines: MarginLine[];
		mix: Map<string, number>;
	};
	const buckets = new Map<string, Bucket>();
	const bucket = (start: string): Bucket => {
		let b = buckets.get(start);
		if (!b) {
			b = { sales: 0, purchases: 0, lines: [], mix: new Map() };
			buckets.set(start, b);
		}
		return b;
	};
	const allLines: MarginLine[] = [];
	let sales = 0;
	let purchases = 0;
	for (const r of saleRows) {
		const b = bucket(periodStart(ymd(r.d)!, period));
		const total = Number(r.total);
		const line = {
			qty: Number(r.q),
			unitPrice: Number(r.price),
			averageCost: r.avg === null ? null : Number(r.avg),
		};
		b.sales += total;
		b.lines.push(line);
		allLines.push(line);
		sales += total;
		const key = r.cat === null ? UNCATEGORISED : namedSet.has(r.cat) ? r.cat : OTHER;
		b.mix.set(key, (b.mix.get(key) ?? 0) + total);
	}
	for (const r of purchaseRows) {
		const total = Number(r.total);
		bucket(periodStart(ymd(r.d)!, period)).purchases += total;
		purchases += total;
	}

	const points = fillPeriods(from, today, period).map(({ start, label }) => {
		const b = buckets.get(start);
		return {
			start,
			label,
			sales: round4(b?.sales ?? 0),
			purchases: round4(b?.purchases ?? 0),
			grossProfit: round4(grossProfit(b?.lines ?? [])),
			grossMarginPct: marginPct(b?.lines ?? []),
			mix: Object.fromEntries(
				mixKeys.map((k) => [k, round4(b?.mix.get(k) ?? 0)])
			),
		};
	});

	return {
		period,
		from,
		to: today,
		totals: {
			sales: round4(sales),
			purchases: round4(purchases),
			grossProfit: round4(grossProfit(allLines)),
			grossMarginPct: marginPct(allLines),
		},
		points,
		mixKeys,
	};
}
