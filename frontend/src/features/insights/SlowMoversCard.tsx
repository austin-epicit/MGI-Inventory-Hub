import { Link } from "react-router-dom";
import { PackageCheck } from "lucide-react";
import LoadSvg from "../../assets/icons/loading.svg?react";
import { QueryErrorState } from "../../components/charts/chartShared";
import Card from "../../components/ui/Card";
import EmptyState from "../../components/ui/EmptyState";
import ExportButton from "../../components/ui/ExportButton";
import Thumb from "../../components/ui/Thumb";
import { downloadCsv, localYmd, type CsvColumn } from "../../lib/csv";
import { formatDate, formatMoney, formatQty } from "../../lib/format";
import { SLOW_MOVER_DAYS, type InsightsStock } from "./api";
import { useInsightsStock } from "./hooks";

type SlowMover = InsightsStock["slowMovers"][number];
const CSV_COLUMNS: CsvColumn<SlowMover>[] = [
	{ label: "Product", value: (r) => r.name },
	{ label: "SKU", value: (r) => r.sku },
	{ label: "On hand", value: (r) => r.onHand },
	{ label: "Stock value", value: (r) => r.value },
	{ label: "Last sold", value: (r) => r.lastSold },
];

const TH_BASE = "px-2 py-1.5 text-xs font-medium text-text-tertiary whitespace-nowrap";
const TH = `${TH_BASE} text-right`;
const TH_LEFT = `${TH_BASE} text-left`;
const TD = "px-2 py-1.5 text-right tabular-nums whitespace-nowrap";

/** Products holding stock with no counted sale in the last 90 days, biggest stock value first. */
// Narrow card (a third of the row): on-hand and last-sold ride under the name, not in columns.
const rowDetail = (r: InsightsStock["slowMovers"][number]): string =>
	`${r.sku} · ${formatQty(r.onHand)} on hand · ${r.lastSold ? `last sold ${formatDate(r.lastSold)}` : "never sold"}`;

export default function SlowMoversCard() {
	const { data, isLoading, error, refetch } = useInsightsStock();

	const exportCsv = () =>
		data &&
		downloadCsv(
			`mgi-insights-slow-movers-${localYmd()}.csv`,
			CSV_COLUMNS,
			data.slowMovers
		);

	let body;
	if (error) body = <QueryErrorState what="slow movers" onRetry={() => void refetch()} />;
	else if (isLoading || !data)
		body = (
			<div
				className="flex h-[240px] items-center justify-center"
				aria-label="Loading slow movers"
			>
				<LoadSvg className="h-7 w-7" />
			</div>
		);
	else if (data.slowMovers.length === 0)
		body = (
			<EmptyState
				icon={<PackageCheck size={26} />}
				title="No slow movers"
				description={`Every product with stock sold in the last ${SLOW_MOVER_DAYS} days.`}
			/>
		);
	else
		body = (
			<>
				<p className="mb-2 text-xs text-text-muted">
					In stock, with no sale in the last {SLOW_MOVER_DAYS} days.
				</p>
				<div className="text-[13px]">
					<table className="w-full" aria-label="Slow movers">
						<thead>
							<tr>
								<th className={TH_LEFT}>Product</th>
								<th className={TH}>Stock value</th>
							</tr>
						</thead>
						<tbody>
							{data.slowMovers.map((r) => (
								<tr
									key={r.productId}
									className="border-t border-border-subtle"
								>
									<td className="w-full max-w-0 px-2 py-1.5 text-left">
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
													className="line-clamp-2 break-words text-text-link hover:underline"
													title={
														r.name
													}
												>
													{
														r.name
													}
												</Link>
												<span className="block break-words text-xs text-text-muted">
													{rowDetail(
														r
													)}
												</span>
											</div>
										</div>
									</td>
									<td className={TD}>
										{formatMoney(
											r.value
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</>
		);

	return (
		<Card
			title="Slow movers"
			headerAction={
				<ExportButton
					onExport={exportCsv}
					disabled={
						isLoading || !data || data.slowMovers.length === 0
					}
				/>
			}
		>
			{body}
		</Card>
	);
}
