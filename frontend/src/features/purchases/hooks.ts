import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { fetchPurchase, fetchPurchaseFacets, fetchPurchases, type PurchaseListParams } from "./api";

export const usePurchases = (params: PurchaseListParams) =>
	useQuery({
		queryKey: ["purchases", "list", params],
		queryFn: () => fetchPurchases(params),
		placeholderData: keepPreviousData,
	});

export const usePurchaseFacets = () =>
	useQuery({
		queryKey: ["purchases", "facets"],
		queryFn: fetchPurchaseFacets,
		staleTime: 60_000,
	});

export const usePurchase = (id: string) =>
	useQuery({ queryKey: ["purchases", "detail", id], queryFn: () => fetchPurchase(id) });
