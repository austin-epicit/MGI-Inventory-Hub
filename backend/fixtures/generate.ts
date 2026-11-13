import type {
	Cin7AdvancedPurchase,
	Cin7Availability,
	Cin7Customer,
	Cin7Location,
	Cin7Me,
	Cin7PriceTier,
	Cin7Product,
	Cin7Purchase,
	Cin7PurchaseListItem,
	Cin7Sale,
	Cin7SaleListItem,
	Cin7Supplier,
} from "../src/cin7/schemas.js";
import { buildAvailability } from "./availability.js";
import { addCreditNotes } from "./creditNotes.js";
import { createContext, type SeedHistoryPoint } from "./context.js";
import { buildProducts } from "./products.js";
import { buildPurchases } from "./purchases.js";
import { buildReference } from "./reference.js";
import { buildSales } from "./sales.js";

export type { SeedHistoryPoint };
// Monthly cost and list-price vectors per product. Cin7 keeps no price history, so only the dev
// seed (source "seed" snapshots) reads this.
export type SeedHistory = { productId: string; sku: string; points: SeedHistoryPoint[] };

export interface Cin7Dataset {
	me: Cin7Me;
	priceTiers: Cin7PriceTier[];
	locations: Cin7Location[];
	suppliers: Cin7Supplier[];
	customers: Cin7Customer[];
	products: Cin7Product[];
	availability: Cin7Availability[];
	sales: Cin7Sale[];
	saleList: Cin7SaleListItem[];
	purchases: (Cin7Purchase | Cin7AdvancedPurchase)[];
	purchaseList: Cin7PurchaseListItem[];
	// Attachment ID -> placeholder kind: a category name (PNG tile) or "pdf".
	attachmentKinds: Record<string, string>;
	seedHistory: SeedHistory[];
}

// Section order is load-bearing: every section draws from one PRNG stream.
export function generateDataset(opts: { seed: number; asOf: string; months: number }): Cin7Dataset {
	const ctx = createContext(opts);
	const ref = buildReference(ctx);
	const prod = buildProducts(ctx);
	const purchases = buildPurchases(ctx, ref, prod);
	const sales = buildSales(ctx, ref, prod);
	const availability = buildAvailability(ctx, ref, prod.slots, purchases, sales);
	addCreditNotes(ctx, sales.sales); // last, so earlier sections' draws stay put
	return {
		me: ref.me,
		priceTiers: ref.priceTiers,
		locations: ref.locations,
		suppliers: ref.suppliers,
		customers: ref.customers,
		products: prod.slots.map((s) => s.rec),
		availability,
		sales: sales.sales,
		saleList: sales.saleList,
		purchases: purchases.purchases,
		purchaseList: purchases.purchaseList,
		attachmentKinds: prod.attachmentKinds,
		seedHistory: prod.slots.map((s) => ({
			productId: s.rec.ID,
			sku: s.rec.SKU,
			points: s.points,
		})),
	};
}
