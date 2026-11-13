import { z } from "zod";
import type { Db } from "../db.js";
import { getSetting, setSetting } from "../settings/appSettings.js";

export const ALERT_THRESHOLDS_KEY = "alerts.thresholds";

export type AlertThresholds = {
	costChangePct: number;
	costChangeDays: number;
	slowMoverDays: number;
	slowMoverMinValue: number;
};

export const DEFAULT_THRESHOLDS: AlertThresholds = {
	costChangePct: 15,
	costChangeDays: 90,
	slowMoverDays: 90,
	slowMoverMinValue: 1000,
};

export const thresholdsSchema = z.object({
	costChangePct: z.number().int().min(1).max(1000),
	costChangeDays: z.number().int().min(1).max(3650),
	slowMoverDays: z.number().int().min(1).max(3650),
	slowMoverMinValue: z.number().min(0).max(100_000_000),
});

const FIELDS = Object.keys(DEFAULT_THRESHOLDS) as (keyof AlertThresholds)[];

// A missing or hand-damaged stored value falls back per field, so one bad number keeps the rest.
export async function getThresholds(db: Db): Promise<AlertThresholds> {
	const stored = await getSetting<unknown>(db, ALERT_THRESHOLDS_KEY);
	const obj =
		stored && typeof stored === "object" && !Array.isArray(stored)
			? (stored as Record<string, unknown>)
			: {};
	const out = { ...DEFAULT_THRESHOLDS };
	for (const f of FIELDS) {
		const parsed = thresholdsSchema.shape[f].safeParse(obj[f]);
		if (parsed.success) out[f] = parsed.data;
	}
	return out;
}

export async function saveThresholds(db: Db, t: AlertThresholds): Promise<AlertThresholds> {
	await setSetting(db, ALERT_THRESHOLDS_KEY, t);
	return t;
}
