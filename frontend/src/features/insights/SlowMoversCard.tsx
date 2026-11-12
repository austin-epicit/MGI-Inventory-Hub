import { Link } from "react-router-dom";
import { PackageCheck } from "lucide-react";
import LoadSvg from "../../assets/icons/loading.svg?react";
import { QueryErrorState } from "../../components/charts/chartShared";
import Card from "../../components/ui/Card";
import EmptyState from "../../components/ui/EmptyState";
import Thumb from "../../components/ui/Thumb";
import { formatDate, formatMoney, formatQty } from "../../lib/format";
import { SLOW_MOVER_DAYS, type InsightsStock } from "./api";
import { useInsightsStock } from "./hooks";

const TH = "px-2 py-1.5 text-right font-medium text-text-muted whitespace-nowrap";
const TD = "px-2 py-1.5 text-right tabular-nums whitespace-nowrap";

/** Products holding stock with no counted sale in the last 90 days, biggest stock value first. */
// Narrow card (a third of the row): on-hand and last-sold ride under the name, not in columns.
const rowDetail = (r: InsightsStock["slowMovers"][number]): string =>
	`${r.sku} · ${formatQty(r.onHand)} on hand · ${r.lastSold ? `last sold ${formatDate(r.lastSold)}` : "Never sold"}`;

export default function SlowMoversCard() {
	const { data, isLoading, error, refetch } = useInsightsStock();

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
								<th className={`${TH} text-left`}>
									Product
								</th>
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
													className="line-clamp-2 break-words text-primary-text hover:underline"
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

	return <Card title="Slow movers">{body}</Card>;
}
