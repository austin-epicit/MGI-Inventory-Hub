import { api, apiList } from "../../lib/api";

export type PurchaseSortKey = "orderDate" | "orderNumber" | "supplier" | "status" | "totalBase";

export interface PurchaseRow {
	id: string;
	orderNumber: string;
	orderDate: string | null;
	supplierId: string | null;
	supplier: string;
	status: string;
	counted: boolean;
	currency: string;
	baseCurrency: string;
	total: number;
	totalBase: number;
	lineCount: number;
	receivingStatus: string | null;
	invoiceStatus: string | null;
}

export interface PurchaseListParams {
	search?: string;
	status?: string;
	supplierId?: string;
	from?: string;
	to?: string;
	sort?: PurchaseSortKey;
	dir?: "asc" | "desc";
	page: number; // 1-based, as the API expects
	limit: number;
}

export interface PurchaseFacets {
	statuses: string[];
	suppliers: { id: string; name: string }[];
}

export function fetchPurchases(p: PurchaseListParams) {
	const qs = new URLSearchParams();
	for (const [k, v] of Object.entries(p))
		if (v !== undefined && v !== "") qs.set(k, String(v));
	return apiList<PurchaseRow>(`/api/purchases?${qs}`);
}

export const fetchPurchaseFacets = () => api<PurchaseFacets>("/api/purchases/facets");

export interface PurchaseLine {
	lineNo: number;
	productId: string | null;
	sku: string;
	name: string;
	quantity: number;
	unitPrice: number;
	discountPct: number;
	unitCostBase: number;
	totalBase: number;
	thumbUrl: string | null;
}

export interface PurchaseDetail {
	purchase: {
		id: string;
		orderNumber: string;
		type: string;
		status: string;
		counted: boolean;
		orderDate: string | null;
		supplierId: string | null;
		supplier: string;
		currency: string;
		baseCurrency: string;
		currencyRate: number;
		total: number;
		totalBase: number;
		receivingStatus: string | null;
		invoiceStatus: string | null;
		syncedAt: string;
	};
	lines: PurchaseLine[];
}

export const fetchPurchase = (id: string) => api<PurchaseDetail>(`/api/purchases/${id}`);
