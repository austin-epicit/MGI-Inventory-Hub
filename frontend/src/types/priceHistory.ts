// Mirrors backend/src/products/priceHistory.ts `PriceHistory`. Dates are calendar days
// (YYYY-MM-DD) in the app time zone; money is base currency.

export type PriceRange = "30d" | "90d" | "6m" | "1y" | "all";

export interface PricePoint {
	date: string;
	value: number;
}

export interface ListPricePoint {
	date: string;
	value: number | null;
}

export interface PurchaseCostPoint {
	date: string;
	unitCost: number;
	qty: number;
	purchaseId: string;
	orderNumber: string;
	supplier: string;
}

export interface SoldBucket {
	start: string;
	avg: number;
	min: number;
	max: number;
	units: number;
}

export interface PriceHistory {
	range: { from: string; to: string };
	bucket: "week" | "month";
	purchaseCost: PurchaseCostPoint[];
	averageCost: PricePoint[];
	// `code` is the Cin7 tier number (tier_prices[i] is code i + 1). A null value means the
	// tier was unset (0 in Cin7) from that day.
	listPrices: { code: number; name: string; points: ListPricePoint[] }[];
	// Keyed by the sale's tier name; "No tier" for sales without one.
	soldPrices: { tierName: string; buckets: SoldBucket[] }[];
	listTrackingStartedAt: string | null;
	stats: {
		lastPurchaseCost: number | null;
		purchaseCostChangePct: number | null;
		averageCost: number | null;
		avgSoldPrice: number | null;
		marginPct: number | null;
	};
}
