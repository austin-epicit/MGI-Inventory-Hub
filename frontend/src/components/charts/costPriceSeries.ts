import type {
	PriceHistory,
	PriceRange,
	PurchaseCostPoint,
	SoldBucket,
} from "../../types/priceHistory";

// Pure data shaping for CostPriceChart: tested here instead of through the SVG.

export const PRICE_RANGE_OPTIONS: { id: PriceRange; label: string }[] = [
	{ id: "30d", label: "30d" },
	{ id: "90d", label: "90d" },
	{ id: "6m", label: "6m" },
	{ id: "1y", label: "1y" },
	{ id: "all", label: "All" },
];

export type SeriesKey = "purchaseCost" | "averageCost" | `list:${number}` | `sold:${string}`;

export const listKey = (code: number): SeriesKey => `list:${code}`;
export const soldKey = (tierName: string): SeriesKey => `sold:${tierName}`;

/** Tier hues available (theme `--color-chart-tier-1..4`); more tiers at once would need generated hues. */
export const MAX_TIERS = 4;
const NO_TIER = "No tier";

/** One price tier: its list-price series (by Cin7 code) and sold-price series (by sale tier name). */
export interface Tier {
	name: string;
	code: number | null;
	listKey: SeriesKey | null;
	soldKey: SeriesKey | null;
	/** Units sold in the range. */
	units: number;
}

export function tiersOf(h: PriceHistory): Tier[] {
	const listed: Tier[] = [...h.listPrices]
		.sort((a, b) => a.code - b.code)
		.map((l) => ({
			name: l.name,
			code: l.code,
			listKey: listKey(l.code),
			soldKey: null,
			units: 0,
		}));
	const soldOnly: Tier[] = [];
	for (const s of h.soldPrices) {
		const units = s.buckets.reduce((sum, b) => sum + b.units, 0);
		const match = listed.find((t) => t.name === s.tierName && t.soldKey === null);
		if (match) {
			match.soldKey = soldKey(s.tierName);
			match.units = units;
		} else
			soldOnly.push({
				name: s.tierName,
				code: null,
				listKey: null,
				soldKey: soldKey(s.tierName),
				units,
			});
	}
	soldOnly.sort((a, b) =>
		a.name === NO_TIER ? 1 : b.name === NO_TIER ? -1 : a.name.localeCompare(b.name)
	);
	return [...listed, ...soldOnly];
}

const isShown = (t: Tier, visible: Set<SeriesKey>) =>
	(t.listKey !== null && visible.has(t.listKey)) ||
	(t.soldKey !== null && visible.has(t.soldKey));

export const shownTiers = (tiers: Tier[], visible: Set<SeriesKey>): Tier[] =>
	tiers.filter((t) => isShown(t, visible));

/** Both cost series, plus the list + sold pair of the (up to) 4 tiers with the most units sold. */
export function defaultVisible(h: PriceHistory): Set<SeriesKey> {
	const out = new Set<SeriesKey>(["purchaseCost", "averageCost"]);
	const ranked = tiersOf(h)
		.map((t, i) => ({ t, i }))
		.sort((a, b) => b.t.units - a.t.units || a.i - b.i)
		.slice(0, MAX_TIERS);
	for (const { t } of ranked) {
		if (t.listKey) out.add(t.listKey);
		if (t.soldKey) out.add(t.soldKey);
	}
	return out;
}

export const tierOf = (tiers: Tier[], key: SeriesKey): Tier | undefined =>
	tiers.find((t) => t.listKey === key || t.soldKey === key);

/** Whether `key` may be switched on: a fifth tier at once would run out of hues. */
export function canShow(tiers: Tier[], visible: Set<SeriesKey>, key: SeriesKey): boolean {
	const tier = tierOf(tiers, key);
	if (!tier || isShown(tier, visible)) return true;
	return shownTiers(tiers, visible).length < MAX_TIERS;
}

/**
 * Hue slot (1..4) per shown tier. A tier keeps its slot while it stays shown, so hiding one
 * never repaints the others; a newly shown tier takes the lowest free slot.
 */
export function assignTierSlots(
	tiers: Tier[],
	visible: Set<SeriesKey>,
	prev: Map<string, number>
): Map<string, number> {
	const shown = shownTiers(tiers, visible);
	const out = new Map<string, number>();
	const used = new Set<number>();
	for (const t of shown) {
		const slot = prev.get(t.name);
		if (slot !== undefined && !used.has(slot)) {
			out.set(t.name, slot);
			used.add(slot);
		}
	}
	for (const t of shown) {
		if (out.has(t.name)) continue;
		let slot = 1;
		while (used.has(slot)) slot++;
		out.set(t.name, slot);
		used.add(slot);
	}
	return out;
}

