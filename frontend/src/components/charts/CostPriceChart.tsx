import { useMemo, useState } from "react";
import {
	Area,
	CartesianGrid,
	ComposedChart,
	Line,
	ReferenceLine,
	ResponsiveContainer,
	Scatter,
	Tooltip,
	XAxis,
	YAxis,
	usePlotArea,
	useYAxisDomain,
} from "recharts";
import { LineChart, Minus, TrendingDown, TrendingUp } from "lucide-react";
import Card from "../ui/Card";
import EmptyState from "../ui/EmptyState";
import SegmentedToggle from "../ui/SegmentedToggle";
import LoadSvg from "../../assets/icons/loading.svg?react";
import { formatDate, formatMoney, formatMoneyCompact } from "../../lib/format";
import type { PriceHistory, PriceRange } from "../../types/priceHistory";
import { CHART_GRID, CHART_TICK, resolveTimeDomain, timeXAxis } from "./chartAxis";
import { stackLabels, valueToY, type LabelSlot } from "./chartLabels";
import { ChartChip, ChartTooltipShell, QueryErrorState } from "./chartShared";
import {
	assignTierSlots,
	canShow,
	COST_COLOR,
	defaultVisible,
	PRICE_RANGE_OPTIONS,
	hasActivity,
	seriesLabel,
	tierColor,
	tierOf,
	niceDomain,
	tiersOf,
	toChartRows,
	tsToYmd,
	ymdToTs,
	type ChartRow,
	type SeriesKey,
	type Tier,
} from "./costPriceSeries";

type Mode = "amounts" | "margin";

// Sold price is a per-period sample: dashed, so it never reads as a configured price.
const SOLD_DASH = "5 4";
const LABEL_MAX = 24;

type Swatch = "dot" | "line" | "dash";

interface SeriesStyle {
	key: SeriesKey;
	label: string;
	color: string;
	swatch: Swatch;
}

const styleOf = (key: SeriesKey, tiers: Tier[], slots: Map<string, number>): SeriesStyle => {
	const label = seriesLabel(key, tiers);
	if (key === "purchaseCost") return { key, label, color: COST_COLOR, swatch: "dot" };
	if (key === "averageCost") return { key, label, color: COST_COLOR, swatch: "line" };
	const color = tierColor(slots.get(tierOf(tiers, key)?.name ?? ""));
	return { key, label, color, swatch: key.startsWith("sold:") ? "dash" : "line" };
};

function SwatchIcon({ swatch, color }: { swatch: Swatch; color: string }) {
	if (swatch === "dot")
		return (
			<svg width="12" height="12" aria-hidden className="shrink-0">
				<circle
					cx="6"
					cy="6"
					r="4"
					fill="var(--color-base)"
					stroke={color}
					strokeWidth={1.5}
				/>
			</svg>
		);
	return (
		<svg width="16" height="8" aria-hidden className="shrink-0">
			<line
				x1="0"
				y1="4"
				x2="16"
				y2="4"
				stroke={color}
				strokeWidth={2}
				strokeDasharray={swatch === "dash" ? SOLD_DASH : undefined}
			/>
		</svg>
	);
}

// Chips double as the legend: each carries the mark it toggles.
function SeriesChip({
	style,
	on,
	disabled,
	onToggle,
}: {
	style: SeriesStyle;
	on: boolean;
	disabled: boolean;
	onToggle: () => void;
}) {
	return (
		<button
			type="button"
			aria-pressed={on}
			disabled={disabled}
			title={
				disabled
					? "Up to 4 tiers at once. Hide one to show this tier."
					: undefined
			}
			onClick={onToggle}
			className={`inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-xs font-medium transition-colors duration-150 ease-out ${
				on
					? "border-border bg-surface-raised text-text-primary"
					: disabled
						? "cursor-not-allowed border-border-subtle text-text-faint opacity-60"
						: "cursor-pointer border-border-subtle text-text-muted hover:text-text-secondary"
			}`}
		>
			<span className={on ? "" : "opacity-40"}>
				<SwatchIcon swatch={style.swatch} color={style.color} />
			</span>
			{style.label}
		</button>
	);
}

