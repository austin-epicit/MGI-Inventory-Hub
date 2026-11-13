import { Prisma } from "../../generated/prisma/client.js";
import type { Db } from "../db.js";
import { GRADE_LABELS, NOT_GRADED, type ConditionGrade } from "../products/condition.js";
import {
	marginPct,
	rangeFrom,
	type MarginLine,
	type PriceRange,
} from "../products/priceHistory.js";
import { round4 } from "../sync/money.js";
import { netSaleLines } from "./netLines.js";
import { between, grossProfit, type Window } from "./shared.js";

export const BREAKDOWN_DIMENSIONS = [
	"category",
	"brand",
	"grade",
	"customer",
	"tier",
	"supplier",
] as const;
export type BreakdownBy = (typeof BREAKDOWN_DIMENSIONS)[number];

const TOP_ROWS = 15;

export type BreakdownRow = {
	key: string | null;
	label: string;
	amount: number;
	grossProfit: number | null;
	marginPct: number | null;
	units: number;
	orders: number;
	products: number;
};

export type Breakdown = {
	by: BreakdownBy;
	kind: "sales" | "purchases";
	total: number;
	rows: BreakdownRow[];
	other: BreakdownRow | null;
};

type Raw = {
	order_id: string;
	product_id: string | null;
	party_id: string | null;
	party_name: string | null;
	cat: string | null;
	brand: string | null;
	grade: string | null;
	tier: string | null;
	q: Prisma.Decimal;
	price: Prisma.Decimal | null;
	avg: Prisma.Decimal | null;
	total: Prisma.Decimal;
	credit: boolean;
};

type Group = {
	key: string | null;
	label: string;
	amount: number;
	units: number;
	orders: Set<string>;
	products: Set<string>;
	lines: MarginLine[];
};

// Sales dimensions all hang off a sale line; the NULL-able dimension value becomes the fallback row.
const salesKey = (
	by: Exclude<BreakdownBy, "supplier">,
	r: Raw
): { key: string | null; label: string } => {
	switch (by) {
		case "category":
			return r.cat === null
				? { key: null, label: "Uncategorised" }
				: { key: r.cat, label: r.cat };
		case "brand":
			return r.brand === null
				? { key: null, label: "No brand" }
				: { key: r.brand, label: r.brand };
		case "grade":
			return r.grade === null
				? { key: null, label: NOT_GRADED }
				: { key: r.grade, label: GRADE_LABELS[r.grade as ConditionGrade] };
		case "tier":
			return r.tier === null
				? { key: null, label: "No tier" }
				: { key: r.tier, label: r.tier };
		case "customer":
			return { key: r.party_id, label: r.party_name ?? "" };
	}
};

const toRow = (g: Group, sales: boolean): BreakdownRow => {
	const costed = g.lines.some((l) => l.averageCost !== null);
	return {
		key: g.key,
		label: g.label,
		amount: round4(g.amount),
		grossProfit: sales && costed ? round4(grossProfit(g.lines)) : null,
		marginPct: sales ? marginPct(g.lines) : null,
		units: round4(g.units),
		orders: g.orders.size,
		products: g.products.size,
	};
};

export async function getBreakdown(
	db: Db,
	range: PriceRange,
	by: BreakdownBy,
	today: string
): Promise<Breakdown> {
	// `all` has no lower bound, so it spans the same orders trend's earliest-order start does.
	const w: Window = { from: rangeFrom(range, today) ?? "0001-01-01", to: today };
	const sales = by !== "supplier";

	// Counted orders only, net of counted credit notes; voided and draft ones never feed a chart.
	const raw = sales
		? await db.$queryRaw<Raw[]>`
			SELECT l.sale_id::text AS order_id, l.product_id::text AS product_id,
				l.customer_id::text AS party_id, l.customer_name AS party_name,
				NULLIF(BTRIM(p.category), '') AS cat, NULLIF(BTRIM(p.brand), '') AS brand,
				pc.grade::text AS grade, l.tier, l.qty AS q, l.unit_price AS price, l.avg_cost AS avg,
				l.total_base AS total, l.credit
			FROM (${netSaleLines(w)}) l
			LEFT JOIN product p ON p.id = l.product_id
			LEFT JOIN product_condition pc ON pc.product_id = l.product_id`
		: await db.$queryRaw<Raw[]>`
			SELECT o.id::text AS order_id, l.product_id::text AS product_id,
				o.supplier_id::text AS party_id, o.supplier_name AS party_name,
				NULL AS cat, NULL AS brand, NULL AS grade, NULL AS tier, l.quantity AS q,
				NULL::numeric AS price, NULL::numeric AS avg, l.total_base AS total,
				false AS credit
			FROM purchase_line l
			JOIN purchase o ON o.id = l.purchase_id
			WHERE o.counted AND ${between(Prisma.sql`o.order_date`, w)}`;

	const groups = new Map<string, Group>();
	let total = 0;
	for (const r of raw) {
		const { key, label } = sales
			? salesKey(by as Exclude<BreakdownBy, "supplier">, r)
			: { key: r.party_id, label: r.party_name ?? "" };
		// A party without an id is still one row per stored name; the null key is only the API's.
		const gid = key ?? `\0${label}`;
		let g = groups.get(gid);
		if (!g) {
			g = {
				key,
				label,
				amount: 0,
				units: 0,
				orders: new Set(),
				products: new Set(),
				lines: [],
			};
			groups.set(gid, g);
		}
		const amount = Number(r.total);
		g.amount += amount;
		total += amount;
		g.units += Number(r.q);
		if (!r.credit) {
			g.orders.add(r.order_id);
			if (r.product_id) g.products.add(r.product_id);
		}
		if (sales)
			g.lines.push({
				qty: Number(r.q),
				unitPrice: Number(r.price),
				averageCost: r.avg === null ? null : Number(r.avg),
			});
	}

	const ranked = [...groups.values()].sort(
		(a, b) => round4(b.amount) - round4(a.amount) || a.label.localeCompare(b.label)
	);
	const rest = ranked.slice(TOP_ROWS);
	let other: BreakdownRow | null = null;
	if (rest.length > 0)
		other = toRow(
			{
				key: null,
				label: `Other (${rest.length})`,
				amount: rest.reduce((s, g) => s + g.amount, 0),
				units: rest.reduce((s, g) => s + g.units, 0),
				orders: new Set(rest.flatMap((g) => [...g.orders])),
				products: new Set(rest.flatMap((g) => [...g.products])),
				lines: rest.flatMap((g) => g.lines),
			},
			sales
		);

	return {
		by,
		kind: sales ? "sales" : "purchases",
		total: round4(total),
		rows: ranked.slice(0, TOP_ROWS).map((g) => toRow(g, sales)),
		other,
	};
}
