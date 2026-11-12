import { api } from "../../lib/api";
import type { PriceRange } from "../../types/priceHistory";

export const BREAKDOWN_BY = ["category", "brand", "customer", "tier", "supplier"] as const;
export type BreakdownBy = (typeof BREAKDOWN_BY)[number];

export interface InsightsTrendPoint {
	/** First day of the period, "YYYY-MM-DD". */
	start: string;
	/** Axis label; says so when the period is only partly inside the range ("Nov 1–12"). */
	label: string;
	sales: number;
	purchases: number;
	grossProfit: number;
	grossMarginPct: number | null;
	mix: Record<string, number>;
}

export interface InsightsTrend {
	period: "week" | "month";
	from: string;
	to: string;
	totals: {
		sales: number;
		purchases: number;
		grossProfit: number;
		grossMarginPct: number | null;
	};
	points: InsightsTrendPoint[];
	/** Top categories by sales, then "Other", then "Uncategorised" when present. */
	mixKeys: string[];
}

export const fetchInsightsTrend = (range: PriceRange) =>
	api<InsightsTrend>(`/api/insights/trend?range=${range}`);

export interface InsightsBreakdownRow {
	/** The filter value for the list page; null for the fallback rows ("Uncategorised", "No tier"…). */
	key: string | null;
	label: string;
	amount: number;
	grossProfit: number | null;
	marginPct: number | null;
	units: number;
	orders: number;
	products: number;
}

export interface InsightsBreakdown {
	by: BreakdownBy;
	kind: "sales" | "purchases";
	total: number;
	rows: InsightsBreakdownRow[];
	/** Everything past the top 15, folded into one row labelled "Other (n)". */
	other: InsightsBreakdownRow | null;
}

export const fetchInsightsBreakdown = (range: PriceRange, by: BreakdownBy) =>
	api<InsightsBreakdown>(`/api/insights/breakdown?range=${range}&by=${by}`);

export const TOP_PRODUCT_SORTS = ["sales", "profit", "units"] as const;
export type TopProductSort = (typeof TOP_PRODUCT_SORTS)[number];

export interface TopProductRow {
	productId: string;
	name: string;
	sku: string;
	thumbUrl: string | null;
	sales: number;
	grossProfit: number | null;
	marginPct: number | null;
	units: number;
	onHand: number;
}

export interface TopProducts {
	rows: TopProductRow[];
}

export const fetchTopProducts = (range: PriceRange, sort: TopProductSort) =>
	api<TopProducts>(`/api/insights/top-products?range=${range}&sort=${sort}`);

// Mirrors SLOW_MOVER_DAYS in backend/src/insights/stockHealth.ts.
export const SLOW_MOVER_DAYS = 90;
export const AGE_BUCKETS = ["0-30", "31-90", "91-180", "181-365", "365+", "none"] as const;
export type AgeBucket = (typeof AGE_BUCKETS)[number];

export interface InsightsStock {
	valueHistory: { day: string; value: number; units: number }[];
	/** First day with a stock-value snapshot, "YYYY-MM-DD". */
	trackingSince: string | null;
	/** Always six buckets, in AGE_BUCKETS order. */
	age: { bucket: AgeBucket; value: number; units: number; products: number }[];
	slowMovers: {
		productId: string;
		name: string;
		sku: string;
		thumbUrl: string | null;
		onHand: number;
		value: number;
		lastSold: string | null;
	}[];
}

export const fetchInsightsStock = () => api<InsightsStock>("/api/insights/stock");