/** A series' final value plus the stroke that identifies it in the label column. */
type EndSeries = { key: string; label: string; color: string; dash?: string; value: number };

const clip = (s: string) => (s.length > LABEL_MAX ? `${s.slice(0, LABEL_MAX - 1)}…` : s);

/**
 * All series labels in one right-margin column, stacked so they can't overlap: list and sold
 * prices of a tier often end within a few dollars of each other.
 */
function EndLabelColumn({ series }: { series: EndSeries[] }) {
	const plot = usePlotArea();
	const domain = useYAxisDomain();
	if (!plot || series.length === 0) return null;
	const numeric =
		Array.isArray(domain) && domain.length === 2 && typeof domain[0] === "number"
			? ([domain[0], domain[1]] as [number, number])
			: null;
	if (!numeric) return null;
	const anchored = series
		.map((s) => {
			const y = valueToY(s.value, numeric, plot);
			return y == null
				? null
				: ({
						key: s.key,
						label: s.label,
						color: s.color,
						dash: s.dash,
						y,
					} as LabelSlot);
		})
		.filter((s): s is LabelSlot => s !== null);
	if (anchored.length === 0) return null;
	const slots = stackLabels(anchored, {
		minGap: 13,
		top: plot.y + 4,
		bottom: plot.y + plot.height - 4,
	});
	const x = plot.x + plot.width + 8;
	return (
		<g className="pointer-events-none">
			{slots.map((s) => (
				<g key={s.key}>
					<line
						x1={x}
						y1={s.y}
						x2={x + 12}
						y2={s.y}
						stroke={s.color}
						strokeWidth={2}
						strokeDasharray={s.dash}
					/>
					<text
						x={x + 17}
						y={s.y}
						dy={4}
						fontSize={11}
						fill="var(--color-chart-axis)"
					>
						{clip(s.label)}
					</text>
				</g>
			))}
		</g>
	);
}

// Hollow so a purchase never reads as a point on the average-cost line it feeds.
function ReceiptDot({ cx, cy }: { cx?: number; cy?: number }) {
	if (cx == null || cy == null) return null;
	return (
		<circle
			cx={cx}
			cy={cy}
			r={4}
			fill="var(--color-base)"
			stroke={COST_COLOR}
			strokeWidth={1.5}
		/>
	);
}

