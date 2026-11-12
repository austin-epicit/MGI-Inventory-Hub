import type { ReactNode } from "react";
import {
	Bar,
	BarChart,
	CartesianGrid,
	Line,
	LineChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { BarChart3 } from "lucide-react";
import LoadSvg from "../../assets/icons/loading.svg?react";
import { CHART_GRID, CHART_TICK, PERIOD_X_AXIS } from "../../components/charts/chartAxis";
import { ChartChip, ChartTooltipShell, QueryErrorState } from "../../components/charts/chartShared";
import Card from "../../components/ui/Card";
import EmptyState from "../../components/ui/EmptyState";
import { formatMoney, formatMoneyCompact } from "../../lib/format";
import type { PriceRange } from "../../types/priceHistory";
import type { InsightsTrend, InsightsTrendPoint } from "./api";
import { useInsightsTrend } from "./hooks";

const SALES_COLOR = "var(--color-chart-primary)";
const PURCHASES_COLOR = "var(--color-chart-warning)";
const MARGIN_COLOR = "var(--color-text-secondary)";
// Both plots reserve the same y-axis gutter so their x categories line up.
const Y_WIDTH = 64;
const MARGIN = { top: 8, right: 16, left: 4, bottom: 0 };
const SYNC_ID = "insights-trend";
// An explicit size (not maxBarSize) makes Recharts centre the Sales/Purchases pair in its band;
// with only a cap, each bar sits centred in its own half-band and the pair drifts apart.
const BAR_SIZE = 28;

const pct = (n: number | null) => (n == null ? "—" : `${n.toFixed(1)}%`);

function Swatch({ color }: { color: string }) {
	return (
		<span
			aria-hidden
			className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
			style={{ background: color }}
		/>
	);
}

function TrendTooltip({
	active,
	payload,
}: {
	active?: boolean;
	payload?: { payload: InsightsTrendPoint }[];
}) {
	if (!active || !payload?.length) return null;
	const p = payload[0]!.payload;
	const rows: { label: string; value: string; color?: string }[] = [
		{ label: "Sales", value: formatMoney(p.sales), color: SALES_COLOR },
		{ label: "Purchases", value: formatMoney(p.purchases), color: PURCHASES_COLOR },
		{ label: "Gross profit", value: formatMoney(p.grossProfit) },
		{ label: "Gross margin %", value: pct(p.grossMarginPct) },
	];
	return (
		<ChartTooltipShell title={p.label}>
			{rows.map((r) => (
				<p key={r.label} className="flex items-center gap-1.5 text-xs">
					{r.color ? (
						<Swatch color={r.color} />
					) : (
						<span className="w-2.5" />
					)}
					<span className="text-text-secondary">{r.label}</span>
					<span className="ml-auto pl-3 font-semibold tabular-nums text-text-primary">
						{r.value}
					</span>
				</p>
			))}
		</ChartTooltipShell>
	);
}

function TrendPlots({ trend }: { trend: InsightsTrend }) {
	return (
		<>
			<div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-secondary">
				<span className="inline-flex items-center gap-1.5">
					<Swatch color={SALES_COLOR} />
					Sales
				</span>
				<span className="inline-flex items-center gap-1.5">
					<Swatch color={PURCHASES_COLOR} />
					Purchases
				</span>
			</div>
			<div className="h-[240px]">
				<ResponsiveContainer width="100%" height="100%">
					<BarChart
						data={trend.points}
						margin={MARGIN}
						syncId={SYNC_ID}
						barGap={2}
					>
						<CartesianGrid {...CHART_GRID} />
						<XAxis {...PERIOD_X_AXIS} hide />
						<YAxis
							axisLine={false}
							tickLine={false}
							tick={CHART_TICK}
							width={Y_WIDTH}
							tickFormatter={(v: number) =>
								formatMoneyCompact(v)
							}
						/>
						<Tooltip
							content={<TrendTooltip />}
							cursor={{
								fill: "var(--color-surface-raised)",
								opacity: 0.6,
							}}
						/>
						<Bar
							dataKey="sales"
							name="Sales"
							fill={SALES_COLOR}
							radius={[4, 4, 0, 0]}
							barSize={BAR_SIZE}
							isAnimationActive={false}
						/>
						<Bar
							dataKey="purchases"
							name="Purchases"
							fill={PURCHASES_COLOR}
							radius={[4, 4, 0, 0]}
							barSize={BAR_SIZE}
							isAnimationActive={false}
						/>
					</BarChart>
				</ResponsiveContainer>
			</div>
			<div className="mt-3 border-t border-border-subtle pt-2 text-xs font-medium text-text-secondary">
				Gross margin %
			</div>
			<div className="h-[120px]">
				<ResponsiveContainer width="100%" height="100%">
					<LineChart
						data={trend.points}
						margin={MARGIN}
						syncId={SYNC_ID}
					>
						<CartesianGrid {...CHART_GRID} />
						<XAxis {...PERIOD_X_AXIS} />
						<YAxis
							axisLine={false}
							tickLine={false}
							tick={CHART_TICK}
							width={Y_WIDTH}
							tickCount={3}
							tickFormatter={(v: number) => `${v}%`}
						/>
						{/* The bar chart above shows the synced tooltip; this one only draws the cursor. */}
						<Tooltip
							content={() => null}
							cursor={{
								stroke: "var(--color-border-strong)",
							}}
						/>
						<Line
							dataKey="grossMarginPct"
							name="Gross margin %"
							stroke={MARGIN_COLOR}
							strokeWidth={2}
							dot={{
								r: 3,
								fill: MARGIN_COLOR,
								strokeWidth: 0,
							}}
							activeDot={{ r: 4 }}
							connectNulls={false}
							isAnimationActive={false}
						/>
					</LineChart>
				</ResponsiveContainer>
			</div>
		</>
	);
}

/**
 * Sales and purchases per period with gross margin % in its own strip below, on the same
 * periods: two plots rather than a dual axis.
 */
export default function TrendCard({
	range,
	headerAction,
}: {
	range: PriceRange;
	headerAction?: ReactNode;
}) {
	const { data, isLoading, error, refetch, isPlaceholderData } = useInsightsTrend(range);

	const chips = data && (
		<div className="flex flex-wrap items-center gap-1.5">
			<ChartChip>{`Sales ${formatMoney(data.totals.sales)}`}</ChartChip>
			<ChartChip>{`Purchases ${formatMoney(data.totals.purchases)}`}</ChartChip>
			<ChartChip>{`Gross margin ${pct(data.totals.grossMarginPct)}`}</ChartChip>
			{headerAction}
		</div>
	);

	let body;
	if (error)
		body = (
			<QueryErrorState
				what="sales and purchases"
				onRetry={() => void refetch()}
			/>
		);
	else if (isLoading || !data)
		body = (
			<div
				className="flex h-[300px] items-center justify-center"
				aria-label="Loading sales and purchases"
			>
				<LoadSvg className="h-7 w-7" />
			</div>
		);
	else if (data.points.every((p) => p.sales === 0 && p.purchases === 0))
		body = (
			<EmptyState
				icon={<BarChart3 size={26} />}
				title="No sales or purchases in this range"
				description={
					range === "all"
						? "Counted orders chart here once Cin7 has some."
						: "Pick a longer range to see older orders."
				}
			/>
		);
	else body = <TrendPlots trend={data} />;

	return (
		<Card
			title="Sales and purchases"
			headerAction={data && !error ? chips : headerAction}
		>
			<div
				className={`flex flex-1 flex-col transition-opacity duration-150 ease-out ${
					isPlaceholderData ? "opacity-40" : ""
				}`}
				aria-busy={isPlaceholderData}
			>
				{body}
			</div>
		</Card>
	);
}
