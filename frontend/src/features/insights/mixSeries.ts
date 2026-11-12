import type { InsightsTrendPoint } from "./api";

export type MixMode = "amount" | "share";

const OTHER = "Other";
const UNCATEGORISED = "Uncategorised";
const NAMED_SLOTS = 6;

/** Named categories take the categorical slots in order; the two catch-alls stay neutral. */
export function mixColor(key: string, index: number): string {
	if (key === UNCATEGORISED) return "var(--color-chart-cat-uncategorised)";
	if (key === OTHER || index >= NAMED_SLOTS) return "var(--color-chart-cat-other)";
	return `var(--color-chart-cat-${index + 1})`;
}

// Values sit in their own map so a category named "label" can't clobber the row.
export type MixRow = { label: string; total: number; values: Record<string, number> };

/** One row per period; in share mode each key is its percent of that period's sales. */
export function mixRows(points: InsightsTrendPoint[], keys: string[], mode: MixMode): MixRow[] {
	return points.map((p) => {
		const total = keys.reduce((s, k) => s + (p.mix[k] ?? 0), 0);
		const values: Record<string, number> = {};
		for (const k of keys) {
			const v = p.mix[k] ?? 0;
			values[k] = mode === "amount" ? v : total > 0 ? (v / total) * 100 : 0;
		}
		return { label: p.label, total, values };
	});
}
