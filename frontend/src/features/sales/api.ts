import { api, apiList } from "../../lib/api";

export type SaleSortKey = "orderDate" | "orderNumber" | "customer" | "status" | "totalBase";

export interface SaleRow {
	id: string;
	orderNumber: string;
	orderDate: string | null;
	customerId: string | null;
	customer: string;
	priceTierName: string | null;
	status: string;
	counted: boolean;
	currency: string;
	baseCurrency: string;
	total: number;
	totalBase: number;
	lineCount: number;
	invoiceStatus: string | null;
}

export interface SaleListParams {
	search?: string;
	status?: string;
	excludeStatus?: string;
	customerId?: string;
	tier?: string;
	from?: string;
	to?: string;
	sort?: SaleSortKey;
	dir?: "asc" | "desc";
	page: number; // 1-based, as the API expects
	limit: number;
}

export interface SaleFacets {
	statuses: string[];
	customers: { id: string; name: string }[];
	tiers: string[];
}

export function fetchSales(p: SaleListParams) {
	const qs = new URLSearchParams();
	for (const [k, v] of Object.entries(p))
		if (v !== undefined && v !== "") qs.set(k, String(v));
	return apiList<SaleRow>(`/api/sales?${qs}`);
}

export const fetchSaleFacets = () => api<SaleFacets>("/api/sales/facets");

export interface SaleLine {
	lineNo: number;
	productId: string | null;
	sku: string;
	name: string;
	quantity: number;
	unitPrice: number;
	discountPct: number;
	unitPriceBase: number;
	averageCost: number | null;
	marginPct: number | null;
	totalBase: number;
	thumbUrl: string | null;
}

export interface SaleCreditNote {
	id: string;
	number: string | null;
	date: string | null;
	status: string;
	counted: boolean;
	totalBase: number;
	lines: {
		sku: string;
		name: string;
		quantity: number;
		unitPriceBase: number;
		totalBase: number;
	}[];
}

export interface SaleDetail {
	sale: {
		id: string;
		orderNumber: string;
		type: string;
		status: string;
		counted: boolean;
		orderDate: string | null;
		invoiceDate: string | null;
		customerId: string | null;
		customer: string;
		priceTierName: string | null;
		currency: string;
		baseCurrency: string;
		currencyRate: number;
		total: number;
		totalBase: number;
		cogsBase: number | null;
		marginPct: number | null;
		invoiceStatus: string | null;
		syncedAt: string;
	};
	lines: SaleLine[];
	creditNotes: SaleCreditNote[];
}

export const fetchSale = (id: string) => api<SaleDetail>(`/api/sales/${id}`);