export const COST_COLOR = "var(--color-chart-warning)";
export const tierColor = (slot: number | undefined): string =>
	slot !== undefined && slot >= 1 && slot <= MAX_TIERS
		? `var(--color-chart-tier-${slot})`
		: "var(--color-chart-axis)";

/** Price vocabulary from the decision memo, verbatim. */
export function seriesLabel(key: SeriesKey, tiers: Tier[]): string {
	if (key === "purchaseCost") return "Purchase cost";
	if (key === "averageCost") return "Average cost";
	const tier = tierOf(tiers, key)?.name ?? key.slice(5);
	return key.startsWith("list:") ? `List price — ${tier}` : `Sold price — ${tier}`;
}

// Calendar days ride the numeric axis as UTC midnights, so no browser zone can move them.
export const ymdToTs = (ymd: string): number => {
	const [y = 1970, m = 1, d = 1] = ymd.split("-").map(Number);
	return Date.UTC(y, m - 1, d);
};
export const tsToYmd = (ts: number): string => new Date(ts).toISOString().slice(0, 10);

const nextBucketStart = (start: string, bucket: PriceHistory["bucket"]): string => {
	const d = new Date(ymdToTs(start));
	if (bucket === "week") d.setUTCDate(d.getUTCDate() + 7);
	else d.setUTCMonth(d.getUTCMonth() + 1, 1);
	return tsToYmd(d.getTime());
};

export interface ChartRow {
	ts: number;
	date: string;
	/** Plotted values per visible series; null breaks a line. */
	values: Partial<Record<SeriesKey, number | null>>;
	/** Sold price − average cost per visible sold series (Margin mode). */
	margin: Partial<Record<SeriesKey, number | null>>;
	/** Low–high sold price of the one visible sold series. */
	band: [number, number] | null;
	/** Average cost in effect on this day, shown or not. */
	averageCost: number | null;
	/** This row's purchase-cost dot. */
	purchaseCost: number | null;
	/** Every counted purchase of the day, for the tooltip. */
	purchases: PurchaseCostPoint[];
	/** Real sold buckets that start on this row (interpolated rows have none). */
	buckets: Partial<Record<SeriesKey, SoldBucket>>;
	/** List series unset from this day: the plotted value only closes the old step. */
	unset: Partial<Record<SeriesKey, true>>;
}

type Pt = { date: string; ts: number };

// Value at `date` from step points (each holds until the next one).
const stepAt = (points: { date: string; value: number | null }[], date: string): number | null => {
	let v: number | null = null;
	for (const p of points) {
		if (p.date > date) break;
		v = p.value;
	}
	return v;
};

// A sold series is drawn straight between buckets of consecutive periods and breaks across a
// period without sales. Rows other series add between two buckets sit on that straight segment.
const sampleBuckets = <T extends Pt>(
	points: T[],
	adjacent: (a: T, b: T) => boolean,
	pick: (p: T) => number | null,
	date: string,
	ts: number
): number | null => {
	for (let i = 0; i < points.length; i++) {
		const a = points[i]!;
		if (a.date === date) return pick(a);
		const b = points[i + 1];
		if (b && a.date < date && date < b.date) {
			const va = pick(a);
			const vb = pick(b);
			if (!adjacent(a, b) || va === null || vb === null) return null;
			return va + ((vb - va) * (ts - a.ts)) / (b.ts - a.ts);
		}
	}
	return null;
};

