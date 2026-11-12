import { Prisma } from "../../generated/prisma/client.js";
import type { Db } from "../db.js";
import { ymdToDbDate } from "./dates.js";
import { dec4, round4 } from "./money.js";

type Tx = Prisma.TransactionClient;

// A snapshot is a point on the cost/price history chart: write one only when something moved at 4 dp.
export async function recordSnapshotIfChanged(
	tx: Tx,
	productId: string,
	values: { averageCost: number; tierPrices: number[] },
	observedAt: Date,
	source: "sync" | "seed" = "sync"
): Promise<boolean> {
	const averageCost = dec4(values.averageCost);
	const tierPrices = values.tierPrices.map(dec4);
	const prev = await tx.product_price_snapshot.findFirst({
		where: { product_id: productId },
		orderBy: [{ observed_at: "desc" }, { id: "desc" }],
	});
	if (prev) {
		const same =
			prev.average_cost.toFixed(4) === averageCost &&
			prev.tier_prices.length === tierPrices.length &&
			prev.tier_prices.every((p, i) => p.toFixed(4) === tierPrices[i]);
		if (same) return false;
	}
	await tx.product_price_snapshot.create({
		data: {
			product_id: productId,
			observed_at: observedAt,
			average_cost: averageCost,
			tier_prices: tierPrices,
			source,
		},
	});
	return true;
}

// What the whole store holds right now: on-hand � average cost, and the units behind it.
export async function currentStockValue(db: Db): Promise<{ value: number; units: number }> {
	const [r] = await db.$queryRaw<{ value: Prisma.Decimal; units: Prisma.Decimal }[]>`
		SELECT COALESCE(SUM(s.on_hand * p.average_cost), 0) AS value,
			COALESCE(SUM(s.on_hand), 0) AS units
		FROM stock_level s JOIN product p ON p.id = s.product_id`;
	return { value: round4(Number(r!.value)), units: round4(Number(r!.units)) };
}

// One row per calendar day: a later sync the same day overwrites it, so the day keeps its last reading.
export async function recordStockValue(db: Db, day: string, now: Date): Promise<void> {
	const { value, units } = await currentStockValue(db);
	const data = {
		value: dec4(value),
		units: dec4(units),
		source: "sync" as const,
		recorded_at: now,
	};
	await db.stock_value_snapshot.upsert({
		where: { day: ymdToDbDate(day) },
		create: { day: ymdToDbDate(day), ...data },
		update: data,
	});
}
