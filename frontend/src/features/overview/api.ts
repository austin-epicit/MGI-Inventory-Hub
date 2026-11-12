import { api } from "../../lib/api";
import type { PriceRange } from "../../types/priceHistory";

export interface OverviewKpis {
	stockValue: number;
	unitsOnHand: number;
	sales: number;
	purchases: number;
	grossMarginPct: number | null;
}

export interface CostMover {
	productId: string;
	name: string;
	sku: string;
	thumbUrl: string | null;
	lastCost: number;
	priorAvgCost: number;
	changePct: number;
}

export interface RecentOrder {
	id: string;
	orderNumber: string;
	orderDate: string | null;
	// Supplier on a purchase, customer on a sale.
	party: string;
	status: string;
	totalBase: number;
}

export interface Overview {
	kpis: OverviewKpis;
	costMovers: CostMover[];
	recentPurchases: RecentOrder[];
	recentSales: RecentOrder[];
	lastSyncAt: string | null;
}

export const fetchOverview = (range: PriceRange) => api<Overview>(`/api/overview?range=${range}`);
