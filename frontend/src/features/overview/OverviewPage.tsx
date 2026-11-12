import { Link, useSearchParams } from "react-router-dom";
import { ClipboardList, TrendingDown, TrendingUp } from "lucide-react";
import { PRICE_RANGE_OPTIONS } from "../../components/charts/costPriceSeries";
import Card from "../../components/ui/Card";
import EmptyState from "../../components/ui/EmptyState";
import OrderStatusPill from "../../components/ui/OrderStatusPill";
import PageHeader from "../../components/ui/PageHeader";
import ReportState from "../../components/ui/ReportState";
import SegmentedToggle from "../../components/ui/SegmentedToggle";
import StatCard from "../../components/ui/StatCard";
import Thumb from "../../components/ui/Thumb";
import { formatDate, formatDateTime, formatMoney, formatQty } from "../../lib/format";
import type { PriceRange } from "../../types/priceHistory";
import type { CostMover, RecentOrder } from "./api";
import TrendCard from "../insights/TrendCard";
import { useOverview } from "./hooks";

const DEFAULT_RANGE: PriceRange = "30d";
const RANGE_PHRASE: Record<PriceRange, string> = {
	"30d": "Last 30 days",
	"90d": "Last 90 days",
	"6m": "Last 6 months",
	"1y": "Last 12 months",
	all: "All time",
};

// Rising cost is bad news, so it takes the error tone; tone follows meaning, not sign.
function ChangeCell({ pct }: { pct: number }) {
	const flat = Math.abs(pct) < 0.05;
	const Icon = pct > 0 ? TrendingUp : TrendingDown;
	const tone = flat ? "text-text-muted" : pct > 0 ? "text-error-text" : "text-success-text";
	return (
		<span
			className={`inline-flex items-center gap-1 font-semibold tabular-nums ${tone}`}
		>
			{!flat && <Icon size={12} />}
			{pct > 0 ? "+" : ""}
			{pct.toFixed(1)}%
		</span>
	);
}

