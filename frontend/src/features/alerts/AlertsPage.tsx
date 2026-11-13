import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { CircleCheck } from "lucide-react";
import LoadSvg from "../../assets/icons/loading.svg?react";
import { useAuth } from "../../auth/store";
import { QueryErrorState } from "../../components/charts/chartShared";
import Card from "../../components/ui/Card";
import EmptyState from "../../components/ui/EmptyState";
import { HEADER_BTN_SECONDARY } from "../../components/ui/headerActions";
import PageHeader from "../../components/ui/PageHeader";
import SegmentedToggle from "../../components/ui/SegmentedToggle";
import Thumb from "../../components/ui/Thumb";
import { useToast } from "../../hooks/useToast";
import { ApiError } from "../../lib/api";
import { formatDate, formatMoney, formatQty } from "../../lib/format";
import type { CostAlert, SlowAlert } from "./api";
import { useAlerts, useDismissAlert, useRestoreAlert } from "./hooks";

const TH_BASE = "px-2 py-1.5 font-medium text-text-muted whitespace-nowrap";
const TH = `${TH_BASE} text-right`;
const TH_LEFT = `${TH_BASE} text-left`;
const TD = "px-2 py-1.5 text-right tabular-nums whitespace-nowrap";

// A real minus sign so the figure lines up with the "+" and reads as a number, not a hyphen.
const formatSignedPct = (pct: number): string => {
	const sign = pct > 0 ? "+" : pct < 0 ? "−" : "";
	return `${sign}${Math.abs(pct).toFixed(1)}%`;
};

function ProductCell({
	productId,
	name,
	thumbUrl,
	detail,
}: {
	productId: string;
	name: string;
	thumbUrl: string | null;
	detail: string;
}) {
	return (
		<div className="flex min-w-0 items-center gap-2">
			<Thumb url={thumbUrl} name={name} />
			<div className="min-w-0 leading-tight">
				<Link
					to={`/products/${productId}`}
					className="line-clamp-2 break-words text-primary-text hover:underline"
					title={name}
				>
					{name}
				</Link>
				<span className="block break-words text-xs text-text-muted">
					{detail}
				</span>
			</div>
		</div>
	);
}

function RowAction({ alertKey, dismissed }: { alertKey: string; dismissed: boolean }) {
	const dismiss = useDismissAlert();
	const restore = useRestoreAlert();
	const toast = useToast();
	const m = dismissed ? restore : dismiss;
	const run = () =>
		m.mutate(alertKey, {
			onError: (err) =>
				toast.error(
					err instanceof ApiError && err.status !== 400
						? `Could not ${dismissed ? "restore" : "dismiss"} this alert. Try again.`
						: "Could not reach the server. Try again."
				),
		});
	return (
		<button
			type="button"
			className={HEADER_BTN_SECONDARY}
			disabled={m.isPending}
			onClick={run}
		>
			{dismissed ? "Restore" : "Dismiss"}
		</button>
	);
}

function Footer({ rule }: { rule: string }) {
	const isAdmin = useAuth((s) => s.user?.role === "admin");
	return (
		<p className="mt-3 border-t border-border-subtle pt-2 text-xs text-text-muted">
			{rule}
			{isAdmin && (
				<Link
					to="/settings#alerts-settings"
					className="ml-2 text-primary-text hover:underline"
				>
					Change thresholds
				</Link>
			)}
		</p>
	);
}

function AlertCard({
	title,
	rows,
	empty,
	rule,
	head,
	children,
}: {
	title: string;
	rows: number;
	empty: string;
	rule: string;
	head: ReactNode;
	children: ReactNode;
}) {
	return (
		<Card title={title}>
			{rows === 0 ? (
				<EmptyState
					icon={<CircleCheck size={26} />}
					title="Nothing to review"
					description={empty}
				/>
			) : (
				<div className="overflow-x-auto text-[13px]">
					<table className="w-full" aria-label={title}>
						<thead>
							<tr>{head}</tr>
						</thead>
						<tbody>{children}</tbody>
					</table>
				</div>
			)}
			<Footer rule={rule} />
		</Card>
	);
}

const rowClass = (dismissed: boolean) =>
	`border-t border-border-subtle${dismissed ? " opacity-60" : ""}`;

const ActionHead = () => (
	<th className={TH}>
		<span className="sr-only">Action</span>
	</th>
);

