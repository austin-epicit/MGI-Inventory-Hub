import type { Cin7Availability } from "../src/cin7/schemas.js";
import { r2, type GenContext, type Slot } from "./context.js";
import type { Purchases } from "./purchases.js";
import type { Reference } from "./reference.js";
import type { Sales } from "./sales.js";

// Writes the end-of-window state back onto each product and derives per-location stock.
export function buildAvailability(
	{ stamp, randomDay }: GenContext,
	{ priceTiers, locations }: Reference,
	slots: Slot[],
	{ lastPurchaseStamp, onOrder, received }: Purchases,
	{ sold, allocated }: Sales
): Cin7Availability[] {
	// --- Finish products and stock ------------------------------------------------------------
	for (const s of slots) {
		const last = s.points[s.points.length - 1];
		Object.assign(s.rec, {
			AverageCost: last.averageCost,
			Status: s.status,
			PriceTier1: last.tierPrices[0],
			PriceTier2: last.tierPrices[1],
			PriceTier3: last.tierPrices[2],
			PriceTiers: Object.fromEntries(
				priceTiers.map((t, i) => [t.Name, last.tierPrices[i]])
			),
			LastModifiedOn: lastPurchaseStamp.get(s.rec.ID) ?? stamp(randomDay()),
		});
	}

	const availability: Cin7Availability[] = [];
	for (const s of slots) {
		if (s.status === "Setup required") continue;
		const id = s.rec.ID;
		const net = Math.max(0, (received.get(id) ?? 0) - (sold.get(id) ?? 0));
		const refurb = Math.floor(net * 0.2);
		const overflow = Math.floor(net * 0.1);
		const onHand = [net - refurb - overflow, refurb, overflow];
		for (const [li, loc] of locations.entries()) {
			const qty = onHand[li];
			const alloc = li === 0 ? Math.min(qty, allocated.get(id) ?? 0) : 0;
			const incoming = li === 0 ? (onOrder.get(id) ?? 0) : 0;
			if (qty === 0 && incoming === 0) continue;
			availability.push({
				ID: id,
				SKU: s.rec.SKU,
				Name: s.rec.Name,
				Barcode: s.rec.Barcode,
				Location: loc.Name,
				Bin: null,
				Batch: null,
				ExpiryDate: null,
				OnHand: qty,
				Allocated: alloc,
				Available: qty - alloc,
				OnOrder: incoming,
				StockOnHand: r2(qty * s.rec.AverageCost),
				InTransit: 0,
				NextDeliveryDate: null,
			});
		}
	}

	return availability;
}
