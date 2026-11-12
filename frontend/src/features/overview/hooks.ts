import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { PriceRange } from "../../types/priceHistory";
import { fetchOverview } from "./api";

export const useOverview = (range: PriceRange) =>
	useQuery({
		queryKey: ["overview", range],
		queryFn: () => fetchOverview(range),
		placeholderData: keepPreviousData,
	});