const signedMoney = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${formatMoney(Math.abs(n))}`;

function TrendTooltip({
	active,
	payload,
	mode,
	styles,
}: {
	active?: boolean;
	payload?: { payload: ChartRow }[];
	mode: Mode;
	styles: SeriesStyle[];
}) {
	if (!active || !payload?.length) return null;
	const d = payload[0]!.payload;
	const lines: { key: string; label: string; value: string; style: SeriesStyle }[] = [];
	for (const s of styles) {
		if (mode === "margin") {
			const b = d.buckets[s.key];
			const m = d.margin[s.key];
			if (b && m != null)
				lines.push({
					key: s.key,
					label: `Margin — ${s.label.replace("Sold price — ", "")}`,
					value: signedMoney(m),
					style: s,
				});
			continue;
		}
		if (s.key === "purchaseCost") continue; // listed per order below
		if (s.key.startsWith("sold:")) {
			const b = d.buckets[s.key];
			if (b)
				lines.push({
					key: s.key,
					label: s.label,
					value: [
						formatMoney(b.avg),
						...(b.min < b.max
							? [
									`${formatMoney(b.min)}–${formatMoney(b.max)}`,
								]
							: []),
						`${b.units} sold`,
					].join(" · "),
					style: s,
				});
			continue;
		}
		if (d.unset[s.key]) {
			lines.push({ key: s.key, label: s.label, value: "Not set", style: s });
			continue;
		}
		const v = d.values[s.key];
		if (v != null)
			lines.push({ key: s.key, label: s.label, value: formatMoney(v), style: s });
	}
	const purchases = mode === "amounts" ? d.purchases : [];
	if (lines.length === 0 && purchases.length === 0) return null;
	return (
		<ChartTooltipShell title={formatDate(d.date)}>
			{lines.map((l) => (
				<p key={l.key} className="flex items-center gap-1.5 text-xs">
					<SwatchIcon swatch={l.style.swatch} color={l.style.color} />
					<span className="text-text-secondary">{l.label}</span>
					<span className="font-semibold tabular-nums text-text-primary">
						{l.value}
					</span>
				</p>
			))}
			{purchases.map((p) => (
				<p
					key={`${p.purchaseId}-${p.unitCost}`}
					className="mt-0.5 flex items-center gap-1.5 text-xs"
				>
					<SwatchIcon swatch="dot" color={COST_COLOR} />
					<span className="text-text-secondary">
						{p.orderNumber} · {p.supplier} · {p.qty} @
					</span>
					<span className="font-semibold tabular-nums text-text-primary">
						{formatMoney(p.unitCost)}
					</span>
				</p>
			))}
		</ChartTooltipShell>
	);
}

// Where a number stands now, and which way it moved across the range.
function HeadlineStat({
	label,
	value,
	deltaPct,
	invertTone,
	sub,
}: {
	label: string;
	value: string;
	deltaPct?: number | null;
	// Rising cost is bad news; tone follows meaning, not sign.
	invertTone?: boolean;
	sub?: string | null;
}) {
	const hasDelta = deltaPct != null;
	const flat = hasDelta && Math.abs(deltaPct) < 0.05;
	const good = hasDelta && (invertTone ? deltaPct < 0 : deltaPct > 0);
	const DeltaIcon = flat ? Minus : hasDelta && deltaPct > 0 ? TrendingUp : TrendingDown;
	const tone = flat ? "text-text-muted" : good ? "text-success-text" : "text-error-text";
	return (
		<div>
			<div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
				{label}
			</div>
			<div className="mt-0.5 flex items-baseline gap-2">
				<span className="text-lg font-bold leading-tight tabular-nums text-text-primary">
					{value}
				</span>
				{hasDelta && (
					<span
						className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${tone}`}
					>
						<DeltaIcon size={11} />
						{flat
							? "no change"
							: `${deltaPct > 0 ? "+" : ""}${deltaPct.toFixed(1)}%`}
					</span>
				)}
			</div>
			{sub && <div className="mt-0.5 text-[11px] text-text-faint">{sub}</div>}
		</div>
	);
}

function HeadlineStrip({ stats }: { stats: PriceHistory["stats"] }) {
	const money = (n: number | null) => (n == null ? "—" : formatMoney(n));
	return (
		<div className="mb-3 flex flex-wrap gap-x-8 gap-y-3 border-b border-border-subtle pb-3">
			<HeadlineStat
				label="Last purchase cost"
				value={money(stats.lastPurchaseCost)}
				deltaPct={stats.purchaseCostChangePct}
				invertTone
				sub={
					stats.purchaseCostChangePct != null
						? "vs first purchase in range"
						: null
				}
			/>
			<HeadlineStat label="Average cost" value={money(stats.averageCost)} />
			<HeadlineStat label="Avg sold price" value={money(stats.avgSoldPrice)} />
			<HeadlineStat
				label="Margin"
				value={
					stats.marginPct == null
						? "—"
						: `${stats.marginPct.toFixed(1)}%`
				}
			/>
		</div>
	);
}

