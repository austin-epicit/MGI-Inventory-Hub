import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { PRICE_RANGE_OPTIONS } from "../../components/charts/costPriceSeries";
import type { PriceRange } from "../../types/priceHistory";
import {
	BREAKDOWN_BY,
	fetchInsightsBreakdown,
	fetchInsightsStock,
	fetchInsightsTrend,
	fetchTopProducts,
	type BreakdownBy,
	type TopProductSort,
} from "./api";

export const DEFAULT_INSIGHTS_RANGE: PriceRange = "1y";
const DEFAULT_BY: BreakdownBy = "category";

export const useInsightsTrend = (range: PriceRange) =>
	useQuery({
		queryKey: ["insights", "trend", range],
		queryFn: () => fetchInsightsTrend(range),
		placeholderData: keepPreviousData,
	});

/**
 * The page's `range` and Breakdown `by`, kept in the URL so a refresh or shared link shows the
 * same view. Defaults are left out of the URL; changes replace history rather than push.
 */
export function useInsightsParams() {
	const [searchParams, setSearchParams] = useSearchParams();
	const rangeParam = searchParams.get("range");
	const byParam = searchParams.get("by");
	const range: PriceRange = PRICE_RANGE_OPTIONS.some((r) => r.id === rangeParam)
		? (rangeParam as PriceRange)
		: DEFAULT_INSIGHTS_RANGE;
	const by: BreakdownBy = BREAKDOWN_BY.includes(byParam as BreakdownBy)
		? (byParam as BreakdownBy)
		: DEFAULT_BY;

	const setParam = (key: string, value: string, fallback: string) => {
		const params = new URLSearchParams(searchParams);
		if (value === fallback) params.delete(key);
		else params.set(key, value);
		setSearchParams(params, { replace: true });
	};

	return {
		range,
		setRange: (next: PriceRange) => setParam("range", next, DEFAULT_INSIGHTS_RANGE),
		by,
		setBy: (next: BreakdownBy) => setParam("by", next, DEFAULT_BY),
	};
}

export const useInsightsBreakdown = (range: PriceRange, by: BreakdownBy) =>
	useQuery({
		queryKey: ["insights", "breakdown", range, by],
		queryFn: () => fetchInsightsBreakdown(range, by),
		placeholderData: keepPreviousData,
	});

export const useTopProducts = (range: PriceRange, sort: TopProductSort) =>
	useQuery({
		queryKey: ["insights", "top-products", range, sort],
		queryFn: () => fetchTopProducts(range, sort),
		placeholderData: keepPreviousData,
	});

// "Now"-based, so no range in the key; the three stock-health cards share this one query.
export const useInsightsStock = () =>
	useQuery({ queryKey: ["insights", "stock"], queryFn: fetchInsightsStock });
