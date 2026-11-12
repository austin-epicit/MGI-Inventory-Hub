import type { Db } from "../db.js";
import type { Cin7Availability } from "../cin7/schemas.js";
import { dec4 } from "./money.js";

const CHUNK = 2000;

export type StockResult =
	| { replaced: true; count: number }
	| { replaced: false; reason: "INCOMPLETE" | "EMPTY_SWEEP"; count: 0 };

// Stock is replaced wholesale, so only a fully paged fetch may touch it: a partial fetch would wipe
// products that live on pages never reached.
export async function replaceStock(
	db: Db,
	rows: Cin7Availability[],
	complete: boolean,
	now: Date
): Promise<StockResult> {
	if (!complete) return { replaced: false, reason: "INCOMPLETE", count: 0 };
	// Key collisions (a page overlap while stock moved) resolve last-wins rather than summing.
	const byKey = new Map<string, Cin7Availability>();
	for (const r of rows)
		byKey.set(JSON.stringify([r.ID, r.Location, r.Bin ?? "", r.Batch ?? ""]), r);
	const data = [...byKey.values()].map((r) => ({
		product_id: r.ID,
		location_name: r.Location,
		bin: r.Bin ?? "",
		batch: r.Batch ?? "",
		on_hand: dec4(r.OnHand),
		allocated: dec4(r.Allocated),
		available: dec4(r.Available),
		on_order: dec4(r.OnOrder),
		in_transit: dec4(r.InTransit),
		synced_at: now,
	}));
	// A degraded/empty sweep must not wipe good stock; the caller logs the reason.
	if (data.length === 0 && (await db.stock_level.count()) > 0) {
		return { replaced: false, reason: "EMPTY_SWEEP", count: 0 };
	}
	await db.$transaction(
		async (tx) => {
			await tx.stock_level.deleteMany();
			for (let i = 0; i < data.length; i += CHUNK) {
				await tx.stock_level.createMany({ data: data.slice(i, i + CHUNK) });
			}
		},
		{ timeout: 60_000 }
	);
	return { replaced: true, count: data.length };
}
