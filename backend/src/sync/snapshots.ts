import type { Prisma } from "../../generated/prisma/client.js";
import { dec4 } from "./money.js";

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
