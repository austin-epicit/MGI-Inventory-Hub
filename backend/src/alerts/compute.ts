import type { Prisma } from "../../generated/prisma/client.js";
import type { Db } from "../db.js";
import { primaryImagePaths } from "../images/store.js";
import { ymd } from "../products/queries.js";
import { round4 } from "../sync/money.js";
import { getThresholds, type AlertThresholds } from "./thresholds.js";

export type CostAlert = {
	key: string;
	dismissed: boolean;
	productId: string;
	sku: string;
	name: string;
	thumbUrl: string | null;
	previousCost: number;
	latestCost: number;
	changePct: number;
	latestDate: string;
	purchaseId: string;
	orderNumber: string;
	supplierName: string;
};

export type SlowAlert = {
	key: string;
	dismissed: boolean;
	productId: string;
	sku: string;
	name: string;
	thumbUrl: string | null;
	onHand: number;
	value: number;
	lastSold: string | null;
	daysSinceSale: number | null;
};

export type AlertsPayload = {
	costChanges: CostAlert[];
	slowMovers: SlowAlert[];
	thresholds: AlertThresholds;
	openCount: number;
};

export const ALERT_KEY_RE =
	/^(cost:[0-9a-f-]{36}:[0-9a-f-]{36}:\d+|slow:[0-9a-f-]{36}:(\d{4}-\d{2}-\d{2}|never))$/;

type CostRow = {
	product_id: string;
	sku: string;
	name: string;
	purchase_id: string;
	line_no: number;
	order_number: string;
	supplier_name: string;
	order_date: Date;
	latest_cost: Prisma.Decimal;
	previous_cost: Prisma.Decimal;
	change_pct: Prisma.Decimal;
};

type SlowRow = {
	product_id: string;
	sku: string;
	name: string;
	on_hand: Prisma.Decimal;
	value: Prisma.Decimal;
	last_sold: Date | null;
	days_since_sale: number | null;
};

// Latest vs previous counted purchase line per product, same ordering as the product's "last
// purchase". A zero previous cost is skipped (no meaningful percentage).
const costRows = (db: Db, today: string, t: AlertThresholds) =>
	db.$queryRaw<CostRow[]>`
		WITH ranked AS (
			SELECT l.product_id, l.purchase_id, l.line_no, l.unit_cost_base,
				o.order_date, o.order_number, o.supplier_name,
				row_number() OVER (
					PARTITION BY l.product_id
					ORDER BY o.order_date DESC, o.order_number DESC, l.line_no DESC
				) AS rn
			FROM purchase_line l JOIN purchase o ON o.id = l.purchase_id
			WHERE o.counted AND l.product_id IS NOT NULL AND o.order_date IS NOT NULL
		)
		SELECT p.id::text AS product_id, p.sku, p.name, a.purchase_id::text AS purchase_id,
			a.line_no, a.order_number, a.supplier_name, a.order_date,
			a.unit_cost_base AS latest_cost, b.unit_cost_base AS previous_cost,
			round((a.unit_cost_base / NULLIF(b.unit_cost_base, 0) - 1) * 100, 1) AS change_pct
		FROM ranked a
		JOIN ranked b ON b.product_id = a.product_id AND b.rn = 2
		JOIN product p ON p.id = a.product_id
		WHERE a.rn = 1 AND b.unit_cost_base > 0
			AND a.order_date >= ${today}::date - ${t.costChangeDays}::int
			AND abs(a.unit_cost_base / NULLIF(b.unit_cost_base, 0) - 1) >= ${t.costChangePct}::numeric / 100`;

// Same "held, no counted sale in N days" rule as Insights' slow movers, plus a minimum value.
const slowRows = (db: Db, today: string, t: AlertThresholds) =>
	db.$queryRaw<SlowRow[]>`
		SELECT p.id::text AS product_id, p.sku, p.name, st.on_hand,
			st.on_hand * p.average_cost AS value, ls.last_sold,
			(${today}::date - ls.last_sold)::int AS days_since_sale
		FROM product p
		JOIN (
			SELECT product_id, SUM(on_hand) AS on_hand FROM stock_level
			GROUP BY product_id HAVING SUM(on_hand) > 0
		) st ON st.product_id = p.id
		LEFT JOIN LATERAL (
			SELECT MAX(s.order_date) AS last_sold FROM sale_line l
			JOIN sale s ON s.id = l.sale_id
			WHERE l.product_id = p.id AND s.counted
		) ls ON true
		WHERE st.on_hand * p.average_cost >= ${t.slowMoverMinValue}::numeric
			AND NOT EXISTS (
				SELECT 1 FROM sale_line l JOIN sale s ON s.id = l.sale_id
				WHERE l.product_id = p.id AND s.counted
					AND s.order_date >= ${today}::date - ${t.slowMoverDays}::int
			)`;

export async function getAlerts(db: Db, userId: string, today: string): Promise<AlertsPayload> {
	const thresholds = await getThresholds(db);
	const [costs, slows] = await Promise.all([
		costRows(db, today, thresholds),
		slowRows(db, today, thresholds),
	]);

	const costKey = (r: CostRow) => `cost:${r.product_id}:${r.purchase_id}:${r.line_no}`;
	const slowKey = (r: SlowRow) => `slow:${r.product_id}:${ymd(r.last_sold) ?? "never"}`;
	const keys = [...costs.map(costKey), ...slows.map(slowKey)];
	const [dismissals, images] = await Promise.all([
		db.alert_dismissal.findMany({
			where: { user_id: userId, alert_key: { in: keys } },
			select: { alert_key: true },
		}),
		primaryImagePaths(db, [...new Set([...costs, ...slows].map((r) => r.product_id))]),
	]);
	const dismissed = new Set(dismissals.map((d) => d.alert_key));

	const costChanges: CostAlert[] = costs
		.map((r) => ({
			key: costKey(r),
			dismissed: dismissed.has(costKey(r)),
			productId: r.product_id,
			sku: r.sku,
			name: r.name,
			thumbUrl: images.get(r.product_id)?.thumbUrl ?? null,
			previousCost: round4(Number(r.previous_cost)),
			latestCost: round4(Number(r.latest_cost)),
			changePct: Number(r.change_pct),
			latestDate: ymd(r.order_date)!,
			purchaseId: r.purchase_id,
			orderNumber: r.order_number,
			supplierName: r.supplier_name,
		}))
		.sort(
			(a, b) =>
				Math.abs(b.changePct) - Math.abs(a.changePct) ||
				a.name.localeCompare(b.name) ||
				a.key.localeCompare(b.key)
		);

	const slowMovers: SlowAlert[] = slows
		.map((r) => ({
			key: slowKey(r),
			dismissed: dismissed.has(slowKey(r)),
			productId: r.product_id,
			sku: r.sku,
			name: r.name,
			thumbUrl: images.get(r.product_id)?.thumbUrl ?? null,
			onHand: round4(Number(r.on_hand)),
			value: round4(Number(r.value)),
			lastSold: ymd(r.last_sold),
			daysSinceSale: r.days_since_sale,
		}))
		.sort(
			(a, b) =>
				b.value - a.value ||
				a.name.localeCompare(b.name) ||
				a.key.localeCompare(b.key)
		);

	const open = (xs: { dismissed: boolean }[]) => xs.filter((x) => !x.dismissed).length;
	return {
		costChanges,
		slowMovers,
		thresholds,
		openCount: open(costChanges) + open(slowMovers),
	};
}
