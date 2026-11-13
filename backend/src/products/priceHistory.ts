import { addDays, zonedParts } from "../sync/dates.js";

export type PriceRange = "30d" | "90d" | "6m" | "1y" | "all";
export const PRICE_RANGES: readonly PriceRange[] = ["30d", "90d", "6m", "1y", "all"];

type Point = { date: string; value: number };

export type PriceHistoryInput = {
	purchases: {
		date: string;
		unitCost: number;
		qty: number;
		purchaseId: string;
		orderNumber: string;
		supplier: string;
	}[];
	snapshots: {
		observedAt: string;
		averageCost: number;
		tierPrices: number[];
		source: "sync" | "seed";
	}[];
	saleLines: {
		date: string;
		tierName: string | null;
		unitPrice: number;
		qty: number;
		averageCost: number | null;
	}[];
	// Counted credit lines (qty positive, as credited); only the KPI margin nets them.
	creditLines?: {
		date: string;
		unitPrice: number;
		qty: number;
		averageCost: number | null;
	}[];
	tiers: { code: number; name: string }[];
	// Earliest non-seed snapshot overall; the route reads it separately since it may predate the range.
	firstTrackedAt?: string | null;
};

export type PriceHistory = {
	range: { from: string; to: string };
	bucket: "week" | "month";
	purchaseCost: PriceHistoryInput["purchases"];
	averageCost: Point[];
	// value null = the tier was unset (0 in Cin7) from that day; the line ends there.
	listPrices: {
		code: number;
		name: string;
		points: { date: string; value: number | null }[];
	}[];
	soldPrices: {
		tierName: string;
		buckets: { start: string; avg: number; min: number; max: number; units: number }[];
	}[];
	listTrackingStartedAt: string | null;
	stats: {
		lastPurchaseCost: number | null;
		purchaseCostChangePct: number | null;
		averageCost: number | null;
		avgSoldPrice: number | null;
		marginPct: number | null;
	};
};

const NO_TIER = "No tier";
const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;

const addMonths = (ymd: string, months: number): string => {
	const [y = 0, m = 1, d = 1] = ymd.split("-").map(Number);
	const idx = y * 12 + (m - 1) + months;
	const ny = Math.floor(idx / 12);
	const nm = (idx % 12) + 1;
	const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
	return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
};

// null = "all": starts at the earliest data point, which only the caller's rows can tell.
export const rangeFrom = (range: PriceRange, today: string): string | null => {
	switch (range) {
		case "30d":
			return addDays(today, -30);
		case "90d":
			return addDays(today, -90);
		case "6m":
			return addMonths(today, -6);
		case "1y":
			return addMonths(today, -12);
		case "all":
			return null;
	}
};

const bucketFor = (range: PriceRange): "week" | "month" =>
	range === "30d" || range === "90d" ? "week" : "month";

// Monday of the calendar week; pure string math so no zone can shift the day.
const weekStart = (ymd: string): string => {
	const dow = new Date(`${ymd}T00:00:00.000Z`).getUTCDay(); // 0 = Sunday
	return addDays(ymd, -((dow + 6) % 7));
};

const bucketStart = (ymd: string, bucket: "week" | "month") =>
	bucket === "week" ? weekStart(ymd) : `${ymd.slice(0, 7)}-01`;

const dayOf = (observedAt: string, timeZone: string): string =>
	/^\d{4}-\d{2}-\d{2}$/.test(observedAt)
		? observedAt
		: zonedParts(new Date(observedAt), timeZone).ymd;

// Sorted, one point per day (the last wins), consecutive equal values collapsed.
const toStepSeries = (points: Point[]): Point[] => {
	const byDay = new Map<string, number>();
	for (const p of [...points].sort((a, b) => a.date.localeCompare(b.date)))
		byDay.set(p.date, p.value);
	const out: Point[] = [];
	for (const [date, value] of [...byDay].sort((a, b) => a[0].localeCompare(b[0]))) {
		if (out.length === 0 || out[out.length - 1]!.value !== value)
			out.push({ date, value });
	}
	return out;
};

// Keep the last point before the window, re-stamped at `from`.
const windowStepSeries = (points: Point[], from: string, to: string): Point[] => {
	const upTo = points.filter((p) => p.date <= to);
	const inside = upTo.filter((p) => p.date >= from);
	const before = upTo.filter((p) => p.date < from);
	const carry = before[before.length - 1];
	if (!carry || inside[0]?.date === from) return inside;
	return [{ date: from, value: carry.value }, ...inside];
};

export type MarginLine = { qty: number; unitPrice: number; averageCost: number | null };

// Lines without a recorded average cost are left out of both sides, so they cannot fake a 100% margin.
export const marginPct = (lines: MarginLine[]): number | null => {
	let revenue = 0;
	let cost = 0;
	for (const l of lines) {
		if (l.averageCost === null) continue;
		revenue += l.qty * l.unitPrice;
		cost += l.qty * l.averageCost;
	}
	return revenue > 0 ? round(((revenue - cost) / revenue) * 100, 2) : null;
};