function ChartBody({ history, mode }: { history: PriceHistory; mode: Mode }) {
	const tiers = useMemo(() => tiersOf(history), [history]);
	const [visible, setVisible] = useState(() => defaultVisible(history));
	const [slots, setSlots] = useState(() =>
		assignTierSlots(tiers, defaultVisible(history), new Map())
	);
	const toggle = (key: SeriesKey) => {
		const next = new Set(visible);
		if (next.has(key)) next.delete(key);
		else if (canShow(tiers, visible, key)) next.add(key);
		else return;
		setVisible(next);
		setSlots(assignTierSlots(tiers, next, slots));
	};

	const rows = useMemo(() => toChartRows(history, visible), [history, visible]);
	const { from, to } = history.range;
	const domain = resolveTimeDomain(
		rows,
		from < to ? [ymdToTs(from), ymdToTs(to)] : undefined
	);

	const allKeys: SeriesKey[] = [
		"purchaseCost",
		"averageCost",
		...tiers.flatMap((t) =>
			[t.listKey, t.soldKey].filter((k): k is SeriesKey => k !== null)
		),
	];
	const styles = allKeys.map((k) => styleOf(k, tiers, slots));
	const shown = styles.filter((s) => visible.has(s.key));
	const soldShown = shown.filter((s) => s.key.startsWith("sold:"));
	// Margin plots sold prices only; the other chips would toggle nothing there.
	const soldStyles = styles.filter((s) => s.key.startsWith("sold:"));
	const bandStyle = soldShown.length === 1 ? soldShown[0]! : null;

	const lastValue = (pick: (r: ChartRow) => number | null | undefined) => {
		for (let i = rows.length - 1; i >= 0; i--) {
			const v = pick(rows[i]!);
			if (v != null) return v;
		}
		return null;
	};
	// Purchase dots have no line end to label; their chip names them.
	const ends: EndSeries[] = (mode === "amounts" ? shown : soldShown)
		.filter((s) => s.key !== "purchaseCost")
		.map((s): EndSeries | null => {
			const value =
				mode === "margin"
					? lastValue((r) =>
							r.buckets[s.key] ? r.margin[s.key] : null
						)
					: s.key.startsWith("sold:")
						? lastValue((r) => r.buckets[s.key]?.avg)
						: lastValue((r) => r.values[s.key]);
			return value == null
				? null
				: {
						key: s.key,
						label:
							mode === "margin"
								? s.label.replace(
										"Sold price",
										"Margin"
									)
								: s.label,
						color: s.color,
						dash: s.swatch === "dash" ? SOLD_DASH : undefined,
						value,
					};
		})
		.filter((s): s is EndSeries => s !== null);

	const tracking = history.listTrackingStartedAt;
	const showTracking =
		mode === "amounts" && tracking !== null && tracking >= from && tracking <= to;
	// Fitted to what is plotted: a $1.4K product moving by $80 must not be a flat band at the top.
	const yValues =
		mode === "margin"
			? rows.flatMap((r) => soldShown.map((s) => r.margin[s.key] ?? NaN))
			: rows.flatMap((r) => [
					...shown.map((s) => r.values[s.key] ?? NaN),
					r.purchaseCost ?? NaN,
					...(r.band ?? []),
				]);
	const y = niceDomain(yValues, { includeZero: mode === "margin" });

	const soldDot = (s: SeriesStyle, pick: (r: ChartRow) => number | null) =>
		function Dot(props: {
			cx?: number;
			cy?: number;
			index?: number;
			payload?: ChartRow;
		}) {
			const real = props.payload?.buckets[s.key] && pick(props.payload) != null;
			if (!real || props.cx == null || props.cy == null)
				return <g key={`${s.key}-${props.index}`} />;
			return (
				<circle
					key={`${s.key}-${props.index}`}
					cx={props.cx}
					cy={props.cy}
					r={3}
					fill={s.color}
					strokeWidth={0}
				/>
			);
		};

	const valueOf = (k: SeriesKey) => (r: ChartRow) => r.values[k] ?? null;
	const marginOf = (k: SeriesKey) => (r: ChartRow) => r.margin[k] ?? null;
	const soldLine = (s: SeriesStyle, pick: (r: ChartRow) => number | null) => (
		<Line
			key={s.key}
			type="linear"
			dataKey={pick}
			stroke={s.color}
			strokeWidth={1.5}
			strokeDasharray={SOLD_DASH}
			dot={soldDot(s, pick)}
			activeDot={false}
			isAnimationActive={false}
		/>
	);
	const stepLine = (s: SeriesStyle) => (
		<Line
			key={s.key}
			type="stepAfter"
			dataKey={valueOf(s.key)}
			stroke={s.color}
			strokeWidth={2}
			dot={false}
			activeDot={{ r: 3 }}
			isAnimationActive={false}
		/>
	);

	const amountMarks = [
		// First, so it sits behind every line; a period without sales breaks it like the line.
		bandStyle && (
			<Area
				key="band"
				type="linear"
				dataKey={(r: ChartRow) => r.band}
				stroke="none"
				fill={bandStyle.color}
				fillOpacity={0.14}
				isAnimationActive={false}
				activeDot={false}
				legendType="none"
			/>
		),
		showTracking && (
			<ReferenceLine
				key="tracking"
				x={ymdToTs(tracking)}
				stroke="var(--color-border-strong)"
				strokeDasharray="3 3"
				label={{
					value: "List price tracking began",
					// Above the plot, in the top margin, so it can never sit on a series.
					position: "top",
					fill: "var(--color-chart-axis)",
					fontSize: 11,
				}}
			/>
		),
		...shown
			.filter((s) => s.key !== "purchaseCost")
			.map((s) =>
				s.swatch === "dash" ? soldLine(s, valueOf(s.key)) : stepLine(s)
			),
		visible.has("purchaseCost") && (
			<Scatter
				key="purchases"
				dataKey={(r: ChartRow) => r.purchaseCost}
				shape={<ReceiptDot />}
				fill={COST_COLOR}
				isAnimationActive={false}
			/>
		),
	];
	const marginMarks = [
		// Always in view: selling below cost has to cross a line, not just sit lower.
		<ReferenceLine
			key="break-even"
			y={0}
			stroke="var(--color-border-strong)"
			ifOverflow="extendDomain"
			label={{
				value: "break-even",
				position: "insideBottomLeft",
				fill: "var(--color-chart-axis)",
				fontSize: 11,
			}}
		/>,
		...soldShown.map((s) => soldLine(s, marginOf(s.key))),
	];

	return (
		<>
			<div className="mb-2 flex flex-wrap items-center gap-1.5">
				{(mode === "amounts" ? styles : soldStyles).map((s) => (
					<SeriesChip
						key={s.key}
						style={s}
						on={visible.has(s.key)}
						disabled={
							!visible.has(s.key) &&
							!canShow(tiers, visible, s.key)
						}
						onToggle={() => toggle(s.key)}
					/>
				))}
				{mode === "amounts" && history.listPrices.length === 0 && (
					<ChartChip>No list prices set in Cin7</ChartChip>
				)}
				{mode === "margin" && soldShown.length === 0 && (
					<ChartChip>Show a sold price to plot its margin</ChartChip>
				)}
			</div>
			<div className="min-h-[300px] flex-1">
				<ResponsiveContainer width="100%" height="100%" minHeight={260}>
					<ComposedChart
						data={rows}
						margin={{ top: 22, right: 172, left: 4, bottom: 6 }}
					>
						<CartesianGrid {...CHART_GRID} />
						<XAxis
							{...timeXAxis(domain)}
							tickFormatter={(v: number) =>
								formatDate(tsToYmd(v))
							}
						/>
						<YAxis
							axisLine={false}
							tickLine={false}
							tick={CHART_TICK}
							width={64}
							domain={y.domain}
							ticks={y.ticks}
							tickFormatter={(v: number) =>
								formatMoneyCompact(v)
							}
						/>
						<Tooltip
							content={
								<TrendTooltip
									mode={mode}
									styles={shown}
								/>
							}
							cursor={{
								stroke: "var(--color-border-strong)",
							}}
						/>
						{mode === "amounts" ? amountMarks : marginMarks}
						<EndLabelColumn series={ends} />
					</ComposedChart>
				</ResponsiveContainer>
			</div>
			{mode === "amounts" && bandStyle && (
				<div className="flex items-center gap-1.5 pt-2 text-xs text-text-tertiary">
					<svg width="16" height="8" aria-hidden>
						<rect
							x="0"
							y="1"
							width="16"
							height="6"
							fill={bandStyle.color}
							opacity={0.14}
						/>
					</svg>
					Lowest to highest sold price per {history.bucket}
				</div>
			)}
		</>
	);
}

