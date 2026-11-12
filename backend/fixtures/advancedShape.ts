import type { Cin7AdvancedPurchase, Cin7Purchase } from "../src/cin7/schemas.js";

// What GET /advanced-purchase sends for any purchase type: simple purchases (stored in the legacy
// GET /purchase shape) get their single StockReceived/Invoice objects wrapped into arrays.
export function toAdvancedShape(p: Cin7Purchase | Cin7AdvancedPurchase): Cin7AdvancedPurchase {
	if (Array.isArray(p.StockReceived) || Array.isArray(p.Invoice))
		return p as Cin7AdvancedPurchase;
	const one = (v: { Status: string } | null | undefined) => (v ? [v] : []);
	const simple = p as Cin7Purchase;
	return {
		...simple,
		Type: simple.Type ?? "Simple Purchase",
		StockReceived: one(simple.StockReceived),
		Invoice: one(simple.Invoice),
		CreditNote: [],
		PutAway: [],
		IsServiceOnly: false,
	} as Cin7AdvancedPurchase;
}
