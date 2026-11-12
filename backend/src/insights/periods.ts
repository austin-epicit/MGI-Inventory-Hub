import { addDays, ymdToDbDate } from "../sync/dates.js";
import type { PriceRange } from "../products/priceHistory.js";

export type Period = "week" | "month";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const periodFor = (range: PriceRange): Period =>
	range === "30d" || range === "90d" ? "week" : "month";

// Monday-based weeks; UTC getters only, so the server zone never shifts the day.
export function periodStart(ymd: string, p: Period): string {
	if (p === "month") return `${ymd.slice(0, 7)}-01`;
	const dow = ymdToDbDate(ymd).getUTCDay(); // 0 = Sunday
	return addDays(ymd, -((dow + 6) % 7));
}

function nextStart(start: string, p: Period): string {
	if (p === "week") return addDays(start, 7);
	const y = Number(start.slice(0, 4));
	const m = Number(start.slice(5, 7));
	return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

const monthDay = (ymd: string) =>
	`${MONTHS[Number(ymd.slice(5, 7)) - 1]} ${Number(ymd.slice(8, 10))}`;

function clippedLabel(a: string, b: string): string {
	if (a === b) return monthDay(a);
	const sameMonth = a.slice(0, 7) === b.slice(0, 7);
	return `${monthDay(a)}–${sameMonth ? Number(b.slice(8, 10)) : monthDay(b)}`;
}

export function fillPeriods(
	from: string,
	to: string,
	p: Period
): { start: string; label: string }[] {
	const out: { start: string; label: string }[] = [];
	const last = periodStart(to, p);
	for (let start = periodStart(from, p); start <= last; start = nextStart(start, p)) {
		const end = addDays(nextStart(start, p), -1);
		const lo = start < from ? from : start;
		const hi = end > to ? to : end;
		const label =
			lo !== start || hi !== end
				? clippedLabel(lo, hi)
				: p === "month"
					? `${MONTHS[Number(start.slice(5, 7)) - 1]} ${start.slice(0, 4)}`
					: monthDay(start);
		out.push({ start, label });
	}
	return out;
}
