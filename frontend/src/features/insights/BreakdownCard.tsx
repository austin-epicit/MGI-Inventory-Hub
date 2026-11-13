import { Link } from "react-router-dom";
import { Layers } from "lucide-react";
import LoadSvg from "../../assets/icons/loading.svg?react";
import { QueryErrorState } from "../../components/charts/chartShared";
import Card from "../../components/ui/Card";
import EmptyState from "../../components/ui/EmptyState";
import SegmentedToggle from "../../components/ui/SegmentedToggle";
import { formatMoney, formatQty } from "../../lib/format";
import type { PriceRange } from "../../types/priceHistory";
import type { BreakdownBy, InsightsBreakdownRow } from "./api";
import { useInsightsBreakdown } from "./hooks";

const BY_OPTIONS: { id: BreakdownBy; label: string }[] = [
	{ id: "category", label: "Category" },
	{ id: "brand", label: "Brand" },
	{ id: "grade", label: "Grade" },
	{ id: "customer", label: "Customer" },
	{ id: "tier", label: "Price tier" },
	{ id: "supplier", label: "Supplier" },
];

const LIST_PARAM: Record<BreakdownBy, { path: string; param: string }> = {
	category: { path: "/products", param: "category" },
	brand: { path: "/products", param: "brand" },
	grade: { path: "/products", param: "grade" },
	customer: { path: "/sales", param: "customerId" },
	tier: { path: "/sales", param: "tier" },
	supplier: { path: "/purchases", param: "supplierId" },
};

/** The list page filtered to one row; null for rows with no key (Uncategorised, No tier…). */
// eslint-disable-next-line react-refresh/only-export-components -- pure helper, no fast-refresh risk
export function breakdownHref(by: BreakdownBy, key: string | null): string | null {
	if (by === "grade") key ??= "none"; // "Not graded" drills to the list's ungraded filter
	if (key === null) return null;
	const { path, param } = LIST_PARAM[by];
	return `${path}?${param}=${encodeURIComponent(key)}`;
}

const TH = "px-2 py-1.5 text-right font-medium text-text-muted whitespace-nowrap";
const TD = "px-2 py-1.5 text-right tabular-nums whitespace-nowrap";

function Row({
	row,
	by,
	sales,
	max,
	linkable,
}: {
	row: InsightsBreakdownRow;
	by: BreakdownBy;
	sales: boolean;
	max: number;
	linkable: boolean;
}) {
	// The "Other (n)" row is never linkable; fallback rows have a null key and so no href.
	const href = linkable ? breakdownHref(by, row.key) : null;
	return (
		<tr className="border-t border-border-subtle">
			<td className="max-w-[220px] px-2 py-1.5 text-left">
				{href ? (
					<Link
						to={href}
						className="block truncate text-primary-text hover:underline"
						title={row.label}
					>
						{row.label}
					</Link>
				) : (
					<span
						className="block truncate text-text-secondary"
						title={row.label}
					>
						{row.label}
					</span>
				)}
			</td>
			<td className="w-[220px] px-2 py-1.5">
				<div className="flex items-center gap-2">
					<div className="h-2 flex-1 rounded-sm bg-surface">
						<div
							data-testid="breakdown-bar"
							className="h-2 rounded-sm bg-primary"
							style={{
								width: `${max > 0 ? (row.amount / max) * 100 : 0}%`,
							}}
						/>
					</div>
					<span className="w-24 text-right tabular-nums">
						{formatMoney(row.amount)}
					</span>
				</div>
			</td>
			{sales ? (
				<>
					<td className={TD}>
						{row.grossProfit === null
							? "—"
							: formatMoney(row.grossProfit)}
					</td>
					<td className={TD}>
						{row.marginPct === null
							? "—"
							: `${row.marginPct.toFixed(1)}%`}
					</td>
					<td className={TD}>{formatQty(row.units)}</td>
					<td className={TD}>{row.orders}</td>
				</>
			) : (
				<>
					<td className={TD}>{formatQty(row.units)}</td>
					<td className={TD}>{row.orders}</td>
					<td className={TD}>{row.products}</td>
				</>
			)}
		</tr>
	);
}

/** Ranked table for one dimension: the top 15 rows, then one "Other (n)" row. */
export default function BreakdownCard({
	range,
	by,
	onByChange,
}: {
	range: PriceRange;
	by: BreakdownBy;
	onByChange: (by: BreakdownBy) => void;
}) {
	const { data, isLoading, error, refetch, isPlaceholderData } = useInsightsBreakdown(
		range,
		by
	);
	const label = BY_OPTIONS.find((o) => o.id === by)!.label;

	let body;
	if (error) body = <QueryErrorState what="the breakdown" onRetry={() => void refetch()} />;
	else if (isLoading || !data)
		body = (
			<div
				className="flex h-[200px] items-center justify-center"
				aria-label="Loading the breakdown"
			>
				<LoadSvg className="h-7 w-7" />
			</div>
		);
	else if (data.rows.length === 0)
		body = (
			<EmptyState
				icon={<Layers size={26} />}
				title="Nothing to break down in this range"
				description="Pick a longer range to see older orders."
			/>
		);
	else {
		const sales = data.kind === "sales";
		const all = data.other ? [...data.rows, data.other] : data.rows;
		const max = Math.max(...all.map((r) => r.amount));
		body = (
			<div className="overflow-x-auto text-[13px]">
				<table
					className="w-full"
					aria-label={`Breakdown by ${label.toLowerCase()}`}
				>
					<thead>
						<tr>
							<th className={`${TH} text-left`}>
								{label}
							</th>
							<th className={`${TH} text-left`}>
								{sales ? "Sales" : "Spend"}
							</th>
							{sales ? (
								<>
									<th className={TH}>
										Gross profit
									</th>
									<th className={TH}>
										Margin %
									</th>
									<th className={TH}>
										Units
									</th>
									<th className={TH}>
										Orders
									</th>
								</>
							) : (
								<>
									<th className={TH}>
										Units bought
									</th>
									<th className={TH}>POs</th>
									<th className={TH}>
										Products
									</th>
								</>
							)}
						</tr>
					</thead>
					<tbody>
						{data.rows.map((r) => (
							<Row
								key={r.key ?? `none:${r.label}`}
								row={r}
								by={by}
								sales={sales}
								max={max}
								linkable
							/>
						))}
						{data.other && (
							<Row
								row={data.other}
								by={by}
								sales={sales}
								max={max}
								linkable={false}
							/>
						)}
					</tbody>
				</table>
			</div>
		);
	}

	return (
		<Card
			title="Breakdown"
			headerAction={
				<SegmentedToggle<BreakdownBy>
					ariaLabel="Break down by"
					value={by}
					options={BY_OPTIONS}
					onChange={onByChange}
				/>
			}
		>
			<div
				className={`transition-opacity duration-150 ease-out ${
					isPlaceholderData ? "opacity-40" : ""
				}`}
				aria-busy={isPlaceholderData}
			>
				{body}
			</div>
		</Card>
	);
}
