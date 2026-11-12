import { formatDate, todayYmd } from "../lib/format";
import type { DateRangeValue } from "./dateRangeUtils";

const addDays = (ymd: string, n: number): string => {
	const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
	return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const monthStart = (ymd: string, monthsAhead: number): string => {
	const [y, m] = ymd.split("-").map(Number) as [number, number];
	return new Date(Date.UTC(y, m - 1 + monthsAhead, 1)).toISOString().slice(0, 10);
};
const localYmd = (d: Date) =>
	`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Inclusive calendar dates for the API's from/to. Presets are counted from today in the Cin7
// app zone; a custom range is the calendar days the user picked. Empty for "all".
export function rangeToYmd(
	value: DateRangeValue,
	today: string = todayYmd()
): { from?: string; to?: string } {
	switch (value.option) {
		case "all":
			return {};
		case "today":
			return { from: today, to: today };
		case "tomorrow":
			return { from: addDays(today, 1), to: addDays(today, 1) };
		case "last_7_days":
			return { from: addDays(today, -6), to: today };
		case "last_30_days":
			return { from: addDays(today, -29), to: today };
		case "this_month":
			return { from: monthStart(today, 0), to: today };
		case "next_7_days":
			return { from: today, to: addDays(today, 6) };
		case "next_30_days":
			return { from: today, to: addDays(today, 29) };
		case "next_month":
			return {
				from: monthStart(today, 1),
				to: addDays(monthStart(today, 2), -1),
			};
		case "custom":
			return value.startDate && value.endDate
				? { from: localYmd(value.startDate), to: localYmd(value.endDate) }
				: {};
	}
}

// Chip text: the preset name plus the app-zone dates it covers, so the label and the request agree.
export function rangeLabel(name: string, value: DateRangeValue): string {
	const { from, to } = rangeToYmd(value);
	if (!from || !to) return name;
	return from === to
		? `${name} (${formatDate(from)})`
		: `${name} (${formatDate(from)} – ${formatDate(to)})`;
}