function CostMovers({ movers }: { movers: CostMover[] }) {
	if (movers.length === 0)
		return (
			<EmptyState
				title="No cost changes to show"
				description="A product appears once it has two purchases in the last 180 days."
			/>
		);
	return (
		<table className="w-full text-left text-[13px]">
			<thead>
				<tr className="border-b border-border-subtle text-xs text-text-muted">
					<th className="px-4 py-2 font-medium">Product</th>
					<th className="px-2 py-2 text-right font-medium">
						Prior avg
					</th>
					<th className="px-2 py-2 text-right font-medium">
						Last cost
					</th>
					<th className="px-4 py-2 text-right font-medium">Change</th>
				</tr>
			</thead>
			<tbody>
				{movers.map((m) => (
					<tr
						key={m.productId}
						className="border-b border-border-subtle last:border-b-0 hover:bg-surface"
					>
						<td className="px-4 py-2">
							<Link
								to={`/products/${m.productId}`}
								className="flex items-center gap-3 text-text-link hover:underline"
							>
								<Thumb
									url={m.thumbUrl}
									name={m.name}
								/>
								<span className="min-w-0">
									<span className="block truncate font-medium">
										{m.name}
									</span>
									<span className="block text-xs text-text-muted">
										{m.sku}
									</span>
								</span>
							</Link>
						</td>
						<td className="px-2 py-2 text-right tabular-nums text-text-muted">
							{formatMoney(m.priorAvgCost)}
						</td>
						<td className="px-2 py-2 text-right tabular-nums">
							{formatMoney(m.lastCost)}
						</td>
						<td className="px-4 py-2 text-right">
							<ChangeCell pct={m.changePct} />
						</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}

function RecentOrders({
	orders,
	basePath,
	empty,
}: {
	orders: RecentOrder[];
	basePath: "/purchases" | "/sales";
	empty: string;
}) {
	if (orders.length === 0)
		return <EmptyState icon={<ClipboardList size={32} />} title={empty} />;
	return (
		<ul>
			{orders.map((o) => (
				<li
					key={o.id}
					className="border-b border-border-subtle last:border-b-0"
				>
					<Link
						to={`${basePath}/${o.id}`}
						className="flex items-center gap-3 px-4 py-2 text-[13px] hover:bg-surface"
					>
						<span className="min-w-0 flex-1">
							<span className="block font-medium text-text-link">
								{o.orderNumber}
							</span>
							<span className="block truncate text-xs text-text-muted">
								{o.party}
								{o.orderDate
									? ` · ${formatDate(o.orderDate)}`
									: ""}
							</span>
						</span>
						<OrderStatusPill status={o.status} />
						<span className="w-24 text-right tabular-nums">
							{formatMoney(o.totalBase)}
						</span>
					</Link>
				</li>
			))}
		</ul>
	);
}

export default function OverviewPage() {
	const [searchParams, setSearchParams] = useSearchParams();
	const rangeParam = searchParams.get("range");
	const range: PriceRange = PRICE_RANGE_OPTIONS.some((r) => r.id === rangeParam)
		? (rangeParam as PriceRange)
		: DEFAULT_RANGE;
	// Kept in the URL so a refresh or shared link shows the same range; replace, not push.
	const setRange = (next: PriceRange) => {
		const params = new URLSearchParams(searchParams);
		if (next === DEFAULT_RANGE) params.delete("range");
		else params.set("range", next);
		setSearchParams(params, { replace: true });
	};

	const { data, isLoading, error } = useOverview(range);
	const phrase = RANGE_PHRASE[range];

	return (
		<div className="text-text-primary">
			<PageHeader
				title="Overview"
				subtitle={
					data && (
						<span className="text-xs text-text-muted">
							{data.lastSyncAt
								? `Last synced ${formatDateTime(data.lastSyncAt)}`
								: "Not synced yet"}
						</span>
					)
				}
			>
				<SegmentedToggle
					ariaLabel="Date range"
					value={range}
					options={PRICE_RANGE_OPTIONS}
					onChange={setRange}
				/>
			</PageHeader>
			<ReportState
				loading={isLoading}
				error={error}
				errorMessage="Could not load the overview"
				skeleton={
					<div className="h-64 animate-pulse rounded-lg bg-surface" />
				}
			>
				{data && (
					<div className="space-y-4">
						<div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
							<StatCard
								label="Stock value"
								value={formatMoney(
									data.kpis.stockValue
								)}
								hint="On hand × average cost, now"
							/>
							<StatCard
								label="Units on hand"
								value={formatQty(
									data.kpis.unitsOnHand
								)}
								hint="All locations, now"
							/>
							<StatCard
								label="Sales"
								value={formatMoney(data.kpis.sales)}
								hint={phrase}
							/>
							<StatCard
								label="Purchases"
								value={formatMoney(
									data.kpis.purchases
								)}
								hint={phrase}
							/>
							<StatCard
								label="Gross margin"
								value={
									data.kpis.grossMarginPct ==
									null
										? "—"
										: `${data.kpis.grossMarginPct.toFixed(1)}%`
								}
								hint={phrase}
							/>
						</div>
						<TrendCard
							range={range}
							headerAction={
								<Link
									to={`/insights?range=${range}`}
									className="text-xs text-text-link hover:underline"
								>
									View insights
								</Link>
							}
						/>
						<div className="grid gap-4 lg:grid-cols-2">
							<Card
								title="Biggest cost changes"
								flush
								headerAction={
									<span className="text-xs text-text-muted">
										Last cost vs earlier
										purchases, 180 days
									</span>
								}
							>
								<CostMovers
									movers={data.costMovers}
								/>
							</Card>
							<div className="space-y-4">
								<Card
									title="Recent purchases"
									flush
								>
									<RecentOrders
										orders={
											data.recentPurchases
										}
										basePath="/purchases"
										empty="No purchases yet"
									/>
								</Card>
								<Card title="Recent sales" flush>
									<RecentOrders
										orders={
											data.recentSales
										}
										basePath="/sales"
										empty="No sales yet"
									/>
								</Card>
							</div>
						</div>
					</div>
				)}
			</ReportState>
		</div>
	);
}
