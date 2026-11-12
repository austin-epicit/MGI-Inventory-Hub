import { Prisma } from "../../generated/prisma/client.js";
import type { MarginLine } from "../products/priceHistory.js";

export type Window = { from: string; to: string };

export const between = (col: Prisma.Sql, w: Window): Prisma.Sql =>
	Prisma.sql`${col} >= ${w.from}::date AND ${col} <= ${w.to}::date`;

// Revenue minus cost over the lines marginPct counts (those with an average cost).
export const grossProfit = (lines: MarginLine[]): number =>
	lines.reduce(
		(s, l) => (l.averageCost === null ? s : s + l.qty * (l.unitPrice - l.averageCost)),
		0
	);