function CostRow({ r }: { r: CostAlert }) {
	return (
		<tr className={rowClass(r.dismissed)}>
			<td className="w-full min-w-48 max-w-0 px-2 py-1.5 text-left">
				<ProductCell
					productId={r.productId}
					name={r.name}
					thumbUrl={r.thumbUrl}
					detail={r.sku}
				/>
			</td>
			<td className="px-2 py-1.5 text-left whitespace-nowrap">
				<span className="block">{r.supplierName}</span>
				<Link
					to={`/purchases/${r.purchaseId}`}
					className="text-xs text-primary-text hover:underline"
				>
					{r.orderNumber}
				</Link>
				<span className="text-xs text-text-muted">
					{" "}
					· {formatDate(r.latestDate)}
				</span>
			</td>
			<td className={TD}>
				{formatMoney(r.previousCost)} → {formatMoney(r.latestCost)}
			</td>
			<td className={`${TD} font-medium`}>{formatSignedPct(r.changePct)}</td>
			<td className="px-2 py-1.5 text-right">
				<RowAction alertKey={r.key} dismissed={r.dismissed} />
			</td>
		</tr>
	);
}

const slowDetail = (r: SlowAlert): string =>
	`${r.sku} · ${formatQty(r.onHand)} on hand · ${
		r.lastSold
			? `last sold ${formatDate(r.lastSold)} (${r.daysSinceSale ?? 0} days ago)`
			: "Never sold"
	}`;

function SlowRow({ r }: { r: SlowAlert }) {
	return (
		<tr className={rowClass(r.dismissed)}>
			<td className="w-full min-w-48 max-w-0 px-2 py-1.5 text-left">
				<ProductCell
					productId={r.productId}
					name={r.name}
					thumbUrl={r.thumbUrl}
					detail={slowDetail(r)}
				/>
			</td>
			<td className={TD}>{formatMoney(r.value)}</td>
			<td className="px-2 py-1.5 text-right">
				<RowAction alertKey={r.key} dismissed={r.dismissed} />
			</td>
		</tr>
	);
}

export default function AlertsPage() {
	const [showDismissed, setShowDismissed] = useState(false);
	const { data, isLoading, error, refetch } = useAlerts();

	let body;
	if (error) body = <QueryErrorState what="alerts" onRetry={() => void refetch()} />;
	else if (isLoading || !data)
		body = (
			<div
				className="flex h-[240px] items-center justify-center"
				aria-label="Loading alerts"
			>
				<LoadSvg className="h-7 w-7" />
			</div>
		);
	else {
		const t = data.thresholds;
		const visible = <T extends { dismissed: boolean }>(rows: T[]) =>
			showDismissed ? rows : rows.filter((r) => !r.dismissed);
		// Everything hidden is a different story from nothing found: don't state the rule as if
		// no product matched.
		const allDismissed = (all: { dismissed: boolean }[], shown: unknown[]) =>
			shown.length === 0 && all.length > 0
				? `All ${all.length} dismissed. Switch to All to review or restore ${all.length === 1 ? "it" : "them"}.`
				: null;
		const cost = visible(data.costChanges);
		const slow = visible(data.slowMovers);
		body = (
			<div className="space-y-4">
				<AlertCard
					title="Cost changes"
					rows={cost.length}
					empty={
						allDismissed(data.costChanges, cost) ??
						`No product's last purchase cost moved ${t.costChangePct}% or more in the last ${t.costChangeDays} days.`
					}
					rule={`Last purchase cost vs the one before, ±${t.costChangePct}% or more, bought in the last ${t.costChangeDays} days.`}
					head={
						<>
							<th className={TH_LEFT}>Product</th>
							<th className={TH_LEFT}>Supplier</th>
							<th className={TH}>Unit cost</th>
							<th className={TH}>Change</th>
							<ActionHead />
						</>
					}
				>
					{cost.map((r) => (
						<CostRow key={r.key} r={r} />
					))}
				</AlertCard>
				<AlertCard
					title="Slow movers"
					rows={slow.length}
					empty={
						allDismissed(data.slowMovers, slow) ??
						`No product worth ${formatMoney(t.slowMoverMinValue)} or more has gone ${t.slowMoverDays} days without a sale.`
					}
					rule={`In stock, no sale in ${t.slowMoverDays} days, stock value ${formatMoney(t.slowMoverMinValue)} or more.`}
					head={
						<>
							<th className={TH_LEFT}>Product</th>
							<th className={TH}>Stock value</th>
							<ActionHead />
						</>
					}
				>
					{slow.map((r) => (
						<SlowRow key={r.key} r={r} />
					))}
				</AlertCard>
			</div>
		);
	}

	return (
		<div className="text-text-primary">
			<PageHeader title="Alerts">
				<SegmentedToggle
					ariaLabel="Show dismissed"
					value={showDismissed ? "all" : "open"}
					options={[
						{ id: "open", label: "Open" },
						{ id: "all", label: "All" },
					]}
					onChange={(v) => setShowDismissed(v === "all")}
				/>
			</PageHeader>
			{body}
		</div>
	);
}
