import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { fetchSale, fetchSaleFacets, fetchSales, type SaleListParams } from "./api";

export const useSales = (params: SaleListParams) =>
	useQuery({
		queryKey: ["sales", "list", params],
		queryFn: () => fetchSales(params),
		placeholderData: keepPreviousData,
	});

export const useSaleFacets = () =>
	useQuery({ queryKey: ["sales", "facets"], queryFn: fetchSaleFacets, staleTime: 60_000 });

export const useSale = (id: string) =>
	useQuery({ queryKey: ["sales", "detail", id], queryFn: () => fetchSale(id) });
