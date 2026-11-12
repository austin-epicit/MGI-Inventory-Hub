import { Prisma } from "../../generated/prisma/client.js";
import type { Db } from "../db.js";
import { primaryImagePaths } from "../images/store.js";
import { ymd } from "../products/queries.js";
import { round4 } from "../sync/money.js";

export const SLOW_MOVER_DAYS = 90;
export const AGE_BUCKETS = ["0-30", "31-90", "91-180", "181-365", "365+", "none"] as const;
export type AgeBucket = (typeof AGE_BUCKETS)[number];

const HISTORY_DAYS = 180;
const SLOW_MOVERS_SHOWN = 10;

export type StockHealth = {
	valueHistory: { day: string; value: number; units: number }[];
	trackingSince: string | null;
	age: { bucket: AgeBucket; value: number; units: number; products: number }[];
	slowMovers: {
		productId: string;
		name: string;
		sku: string;
		thumbUrl: string | null;
		onHand: number;
		value: number;
		lastSold: string | null;
	}[];
};

const bucketFor = (days: number | null): AgeBucket =>
	days === null
		? "none"
		: days <= 30
			? "0-30"
			: days <= 90
				? "31-90"
				: days <= 180
					? "91-180"
					: days <= 365
						? "181-365"
						: "365+";

type Held = {
	product_id: string;
	name: string;
	sku: string;
	on_hand: Prisma.Decimal;
	value: Prisma.Decimal;
	age_days: number | null;
	last_sold: Date | null;
	recent_sale: boolean;
};

export async function getStockHealth(db: Db, today: string): Promise<StockHealth> {
	const [history, first, held] = await Promise.all([
		db.stock_value_snapshot.findMany({ orderBy: { day: "desc" }, take: HISTORY_DAYS }),
		db.stock_value_snapshot.findFirst({
			orderBy: { day: "asc" },
			select: { day: true },
		}),
		// Products with stock on hand; purchase/sale dates come from counted orders only.
		db.$queryRaw<Held[]>`
			SELECT p.id::text AS product_id, p.name, p.sku, st.on_hand,
				st.on_hand * p.average_cost AS value,
				(${today}::date - (
					SELECT MAX(o.order_date) FROM purchase_line l
					JOIN purchase o ON o.id = l.purchase_id
					WHERE l.product_id = p.id AND o.counted
				))::int AS age_days,
				(
					SELECT MAX(s.order_date) FROM sale_line l
					JOIN sale s ON s.id = l.sale_id
					WHERE l.product_id = p.id AND s.counted
				) AS last_sold,
				EXISTS (
					SELECT 1 FROM sale_line l JOIN sale s ON s.id = l.sale_id
					WHERE l.product_id = p.id AND s.counted
						AND s.order_date >= ${today}::date - ${SLOW_MOVER_DAYS}::int
				) AS recent_sale
			FROM product p
			JOIN (
				SELECT product_id, SUM(on_hand) AS on_hand FROM stock_level
				GROUP BY product_id HAVING SUM(on_hand) > 0
			) st ON st.product_id = p.id`,
	]);

	const age = AGE_BUCKETS.map((bucket) => ({ bucket, value: 0, units: 0, products: 0 }));
	for (const h of held) {
		const a = age[AGE_BUCKETS.indexOf(bucketFor(h.age_days))]!;
		a.value += Number(h.value);
		a.units += Number(h.on_hand);
		a.products += 1;
	}

	const movers = held
		.filter((h) => !h.recent_sale)
		.sort((a, b) => Number(b.value) - Number(a.value) || a.name.localeCompare(b.name))
		.slice(0, SLOW_MOVERS_SHOWN);
	const images = await primaryImagePaths(
		db,
		movers.map((m) => m.product_id)
	);

	return {
		valueHistory: history.reverse().map((r) => ({
			day: ymd(r.day)!,
			value: round4(Number(r.value)),
			units: round4(Number(r.units)),
		})),
		trackingSince: first ? ymd(first.day) : null,
		age: age.map((a) => ({ ...a, value: round4(a.value), units: round4(a.units) })),
		slowMovers: movers.map((m) => ({
			productId: m.product_id,
			name: m.name,
			sku: m.sku,
			thumbUrl: images.get(m.product_id)?.thumbUrl ?? null,
			onHand: round4(Number(m.on_hand)),
			value: round4(Number(m.value)),
			lastSold: ymd(m.last_sold),
		})),
	};
}
