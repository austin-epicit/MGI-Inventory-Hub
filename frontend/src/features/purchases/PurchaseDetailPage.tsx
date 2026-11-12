import { Link, useParams } from "react-router-dom";
import OrderDetailFrame from "../../components/detail/OrderDetailFrame";
import DetailStatRow from "../../components/detail/DetailStatRow";
import Card from "../../components/ui/Card";
import OrderStatusPill from "../../components/ui/OrderStatusPill";
import Thumb from "../../components/ui/Thumb";
import { formatDate, formatDateTime, formatMoney, formatQty } from "../../lib/format";
import { orderLabel } from "../../lib/orderLabel";
import { usePurchase } from "./hooks";

const TH = "px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted";
const TD = "px-3 py-2 whitespace-nowrap";
const NUM = "text-right tabular-nums";

export default function PurchaseDetailPage() {
	const { id = "" } = useParams();
	const detail = usePurchase(id);
	const d = detail.data;
	const p = d?.purchase;
	const foreign = !!p && p.currency !== p.baseCurrency;

	return (
		<OrderDetailFrame
			backTo="/purchases"
			backLabel="Purchases"
			noun="Purchase"
			loaded={!!d}
			error={detail.error}
			onRetry={() => detail.refetch()}
		>
			{d && p && (
				<>
					<div>
						<div className="flex flex-wrap items-center gap-3">
							<h2 className="text-2xl font-semibold">
								{p.orderNumber}
							</h2>
							<OrderStatusPill status={p.status} />
						</div>
						<div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-tertiary">
							<span>
								Supplier{" "}
								<span className="text-text-secondary">
									{p.supplier}
								</span>
							</span>
							<span>
								Ordered{" "}
								<span className="text-text-secondary">
									{p.orderDate
										? formatDate(
												p.orderDate
											)
										: "—"}
								</span>
							</span>
							<span>{p.type}</span>
							<span className="text-text-faint">
								Synced {formatDateTime(p.syncedAt)}
							</span>
						</div>
					</div>

					<DetailStatRow
						tiles={[
							{
								label: "Total",
								value: formatMoney(
									p.totalBase,
									p.baseCurrency
								),
								hint: foreign
									? `${formatMoney(p.total, p.currency)} · 1 ${p.currency} = ${p.currencyRate} ${p.baseCurrency}`
									: undefined,
							},
							{
								label: "Receiving",
								value:
									orderLabel(
										p.receivingStatus
									) || "—",
							},
							{
								label: "Invoice",
								value:
									orderLabel(
										p.invoiceStatus
									) || "—",
							},
							{
								label: "Lines",
								value: formatQty(d.lines.length),
							},
						]}
					/>

					<Card title="Lines" flush>
						<div className="overflow-x-auto">
							<table
								aria-label="Order lines"
								className="w-full text-[13px]"
							>
								<thead className="border-b border-border-subtle">
									<tr>
										<th
											className={
												TH
											}
										/>
										<th className={TH}>
											SKU
										</th>
										<th className={TH}>
											Name
										</th>
										<th
											className={`${TH} text-right`}
										>
											Qty
										</th>
										<th
											className={`${TH} text-right`}
										>
											Purchase
											cost
										</th>
										<th
											className={`${TH} text-right`}
										>
											Discount
										</th>
										<th
											className={`${TH} text-right`}
										>
											Total
										</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-border-subtle">
									{d.lines.map((l) => (
										<tr key={l.lineNo}>
											<td
												className={
													TD
												}
											>
												<Thumb
													url={
														l.thumbUrl
													}
													name={
														l.name
													}
												/>
											</td>
											<td
												className={`${TD} font-mono`}
											>
												{l.productId ? (
													<Link
														to={`/products/${l.productId}`}
														className="text-text-link hover:underline"
													>
														{
															l.sku
														}
													</Link>
												) : (
													l.sku
												)}
											</td>
											<td
												className={`${TD} max-w-[24rem] truncate`}
												title={
													l.name
												}
											>
												{
													l.name
												}
											</td>
											<td
												className={`${TD} ${NUM}`}
											>
												{formatQty(
													l.quantity
												)}
											</td>
											<td
												className={`${TD} ${NUM}`}
											>
												{formatMoney(
													l.unitCostBase,
													p.baseCurrency
												)}
											</td>
											<td
												className={`${TD} ${NUM}`}
											>
												{l.discountPct >
												0
													? `${l.discountPct}%`
													: "—"}
											</td>
											<td
												className={`${TD} ${NUM}`}
											>
												{formatMoney(
													l.totalBase,
													p.baseCurrency
												)}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</Card>
				</>
			)}
		</OrderDetailFrame>
	);
}
