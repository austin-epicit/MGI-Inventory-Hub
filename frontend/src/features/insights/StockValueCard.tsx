import { useMemo } from "react";
import {
	CartesianGrid,
	Line,
	LineChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { LineChart as LineChartIcon } from "lucide-react";
import LoadSvg from "../../assets/icons/loading.svg?react";
import {
	CHART_GRID,
	CHART_TICK,
	resolveTimeDomain,
	timeXAxis,
} from "../../components/charts/chartAxis";
import { ChartChip, ChartTooltipShell, QueryErrorState } from "../../components/charts/chartShared";
import Card from "../../components/ui/Card";
import EmptyState from "../../components/ui/EmptyState";
import { formatDate, formatMoney, formatMoneyCompact, formatQty, plural } from "../../lib/format";
import { useInsightsStock } from "./hooks";

const LINE_COLOR = "var(--color-chart-primary)";

type Point = { ts: number; value: number; units: number };

const tsToDate = (ts: number) => formatDate(new Date(ts).toISOString().slice(0, 10));

function ValueTooltip({ active, payload }: { active?: boolean; payload?: { payload: Point }[] }) {
	if (!active || !payload?.length) return null;
	const p = payload[0]!.payload;
	return (
		<ChartTooltipShell title={tsToDate(p.ts)}>
			<p className="text-sm font-semibold tabular-nums text-text-primary">
				{formatMoney(p.value)}
			</p>
			<p className="text-xs tabular-nums text-text-secondary">
				{formatQty(p.units)} {plural(p.units, "unit")}
			</p>
		</ChartTooltipShell>
	);
}

/** Daily stock value (on hand × average cost) from the recorded snapshots. */
export default function StockValueCard() {
	const { data, isLoading, error, refetch } = useInsightsStock();

	// `day` is a business date: UTC midnight keeps it on the same calendar day on the axis.
	const points: Point[] = useMemo(
		() =>
			(data?.valueHistory ?? [])
				.map((r) => ({
					ts: Date.parse(`${r.day}T00:00:00Z`),
					value: r.value,
					units: r.units,
				}))
				.sort((a, b) => a.ts - b.ts),
		[data]
	);

	let body;
	if (error) body = <QueryErrorState what="stock value" onRetry={() => void refetch()} />;
	else if (isLoading || !data)
		body = (
			<div
				className="flex h-[240px] flex-1 items-center justify-center"
				aria-label="Loading stock value"
			>
				<LoadSvg className="h-7 w-7" />
			</div>
		);
	else if (points.length < 2)
		body = (
			<EmptyState
				icon={<LineChartIcon size={26} />}
				title="Stock value is recorded once a day from the first sync"
			/>
		);
	else
		body = (
			<div className="relative min-h-[220px] flex-1">
				{/* Absolute fill: a percent height inside a flex item resolves to 0 in some engines. */}
				<div className="absolute inset-0">
					<ResponsiveContainer width="100%" height="100%">
						<LineChart
							data={points}
							margin={{
								top: 8,
								right: 16,
								left: 4,
								bottom: 0,
							}}
						>
							<CartesianGrid {...CHART_GRID} />
							<XAxis
								{...timeXAxis(
									resolveTimeDomain(points)
								)}
								tickFormatter={(v: number) =>
									tsToDate(v)
								}
							/>
							<YAxis
								axisLine={false}
								tickLine={false}
								tick={CHART_TICK}
								width={64}
								tickFormatter={(v: number) =>
									formatMoneyCompact(v)
								}
							/>
							<Tooltip
								content={<ValueTooltip />}
								cursor={{
									stroke: "var(--color-border-strong)",
								}}
							/>
							<Line
								type="monotone"
								dataKey="value"
								stroke={LINE_COLOR}
								strokeWidth={2}
								dot={false}
								activeDot={{
									r: 4,
									stroke: "var(--color-base)",
									strokeWidth: 2,
								}}
								isAnimationActive={false}
							/>
						</LineChart>
					</ResponsiveContainer>
				</div>
			</div>
		);

	return (
		<Card
			title="Stock value over time"
			headerAction={
				data?.trackingSince && points.length >= 2 ? (
					<ChartChip>
						Tracking since {formatDate(data.trackingSince)}
					</ChartChip>
				) : undefined
			}
		>
			{body}
		</Card>
	);
}