/**
 * Cost & price over time for one product. Purchase cost is a dot per order; average and list
 * prices are steps (a configured amount holds until it changes); sold prices are per-period
 * averages drawn straight, broken where a period had no sales.
 */
export default function CostPriceChart({
	history,
	isLoading,
	error,
	onRetry,
	range,
	onRangeChange,
	isStale = false,
	className = "",
}: {
	history: PriceHistory | undefined;
	isLoading: boolean;
	/** Showing the previous range while the chosen one loads. */
	isStale?: boolean;
	className?: string;
	error: Error | null;
	onRetry: () => void;
	range: PriceRange;
	onRangeChange: (r: PriceRange) => void;
}) {
	const [mode, setMode] = useState<Mode>("amounts");
	const canShowMargin =
		!!history &&
		history.averageCost.length > 0 &&
		history.soldPrices.some((s) => s.buckets.length > 0);
	const effectiveMode: Mode = mode === "margin" && canShowMargin ? "margin" : "amounts";

	const header = (
		<div className="flex flex-wrap items-center gap-2">
			<SegmentedToggle<Mode>
				ariaLabel="Chart mode"
				value={effectiveMode}
				onChange={setMode}
				options={[
					{ id: "amounts", label: "Amounts" },
					{
						id: "margin",
						label: "Margin",
						disabled: !canShowMargin,
						title: canShowMargin
							? "Sold price minus average cost"
							: "Needs sales and an average cost in this range",
					},
				]}
			/>
			<SegmentedToggle<PriceRange>
				ariaLabel="History range"
				value={range}
				onChange={onRangeChange}
				options={PRICE_RANGE_OPTIONS}
			/>
		</div>
	);

	let body;
	if (error) body = <QueryErrorState what="price history" onRetry={onRetry} />;
	else if (isLoading || !history)
		body = (
			<div
				className="flex h-[300px] items-center justify-center"
				aria-label="Loading price history"
			>
				<LoadSvg className="h-7 w-7" />
			</div>
		);
	else if (!hasActivity(history))
		body = (
			<EmptyState
				icon={<LineChart size={26} />}
				title="No purchases or sales in this range"
				description={
					range === "all"
						? "Purchase and sales orders for this product chart here once Cin7 has some."
						: "Pick a longer range to see older orders."
				}
			/>
		);
	else
		body = (
			<>
				<HeadlineStrip stats={history.stats} />
				{/* Toggles and hues start over per range: the default tiers are the range's best sellers. */}
				<ChartBody
					key={`${history.range.from}:${history.range.to}:${history.bucket}`}
					history={history}
					mode={effectiveMode}
				/>
			</>
		);

	return (
		<Card title="Cost & price" headerAction={header} className={className}>
			{/* The old range stays dimmed under a spinner: never passed off as the new one. */}
			<div className="relative flex flex-1 flex-col" aria-busy={isStale}>
				<div
					className={`flex flex-1 flex-col transition-opacity duration-150 ease-out ${
						isStale ? "pointer-events-none opacity-40" : ""
					}`}
				>
					{body}
				</div>
				{isStale && (
					<div
						className="absolute inset-0 flex items-center justify-center"
						aria-label="Loading price history"
					>
						<LoadSvg className="h-7 w-7" />
					</div>
				)}
			</div>
		</Card>
	);
}