export const buildPriceHistory = (
	input: PriceHistoryInput,
	q: { range: PriceRange; today: string; timeZone: string }
): PriceHistory => {
	const tz = q.timeZone;
	const to = q.today;
	const snaps = input.snapshots
		.map((s) => ({ ...s, date: dayOf(s.observedAt, tz) }))
		.sort((a, b) => a.observedAt.localeCompare(b.observedAt));

	let from = rangeFrom(q.range, to);
	if (from === null) {
		const all = [
			...input.purchases.map((p) => p.date),
			...input.saleLines.map((l) => l.date),
			...snaps.map((s) => s.date),
		].filter((d) => d <= to);
		from = all.length ? all.reduce((a, b) => (b < a ? b : a)) : to;
	}
	const start = from;
	const inRange = (d: string) => d >= start && d <= to;

	const purchaseCost = input.purchases
		.filter((p) => inRange(p.date))
		.sort((a, b) => a.date.localeCompare(b.date));
	const sales = input.saleLines.filter((l) => inRange(l.date));

	// A snapshot wins over a sale line's average cost on the same day.
	const costPoints = new Map<string, number>();
	for (const l of [...input.saleLines].sort((a, b) => a.date.localeCompare(b.date)))
		if (l.averageCost !== null) costPoints.set(l.date, l.averageCost);
	for (const s of snaps) costPoints.set(s.date, s.averageCost);
	const averageCost = windowStepSeries(
		toStepSeries([...costPoints].map(([date, value]) => ({ date, value }))),
		start,
		to
	);

	const nameOf = new Map(input.tiers.map((t) => [t.code, t.name]));
	const tierCount = Math.max(0, ...snaps.map((s) => s.tierPrices.length));
	const listPrices: PriceHistory["listPrices"] = [];
	for (let i = 0; i < tierCount; i++) {
		const series = windowStepSeries(
			toStepSeries(
				snaps.map((s) => ({
					date: s.date,
					value: Math.max(s.tierPrices[i] ?? 0, 0),
				}))
			),
			start,
			to
		);
		// 0 means "not set": an explicit null ends the line instead of plotting $0 or carrying
		// the old price on. Leading unset points carry nothing, so they are dropped.
		const firstSet = series.findIndex((p) => p.value > 0);
		const points =
			firstSet < 0
				? []
				: series.slice(firstSet).map((p) => ({
						date: p.date,
						value: p.value > 0 ? p.value : null,
					}));
		if (points.length)
			listPrices.push({
				code: i + 1,
				name: nameOf.get(i + 1) ?? `Tier ${i + 1}`,
				points,
			});
	}

	const bucket = bucketFor(q.range);
	type Acc = { start: string; revenue: number; min: number; max: number; units: number };
	const groups = new Map<string, Map<string, Acc>>();
	for (const l of sales) {
		if (l.qty <= 0) continue;
		const tier = l.tierName ?? NO_TIER;
		const bStart = bucketStart(l.date, bucket);
		const byStart = groups.get(tier) ?? new Map<string, Acc>();
		groups.set(tier, byStart);
		const a = byStart.get(bStart) ?? {
			start: bStart,
			revenue: 0,
			min: l.unitPrice,
			max: l.unitPrice,
			units: 0,
		};
		a.revenue += l.qty * l.unitPrice;
		a.units += l.qty;
		a.min = Math.min(a.min, l.unitPrice);
		a.max = Math.max(a.max, l.unitPrice);
		byStart.set(bStart, a);
	}
	const soldPrices = [...groups]
		.sort(([a], [b]) => (a === NO_TIER ? 1 : b === NO_TIER ? -1 : a.localeCompare(b)))
		.map(([tierName, byStart]) => ({
			tierName,
			buckets: [...byStart.values()]
				.sort((a, b) => a.start.localeCompare(b.start))
				.map((a) => ({
					start: a.start,
					avg: round(a.revenue / a.units, 4),
					min: a.min,
					max: a.max,
					units: round(a.units, 4),
				})),
		}));

	const first = purchaseCost[0];
	const last = purchaseCost[purchaseCost.length - 1];
	const soldUnits = sales.reduce((s, l) => s + Math.max(l.qty, 0), 0);
	const soldRevenue = sales.reduce((s, l) => s + Math.max(l.qty, 0) * l.unitPrice, 0);
	const tracked = [
		input.firstTrackedAt ? dayOf(input.firstTrackedAt, tz) : null,
		...snaps.filter((s) => s.source !== "seed").map((s) => s.date),
	]
		.filter((d): d is string => d !== null)
		.sort();

	return {
		range: { from: start, to },
		bucket,
		purchaseCost,
		averageCost,
		listPrices,
		soldPrices,
		listTrackingStartedAt: tracked[0] ?? null,
		stats: {
			lastPurchaseCost: last?.unitCost ?? null,
			// One purchase is no change; null keeps the UI from showing a fake 0%.
			purchaseCostChangePct:
				first && last && first !== last && first.unitCost > 0
					? round(
							((last.unitCost - first.unitCost) /
								first.unitCost) *
								100,
							2
						)
					: null,
			averageCost: averageCost[averageCost.length - 1]?.value ?? null,
			avgSoldPrice: soldUnits > 0 ? round(soldRevenue / soldUnits, 4) : null,
			marginPct: marginPct([
				...sales,
				...(input.creditLines ?? [])
					.filter((l) => inRange(l.date))
					.map((l) => ({ ...l, qty: -l.qty })),
			]),
		},
	};
};
