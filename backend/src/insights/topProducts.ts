import { Prisma } from "../../generated/prisma/client.js";
import type { Db } from "../db.js";
import { primaryImagePaths } from "../images/store.js";
import {
	marginPct,
	rangeFrom,
	type MarginLine,
	type PriceRange,
} from "../products/priceHistory.js";
import { round4 } from "../sync/money.js";
import { between, grossProfit, type Window } from "./shared.js";

export const TOP_PRODUCT_SORTS = ["sales", "profit", "units"] as const;
export type TopProductSort = (typeof TOP_PRODUCT_SORTS)[number];

const TOP_ROWS = 10;

export type TopProductRow = {
	productId: string;
	name: string;
	sku: string;
	thumbUrl: string | null;
	sales: number;
	grossProfit: number | null;
	marginPct: number | null;
	units: number;
	onHand: number;
};

type Raw = {
	product_id: string;
	name: string;
	sku: string;
	q: Prisma.Decimal;
	price: Prisma.Decimal;
	avg: Prisma.Decimal | null;
	total: Prisma.Decimal;
};

type Group = {
	productId: string;
	name: string;
	sku: string;
	sales: number;
	units: number;
	lines: MarginLine[];
};

export async function getTopProducts(
	db: Db,
	range: PriceRange,
	sort: TopProductSort,
	today: string
): Promise<{ rows: TopProductRow[] }> {
	const w: Window = { from: rangeFrom(range, today) ?? "0001-01-01", to: today };

	// Product-linked lines of counted sales only; unlinked lines have no product to rank.
	const raw = await db.$queryRaw<Raw[]>`
		SELECT p.id::text AS product_id, p.name, p.sku, l.quantity AS q,
			l.unit_price_base AS price, l.average_cost AS avg, l.total_base AS total
		FROM sale_line l
		JOIN sale s ON s.id = l.sale_id
		JOIN product p ON p.id = l.product_id
		WHERE s.counted AND ${between(Prisma.sql`s.order_date`, w)}`;

	const groups = new Map<string, Group>();
	for (const r of raw) {
		const g = groups.get(r.product_id) ?? {
			productId: r.product_id,
			name: r.name,
			sku: r.sku,
			sales: 0,
			units: 0,
			lines: [],
		};
		g.sales += Number(r.total);
		g.units += Number(r.q);
		g.lines.push({
			qty: Number(r.q),
			unitPrice: Number(r.price),
			averageCost: r.avg === null ? null : Number(r.avg),
		});
		groups.set(r.product_id, g);
	}

	const scored = [...groups.values()].map((g) => ({
		g,
		profit: g.lines.some((l) => l.averageCost !== null)
			? round4(grossProfit(g.lines))
			: null,
	}));
	const key = (s: (typeof scored)[number]): number =>
		sort === "profit"
			? s.profit!
			: sort === "units"
				? round4(s.g.units)
				: round4(s.g.sales);
	const top = scored
		.filter((s) => sort !== "profit" || s.profit !== null)
		.sort((a, b) => key(b) - key(a) || a.g.name.localeCompare(b.g.name))
		.slice(0, TOP_ROWS);
	if (top.length === 0) return { rows: [] };

	const ids = top.map((s) => s.g.productId);
	const [stock, images] = await Promise.all([
		db.stock_level.groupBy({
			by: ["product_id"],
			where: { product_id: { in: ids } },
			_sum: { on_hand: true },
		}),
		primaryImagePaths(db, ids),
	]);
	const onHand = new Map(stock.map((s) => [s.product_id, Number(s._sum.on_hand ?? 0)]));

	return {
		rows: top.map(({ g, profit }) => ({
			productId: g.productId,
			name: g.name,
			sku: g.sku,
			thumbUrl: images.get(g.productId)?.thumbUrl ?? null,
			sales: round4(g.sales),
			grossProfit: profit,
			marginPct: marginPct(g.lines),
			units: round4(g.units),
			onHand: round4(onHand.get(g.productId) ?? 0),
		})),
	};
}
