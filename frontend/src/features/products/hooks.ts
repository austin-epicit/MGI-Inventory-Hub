import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PriceRange } from "../../types/priceHistory";
import {
	fetchProduct,
	fetchProductFacets,
	fetchProductPriceHistory,
	fetchProductPurchases,
	fetchProducts,
	fetchProductSales,
	saveProductCondition,
	type ProductListParams,
} from "./api";

export const useProducts = (params: ProductListParams) =>
	useQuery({
		queryKey: ["products", "list", params],
		queryFn: () => fetchProducts(params),
		placeholderData: keepPreviousData,
	});

export const useProductFacets = () =>
	useQuery({
		queryKey: ["products", "facets"],
		queryFn: fetchProductFacets,
		staleTime: 60_000,
	});

export const useProduct = (id: string) =>
	useQuery({ queryKey: ["products", "detail", id], queryFn: () => fetchProduct(id) });

export const useProductPriceHistory = (id: string, range: PriceRange) =>
	useQuery({
		queryKey: ["products", "price-history", id, range],
		queryFn: () => fetchProductPriceHistory(id, range),
		placeholderData: keepPreviousData,
	});

export const useProductPurchases = (id: string, page: number, limit: number) =>
	useQuery({
		queryKey: ["products", "purchases", id, page, limit],
		queryFn: () => fetchProductPurchases(id, page, limit),
		placeholderData: keepPreviousData,
	});

export const useProductSales = (id: string, page: number, limit: number) =>
	useQuery({
		queryKey: ["products", "sales", id, page, limit],
		queryFn: () => fetchProductSales(id, page, limit),
		placeholderData: keepPreviousData,
	});

export function useSaveProductCondition(id: string) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (body: Parameters<typeof saveProductCondition>[1]) =>
			saveProductCondition(id, body),
		onSuccess: () =>
			Promise.all([
				qc.invalidateQueries({ queryKey: ["products", "detail", id] }),
				qc.invalidateQueries({ queryKey: ["products", "list"] }),
				qc.invalidateQueries({ queryKey: ["insights", "breakdown"] }),
			]),
	});
}
