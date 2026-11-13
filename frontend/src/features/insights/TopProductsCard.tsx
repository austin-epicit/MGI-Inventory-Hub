import { useState } from "react";
import { Link } from "react-router-dom";
import { Package } from "lucide-react";
import LoadSvg from "../../assets/icons/loading.svg?react";
import { QueryErrorState } from "../../components/charts/chartShared";
import Card from "../../components/ui/Card";
import EmptyState from "../../components/ui/EmptyState";
import ExportButton from "../../components/ui/ExportButton";
import SegmentedToggle from "../../components/ui/SegmentedToggle";
import Thumb from "../../components/ui/Thumb";
import { downloadCsv, localYmd, type CsvColumn } from "../../lib/csv";
import { formatMoney, formatQty } from "../../lib/format";
import type { PriceRange } from "../../types/priceHistory";
import type { TopProductRow, TopProductSort } from "./api";
import { useTopProducts } from "./hooks";

const SORT_OPTIONS: { id: TopProductSort; label: string }[] = [
	{ id: "sales", label: "Sales" },
	{ id: "profit", label: "Gross profit" },
	{ id: "units", label: "Units" },
];

const CSV_COLUMNS: CsvColumn<TopProductRow>[] = [
	{ label: "Product", value: (r) => r.name },
	{ label: "SKU", value: (r) => r.sku },
	{ label: "Sales", value: (r) => r.sales },
	{ label: "Gross profit", value: (r) => r.grossProfit },
	{ label: "Margin %", value: (r) => r.marginPct },
	{ label: "Units sold", value: (r) => r.units },
	{ label: "On hand", value: (r) => r.onHand },
];

const TH_BASE = "px-2 py-1.5 font-medium text-text-muted whitespace-nowrap";
const TH = `${TH_BASE} text-right`;
const TH_LEFT = `${TH_BASE} text-left`;
const TD = "px-2 py-1.5 text-right tabular-nums whitespace-nowrap";

/** The ten best sellers in the range, ranked by sales, gross profit or units. */
export default function TopProductsCard({ range }: { range: PriceRange }) {
	const [sort, setSort] = useState<TopProductSort>("sales");
	const { data, isLoading, error, refetch, isPlaceholderData } = useTopProducts(range, sort);

	const exportCsv = () =>
		data &&
		downloadCsv(
			`mgi-insights-top-products-${sort}-${range}-${localYmd()}.csv`,
			CSV_COLUMNS,
			data.rows
		);

	let body;
	if (error) body = <QueryErrorState what="top products" onRetry={() => void refetch()} />;
	else if (isLoading || !data)
		body = (
			<div
				className="flex h-[200px] items-center justify-center"
				aria-label="Loading top products"
			>
				<LoadSvg className="h-7 w-7" />
			</div>
		);
	else if (data.rows.length === 0)
		body = (
			<EmptyState
				icon={<Package size={26} />}
				title="No products to rank in this range"
				description="Pick a longer range to see older orders."
			/>
		);
	else
		body = (
			<div className="overflow-x-auto text-[13px]">
				<table className="w-full" aria-label="Top products">
					<thead>
						<tr>
							<th className={TH_LEFT}>Product</th>
							<th className={TH}>Sales</th>
							<th className={TH}>Gross profit</th>
							<th className={TH}>Margin %</th>
							<th className={TH}>Units sold</th>
							<th className={TH}>On hand</th>
						</tr>
					</thead>
					<tbody>
						{data.rows.map((r) => (
							<tr
								key={r.productId}
								className="border-t border-border-subtle"
							>
								<td className="px-2 py-1.5 text-left">
									<div className="flex min-w-0 items-center gap-2">
										<Thumb
											url={
												r.thumbUrl
											}
											name={
												r.name
											}
										/>
										<div className="min-w-0 leading-tight">
											<Link
												to={`/products/${r.productId}`}
												className="block max-w-[260px] truncate text-primary-text hover:underline"
												title={
													r.name
												}
											>
												{
													r.name
												}
											</Link>
											<span className="block max-w-[260px] truncate text-xs text-text-muted">
												{
													r.sku
												}
											</span>
										</div>
									</div>
								</td>
								<td className={TD}>
									{formatMoney(r.sales)}
								</td>
								<td className={TD}>
									{r.grossProfit === null
										? "—"
										: formatMoney(
												r.grossProfit
											)}
								</td>
								<td className={TD}>
									{r.marginPct === null
										? "—"
										: `${r.marginPct.toFixed(1)}%`}
								</td>
								<td className={TD}>
									{formatQty(r.units)}
								</td>
								<td className={TD}>
									{formatQty(r.onHand)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		);

	return (
		<Card
			title="Top products"
			headerAction={
				<div className="flex items-center gap-2">
					<SegmentedToggle<TopProductSort>
						ariaLabel="Rank by"
						value={sort}
						options={SORT_OPTIONS}
						onChange={setSort}
					/>
					<ExportButton
						onExport={exportCsv}
						disabled={
							isLoading ||
							isPlaceholderData ||
							!data ||
							data.rows.length === 0
						}
					/>
				</div>
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
