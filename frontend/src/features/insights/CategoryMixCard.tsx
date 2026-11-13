import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3 } from "lucide-react";
import LoadSvg from "../../assets/icons/loading.svg?react";
import { CHART_GRID, CHART_TICK, PERIOD_X_AXIS } from "../../components/charts/chartAxis";
import { ChartTooltipShell, QueryErrorState } from "../../components/charts/chartShared";
import Card from "../../components/ui/Card";
import EmptyState from "../../components/ui/EmptyState";
import SegmentedToggle from "../../components/ui/SegmentedToggle";
import { formatMoney, formatMoneyCompact, formatPercent } from "../../lib/format";
import type { PriceRange } from "../../types/priceHistory";
import { useInsightsTrend } from "./hooks";
import { mixColor, mixRows, type MixMode, type MixRow } from "./mixSeries";

const MODE_OPTIONS: { id: MixMode; label: string }[] = [
	{ id: "amount", label: "Amount" },
	{ id: "share", label: "Share" },
];

type Series = { key: string; color: string };

function Swatch({ color }: { color: string }) {
	return (
		<span
			aria-hidden
			className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
			style={{ background: color }}
		/>
	);
}

function MixTooltip({
	active,
	payload,
	series,
	mode,
}: {
	active?: boolean;
	payload?: { payload: MixRow }[];
	series: Series[];
	mode: MixMode;
}) {
	if (!active || !payload?.length) return null;
	const r = payload[0]!.payload;
	return (
		<ChartTooltipShell
			title={`${r.label} · ${mode === "amount" ? formatMoney(r.total) : "share of sales"}`}
		>
			{/* Top segment first, matching the stack's reading order. */}
			{[...series].reverse().map((s) => (
				<p key={s.key} className="flex items-center gap-1.5 text-xs">
					<Swatch color={s.color} />
					<span className="max-w-[180px] truncate text-text-secondary">
						{s.key}
					</span>
					<span className="ml-auto pl-3 font-semibold tabular-nums text-text-primary">
						{mode === "amount"
							? formatMoney(r.values[s.key] ?? 0)
							: formatPercent(r.values[s.key] ?? 0)}
					</span>
				</p>
			))}
		</ChartTooltipShell>
	);
}

/** Sales per period stacked by category: the top five, then Other, then Uncategorised. */
export default function CategoryMixCard({ range }: { range: PriceRange }) {
	const [mode, setMode] = useState<MixMode>("amount");
	const { data, isLoading, error, refetch, isPlaceholderData } = useInsightsTrend(range);

	const series: Series[] = useMemo(
		() => (data?.mixKeys ?? []).map((key, i) => ({ key, color: mixColor(key, i) })),
		[data]
	);
	const rows = useMemo(
		() => (data ? mixRows(data.points, data.mixKeys, mode) : []),
		[data, mode]
	);

	let body;
	if (error) body = <QueryErrorState what="the sales mix" onRetry={() => void refetch()} />;
	else if (isLoading || !data)
		body = (
			<div
				className="flex h-[300px] items-center justify-center"
				aria-label="Loading the sales mix"
			>
				<LoadSvg className="h-7 w-7" />
			</div>
		);
	else if (data.totals.sales === 0 || series.length === 0)
		body = (
			<EmptyState
				icon={<BarChart3 size={26} />}
				title="No sales in this range"
				description={
					range === "all"
						? "Counted orders show up here once Cin7 has some."
						: "Pick a longer range to see older orders."
				}
			/>
		);
	else
		body = (
			<>
				<ul className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-secondary">
					{series.map((s) => (
						<li
							key={s.key}
							className="inline-flex min-w-0 items-center gap-1.5"
						>
							<Swatch color={s.color} />
							<span
								className="max-w-[180px] truncate"
								title={s.key}
							>
								{s.key}
							</span>
						</li>
					))}
				</ul>
				<div className="h-[280px]">
					<ResponsiveContainer width="100%" height="100%">
						<BarChart
							data={rows}
							margin={{
								top: 8,
								right: 16,
								left: 4,
								bottom: 0,
							}}
							stackOffset={
								mode === "share" ? "expand" : "none"
							}
						>
							<CartesianGrid {...CHART_GRID} />
							<XAxis {...PERIOD_X_AXIS} />
							<YAxis
								axisLine={false}
								tickLine={false}
								tick={CHART_TICK}
								width={64}
								tickFormatter={(v: number) =>
									mode === "share"
										? formatPercent(
												v *
													100,
												{
													dp: 0,
												}
											)
										: formatMoneyCompact(
												v
											)
								}
							/>
							<Tooltip
								content={
									<MixTooltip
										series={series}
										mode={mode}
									/>
								}
								cursor={{
									fill: "var(--color-surface-raised)",
									opacity: 0.6,
								}}
							/>
							{series.map((s) => (
								<Bar
									key={s.key}
									dataKey={(r: MixRow) =>
										r.values[s.key] ?? 0
									}
									name={s.key}
									stackId="mix"
									fill={s.color}
									// A surface-coloured edge keeps a 2px gap between stacked segments.
									stroke="var(--color-base)"
									strokeWidth={2}
									maxBarSize={36}
									isAnimationActive={false}
								/>
							))}
						</BarChart>
					</ResponsiveContainer>
				</div>
			</>
		);

	return (
		<Card
			title="Sales mix by category"
			headerAction={
				<SegmentedToggle<MixMode>
					ariaLabel="Mix as"
					value={mode}
					options={MODE_OPTIONS}
					onChange={setMode}
				/>
			}
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