export function toChartRows(h: PriceHistory, visible: Set<SeriesKey>): ChartRow[] {
	const { from, to } = h.range;
	const inRange = (d: string) => d >= from && d <= to;
	const avgPoints = [...h.averageCost].sort((a, b) => a.date.localeCompare(b.date));
	const dates = new Set<string>([from, to]);

	const lists = h.listPrices
		.filter((l) => visible.has(listKey(l.code)))
		.map((l) => {
			const points = [...l.points].sort((a, b) => a.date.localeCompare(b.date));
			// Day the tier became unset → the price it had, so the step is drawn up to that day.
			const closes = new Map<string, number>();
			points.forEach((p, i) => {
				const prev = points[i - 1]?.value;
				if (p.value === null && prev != null) closes.set(p.date, prev);
			});
			return { key: listKey(l.code), points, closes };
		});
	for (const l of lists) for (const p of l.points) dates.add(p.date);
	if (visible.has("averageCost")) for (const p of avgPoints) dates.add(p.date);

	const purchasesByDay = new Map<string, PurchaseCostPoint[]>();
	if (visible.has("purchaseCost"))
		for (const p of h.purchaseCost) {
			purchasesByDay.set(p.date, [...(purchasesByDay.get(p.date) ?? []), p]);
			dates.add(p.date);
		}

	type BucketPt = Pt & { bucket: SoldBucket; margin: number | null };
	const solds = h.soldPrices
		.filter((s) => visible.has(soldKey(s.tierName)))
		.map((s) => {
			const points: BucketPt[] = [...s.buckets]
				.sort((a, b) => a.start.localeCompare(b.start))
				.map((b) => {
					const date = b.start < from ? from : b.start; // a week can start before the range
					const cost = stepAt(avgPoints, date);
					return {
						date,
						ts: ymdToTs(date),
						bucket: b,
						margin: cost === null ? null : b.avg - cost,
					};
				});
			for (const p of points) dates.add(p.date);
			// A row where the missing period starts, so the line cannot bridge it.
			for (let i = 0; i + 1 < points.length; i++) {
				const next = nextBucketStart(points[i]!.bucket.start, h.bucket);
				if (next !== points[i + 1]!.bucket.start) dates.add(next);
			}
			return { key: soldKey(s.tierName), points };
		});
	const adjacent = (a: BucketPt, b: BucketPt) =>
		nextBucketStart(a.bucket.start, h.bucket) === b.bucket.start;
	const bandSeries = solds.length === 1 ? solds[0]! : null;

	const rows: ChartRow[] = [];
	for (const date of [...dates].filter(inRange).sort()) {
		const ts = ymdToTs(date);
		const averageCost = stepAt(avgPoints, date);
		const values: ChartRow["values"] = {};
		const margin: ChartRow["margin"] = {};
		const buckets: ChartRow["buckets"] = {};
		if (visible.has("averageCost")) values.averageCost = averageCost;
		const unset: ChartRow["unset"] = {};
		for (const l of lists) {
			const close = l.closes.get(date);
			if (close !== undefined) unset[l.key] = true;
			values[l.key] = close ?? stepAt(l.points, date);
		}
		for (const s of solds) {
			values[s.key] = sampleBuckets(
				s.points,
				adjacent,
				(p) => p.bucket.avg,
				date,
				ts
			);
			margin[s.key] = sampleBuckets(
				s.points,
				adjacent,
				(p) => p.margin,
				date,
				ts
			);
			const real = s.points.find((p) => p.date === date);
			if (real) buckets[s.key] = real.bucket;
		}
		let band: ChartRow["band"] = null;
		if (bandSeries) {
			const sample = (pick: (p: BucketPt) => number) =>
				sampleBuckets(bandSeries.points, adjacent, pick, date, ts);
			const lo = sample((p) => p.bucket.min);
			const hi = sample((p) => p.bucket.max);
			band = lo === null || hi === null ? null : [lo, hi];
		}
		const purchases = purchasesByDay.get(date) ?? [];
		const costs = [...new Set(purchases.map((p) => p.unitCost))];
		for (const purchaseCost of costs.length ? costs : [null])
			rows.push({
				ts,
				date,
				values,
				margin,
				band,
				averageCost,
				purchaseCost,
				purchases,
				buckets,
				unset,
			});
		// A second row on the unset day, with those tiers null: the step ends here instead of
		// running on to the tier's next price.
		const closed = Object.keys(unset) as SeriesKey[];
		if (closed.length) {
			const gap = { ...values };
			for (const k of closed) gap[k] = null;
			rows.push({ ...rows[rows.length - 1]!, values: gap, purchaseCost: null });
		}
	}
	return rows;
}

/**
 * Y domain fitted to the plotted values with ~8% padding, on 1/2/2.5/5 × 10^n ticks.
 * `includeZero` keeps the break-even line in view.
 */
export function niceDomain(
	values: number[],
	{ includeZero, tickCount = 5 }: { includeZero: boolean; tickCount?: number }
): { domain: [number, number]; ticks: number[] } {
	const finite = values.filter(Number.isFinite);
	if (includeZero) finite.push(0);
	if (finite.length === 0) return { domain: [0, 1], ticks: [0, 1] };
	let min = Math.min(...finite);
	let max = Math.max(...finite);
	const pad = max > min ? (max - min) * 0.08 : Math.max(Math.abs(max) * 0.05, 1);
	// Padding never crosses zero: prices stay non-negative, a 0 baseline stays the edge.
	min = min >= 0 ? Math.max(min - pad, 0) : min - pad;
	max = max <= 0 ? Math.min(max + pad, 0) : max + pad;
	const raw = (max - min) / (tickCount - 1);
	const mag = 10 ** Math.floor(Math.log10(raw));
	const step = ([1, 2, 2.5, 5, 10].find((m) => raw / mag <= m) ?? 10) * mag;
	const lo = Math.floor(min / step) * step;
	const hi = Math.ceil(max / step) * step;
	const ticks: number[] = [];
	// Rounded so 0.1 + 0.2 style drift never shows up in a tick label.
	for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
	return { domain: [ticks[0]!, ticks[ticks.length - 1]!], ticks };
}

/** Purchases or sales in range; list and average-cost snapshots alone do not count. */
export const hasActivity = (h: PriceHistory): boolean =>
	h.purchaseCost.length > 0 || h.soldPrices.some((s) => s.buckets.length > 0);
