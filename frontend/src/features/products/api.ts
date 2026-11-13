import { api, apiList } from "../../lib/api";
import type { PriceHistory, PriceRange } from "../../types/priceHistory";
import type { ConditionGrade } from "./condition";

export type { ConditionGrade };

export const PRODUCT_STATUSES = ["Active", "Setup required", "Deprecated"] as const;

export type ProductSortKey =
	| "name"
	| "sku"
	| "onHand"
	| "averageCost"
	| "lastPurchaseDate"
	| "lastSoldDate";

export interface ProductListPrice {
	code: number;
	name: string;
	value: number;
}

export interface ProductRow {
	id: string;
	sku: string;
	name: string;
	category: string | null;
	brand: string | null;
	grade: ConditionGrade | null;
	status: string;
	onHand: number;
	available: number;
	averageCost: number;
	listPrices: ProductListPrice[];
	lastPurchaseCost: number | null;
	lastPurchaseDate: string | null;
	lastSoldPrice: number | null;
	lastSoldDate: string | null;
	thumbUrl: string | null;
}

export interface ProductListParams {
	search?: string;
	category?: string;
	brand?: string;
	grade?: ConditionGrade | "none";
	status?: string;
	sort?: ProductSortKey;
	dir?: "asc" | "desc";
	page: number; // 1-based, as the API expects
	limit: number;
}

export interface ProductFacets {
	categories: string[];
	brands: string[];
}

export function fetchProducts(p: ProductListParams) {
	const qs = new URLSearchParams();
	for (const [k, v] of Object.entries(p))
		if (v !== undefined && v !== "") qs.set(k, String(v));
	return apiList<ProductRow>(`/api/products?${qs}`);
}

export const fetchProductFacets = () => api<ProductFacets>("/api/products/facets");

export interface ProductImage {
	id: string;
	thumbUrl: string;
	mediumUrl: string;
	originalUrl: string;
	isPrimary: boolean;
}

export interface StockAtLocation {
	location: string;
	onHand: number;
	allocated: number;
	available: number;
	onOrder: number;
	inTransit: number;
}

export interface ProductCondition {
	grade: ConditionGrade | null;
	notes: string | null;
	updatedAt: string;
	updatedBy: string | null;
}

export interface ProductDetail {
	product: {
		id: string;
		sku: string;
		name: string;
		category: string | null;
		brand: string | null;
		type: string;
		status: string;
		uom: string | null;
		barcode: string | null;
		averageCost: number;
		syncedAt: string;
	};
	images: ProductImage[];
	stock: StockAtLocation[];
	/** Tiers with a price set; Cin7's 0 ("not set") is left out by the API. */
	tiers: ProductListPrice[];
	condition: ProductCondition | null;
}

export interface ProductPurchaseRow {
	purchaseId: string;
	lineNo: number;
	orderNumber: string;
	orderDate: string | null;
	supplier: string;
	status: string;
	counted: boolean;
	quantity: number;
	unitCostBase: number;
	totalBase: number;
}

export interface ProductSaleRow {
	saleId: string;
	lineNo: number;
	orderNumber: string;
	orderDate: string | null;
	customer: string;
	priceTierName: string | null;
	status: string;
	counted: boolean;
	quantity: number;
	unitPriceBase: number;
	averageCost: number | null;
	totalBase: number;
}

export const fetchProduct = (id: string) => api<ProductDetail>(`/api/products/${id}`);

export const fetchProductPriceHistory = (id: string, range: PriceRange) =>
	api<PriceHistory>(`/api/products/${id}/price-history?range=${range}`);

// page is 1-based, as the API expects.
export const fetchProductPurchases = (id: string, page: number, limit: number) =>
	apiList<ProductPurchaseRow>(`/api/products/${id}/purchases?page=${page}&limit=${limit}`);

export const fetchProductSales = (id: string, page: number, limit: number) =>
	apiList<ProductSaleRow>(`/api/products/${id}/sales?page=${page}&limit=${limit}`);

// Both fields null clears the record; the API answers null then.
export const saveProductCondition = (
	id: string,
	body: { grade: ConditionGrade | null; notes: string | null }
) =>
	api<ProductCondition | null>(`/api/products/${id}/condition`, {
		method: "PUT",
		body: JSON.stringify(body),
	});
