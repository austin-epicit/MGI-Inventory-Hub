import type { Db } from "../db.js";
import { log } from "../log.js";
import {
	Cin7AdvancedPurchase,
	Cin7Product,
	Cin7PurchaseListItem,
	Cin7Sale,
	Cin7SaleListItem,
} from "../cin7/schemas.js";
import { mapProduct } from "./products.js";
import { mapPurchase, rewritePurchase } from "./purchases.js";
import { mapSale, rewriteSale } from "./sales.js";

const PAGE = 200;

// Re-derives every mapped column from the stored raw payload after a mapping fix, with no Cin7
// calls. Only mapped columns change: raw and synced_at stay as the last real sync left them.
export async function remapFromRaw(
	db: Db,
	entity: "product" | "purchase" | "sale"
): Promise<{ remapped: number; skipped: number }> {
	const table = db[entity] as unknown as {
		findMany(args: unknown): Promise<{ id: string; raw: unknown }[]>;
	};
	let after: string | undefined;
	let done = 0;
	let skipped = 0;
	for (;;) {
		const rows = await table.findMany({
			take: PAGE,
			orderBy: { id: "asc" },
			select: { id: true, raw: true },
			...(after ? { cursor: { id: after }, skip: 1 } : {}),
		});
		if (rows.length === 0) return { remapped: done, skipped };
		for (const row of rows) {
			// Only parse/map is per-row; a database or connection failure below must abort the run.
			let write: () => Promise<unknown>;
			try {
				const raw = row.raw as { list?: unknown; detail?: unknown };
				if (entity === "product") {
					const { raw: _kept, ...mapped } = mapProduct(
						Cin7Product.parse(row.raw)
					);
					write = () =>
						db.product.update({
							where: { id: row.id },
							data: mapped,
						});
				} else if (entity === "sale") {
					const mapped = mapSale(
						Cin7Sale.parse(raw.detail),
						Cin7SaleListItem.parse(raw.list)
					);
					write = () => rewriteSale(db, mapped);
				} else {
					const mapped = mapPurchase(
						Cin7AdvancedPurchase.parse(raw.detail),
						Cin7PurchaseListItem.parse(raw.list)
					);
					write = () => rewritePurchase(db, mapped);
				}
			} catch (err) {
				skipped++; // one bad stored payload must not abort the whole rebuild
				log.warn({ err, entity, id: row.id }, "remap skipped record");
				continue;
			}
			await write();
			done++;
		}
		after = rows[rows.length - 1]!.id;
	}
}
