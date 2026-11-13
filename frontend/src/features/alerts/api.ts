import { api } from "../../lib/api";

// Mirrors backend/src/alerts/{thresholds,compute}.ts.
export interface AlertThresholds {
	costChangePct: number;
	costChangeDays: number;
	slowMoverDays: number;
	slowMoverMinValue: number;
}

export interface CostAlert {
	key: string;
	dismissed: boolean;
	productId: string;
	sku: string;
	name: string;
	thumbUrl: string | null;
	previousCost: number;
	latestCost: number;
	/** Signed percent change of the latest purchase cost against the previous one. */
	changePct: number;
	latestDate: string;
	purchaseId: string;
	orderNumber: string;
	supplierName: string;
}

export interface SlowAlert {
	key: string;
	dismissed: boolean;
	productId: string;
	sku: string;
	name: string;
	thumbUrl: string | null;
	onHand: number;
	value: number;
	lastSold: string | null;
	daysSinceSale: number | null;
}

export interface AlertsPayload {
	costChanges: CostAlert[];
	slowMovers: SlowAlert[];
	thresholds: AlertThresholds;
	openCount: number;
}

export const fetchAlerts = () => api<AlertsPayload>("/api/alerts");

const post = (path: string, key: string) =>
	api<{ key: string; dismissed: boolean }>(path, {
		method: "POST",
		body: JSON.stringify({ key }),
	});

export const dismissAlert = (key: string) => post("/api/alerts/dismiss", key);
export const restoreAlert = (key: string) => post("/api/alerts/restore", key);

export const fetchAlertThresholds = () => api<AlertThresholds>("/api/alerts/settings");

export const saveAlertThresholds = (t: AlertThresholds) =>
	api<AlertThresholds>("/api/alerts/settings", { method: "PUT", body: JSON.stringify(t) });
