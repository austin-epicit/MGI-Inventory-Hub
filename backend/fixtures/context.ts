import type { Cin7Product } from "../src/cin7/schemas.js";
import type { Category } from "./catalog.js";
import { Rng } from "./rng.js";

export const DAY = 86_400_000;
export const HOUR = 3_600_000;
export const r2 = (n: number) => Math.round(n * 100) / 100;
export const r4 = (n: number) => Math.round(n * 10_000) / 10_000;
export const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
// Business dates carry no zone: Cin7 sends local midnight and the hub must not shift it.
export const bizDate = (ms: number) => `${ymd(ms)}T00:00:00`;
export const slug = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, "-");
export const num5 = (n: number, prefix: string) => `${prefix}-${String(n).padStart(5, "0")}`;
// Cin7 (.NET) drops trailing zeros from the fraction, so digits vary: "…45.21", "…56.8", "…07".
export const cin7Stamp = (ms: number, zoneless = false) => {
	const trimmed = new Date(ms).toISOString().replace(/\.?0+Z$/, "Z");
	return zoneless ? trimmed.slice(0, -1) : trimmed;
};
export const bump = (map: Map<string, number>, key: string, by: number) =>
	map.set(key, (map.get(key) ?? 0) + by);

export type SeedHistoryPoint = { month: string; averageCost: number; tierPrices: number[] };

export type Slot = {
	rec: Cin7Product;
	category: Category;
	status: "Active" | "Setup required" | "Deprecated";
	weight: number;
	points: SeedHistoryPoint[];
};

// Everything the section builders share: the PRNG and the date window.
export type GenContext = {
	rng: Rng;
	months: number;
	asOfMs: number;
	startMs: number;
	totalDays: number;
	monthOf: (ms: number) => number;
	monthLabel: (m: number) => string;
	randomDay: () => number;
	stamp: (dayMs: number, lagDays?: number, mixedZone?: boolean) => string;
};

export function createContext(opts: { seed: number; asOf: string; months: number }): GenContext {
	const rng = new Rng(opts.seed);
	const asOfMs = Date.parse(`${opts.asOf}T00:00:00Z`);
	const asOfD = new Date(asOfMs);
	const startMs = Date.UTC(
		asOfD.getUTCFullYear(),
		asOfD.getUTCMonth() - opts.months,
		asOfD.getUTCDate()
	);
	const totalDays = Math.round((asOfMs - startMs) / DAY);
	const lastStamp = asOfMs - 1000;
	const startY = new Date(startMs).getUTCFullYear();
	const startM = new Date(startMs).getUTCMonth();
	const monthOf = (ms: number) => {
		const d = new Date(ms);
		return (d.getUTCFullYear() - startY) * 12 + d.getUTCMonth() - startM;
	};
	const monthLabel = (m: number) =>
		new Date(Date.UTC(startY, startM + m, 1)).toISOString().slice(0, 7);
	const randomDay = () => startMs + rng.int(0, totalDays - 1) * DAY;
	// Modification stamps: `dayMs` plus a lag, working hours, capped inside the data window.
	// `mixedZone` mimics the purchase endpoints, which send some stamps without a zone.
	const stamp = (dayMs: number, lagDays = 0, mixedZone = false) => {
		const ms = Math.min(
			lastStamp,
			dayMs + lagDays * DAY + rng.int(8 * HOUR, 18 * HOUR - 1)
		);
		return cin7Stamp(ms, mixedZone && ms % 2 === 0);
	};
	return {
		rng,
		months: opts.months,
		asOfMs,
		startMs,
		totalDays,
		monthOf,
		monthLabel,
		randomDay,
		stamp,
	};
}
