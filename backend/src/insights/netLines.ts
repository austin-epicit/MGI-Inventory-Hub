import { Prisma } from "../../generated/prisma/client.js";
import { between, type Window } from "./shared.js";

// One row per counted sale line (dated by the order) and per counted credit line (dated by the
// credit note, qty and total negated). Every sales metric reads this, so they all net the same way.
// `credit` lets order/product counts skip credit rows: a return is not another order.
// The inner join to sale keeps an orphan credit note out of the money.
export const netSaleLines = (w: Window): Prisma.Sql => Prisma.sql`
	SELECT s.order_date AS d, l.product_id, s.id AS sale_id, s.customer_id, s.customer_name,
		NULLIF(BTRIM(s.price_tier_name), '') AS tier, l.quantity AS qty,
		l.unit_price_base AS unit_price, l.total_base, l.average_cost AS avg_cost, false AS credit
	FROM sale_line l
	JOIN sale s ON s.id = l.sale_id
	WHERE s.counted AND ${between(Prisma.sql`s.order_date`, w)}
	UNION ALL
	SELECT n.credit_date AS d, c.product_id, s.id AS sale_id, s.customer_id, s.customer_name,
		NULLIF(BTRIM(s.price_tier_name), '') AS tier, -c.quantity AS qty,
		c.unit_price_base AS unit_price, -c.total_base AS total_base, c.average_cost AS avg_cost,
		true AS credit
	FROM sale_credit_line c
	JOIN sale_credit_note n ON n.id = c.credit_note_id
	JOIN sale s ON s.id = n.sale_id
	WHERE n.counted AND ${between(Prisma.sql`n.credit_date`, w)}`;

// Earliest date netSaleLines can return, for ranges with no lower bound.
export const earliestNetSaleDate = Prisma.sql`
	SELECT LEAST(
		(SELECT MIN(order_date) FROM sale WHERE counted),
		(SELECT MIN(n.credit_date) FROM sale_credit_note n JOIN sale s ON s.id = n.sale_id
			WHERE n.counted)
	)`;
