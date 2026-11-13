import { Link, useParams } from "react-router-dom";
import OrderDetailFrame from "../../components/detail/OrderDetailFrame";
import DetailStatRow from "../../components/detail/DetailStatRow";
import Card from "../../components/ui/Card";
import OrderStatusPill from "../../components/ui/OrderStatusPill";
import Thumb from "../../components/ui/Thumb";
import {
	formatDate,
	formatDateTime,
	formatMoney,
	formatPercent,
	formatQty,
} from "../../lib/format";
import { orderLabel } from "../../lib/orderLabel";
import CreditNotesCard from "./CreditNotesCard";
import { useSale } from "./hooks";

const TH = "px-3 py-2 text-left text-xs font-medium text-text-tertiary";
const TD = "px-3 py-2 whitespace-nowrap";
const NUM = "text-right tabular-nums";

const pct = (n: number | null) => (n === null ? "—" : formatPercent(n));

export default function SaleDetailPage() {
	const { id = "" } = useParams();
	const detail = useSale(id);
	const d = detail.data;
	const s = d?.sale;
	const foreign = !!s && s.currency !== s.baseCurrency;

	return (
		<OrderDetailFrame
			backTo="/sales"
			backLabel="Sales"
			noun="Sale"
			loaded={!!d}
			error={detail.error}
			onRetry={() => detail.refetch()}
		>
			{d && s && (
				<>
					<div>
						<div className="flex flex-wrap items-center gap-3">
							<h2 className="text-2xl font-semibold">
								{s.orderNumber}
							</h2>
							<OrderStatusPill status={s.status} />
						</div>
						<div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-tertiary">
							<span>
								Customer{" "}
								<span className="text-text-secondary">
									{s.customer}
								</span>
							</span>
							<span>
								Ordered{" "}
								<span className="text-text-secondary">
									{s.orderDate
										? formatDate(
												s.orderDate
											)
										: "—"}
								</span>
							</span>
							<span>
								Tier{" "}
								<span className="text-text-secondary">
									{s.priceTierName ?? "—"}
								</span>
							</span>
							<span>{s.type}</span>
							<span className="text-text-faint">
								Synced {formatDateTime(s.syncedAt)}
							</span>
						</div>
					</div>

					<DetailStatRow
						tiles={[
							{
								label: "Total",
								value: formatMoney(
									s.totalBase,
									s.baseCurrency
								),
								hint: foreign
									? `${formatMoney(s.total, s.currency)} · 1 ${s.currency} = ${s.currencyRate} ${s.baseCurrency}`
									: undefined,
							},
							{
								label: "Cost of goods",
								value:
									s.cogsBase === null
										? "—"
										: formatMoney(
												s.cogsBase,
												s.baseCurrency
											),
							},
							{
								label: "Margin",
								value: pct(s.marginPct),
							},
							{
								label: "Invoice",
								value:
									orderLabel(
										s.invoiceStatus
									) || "—",
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
											{s.priceTierName
												? `Sold price — ${s.priceTierName}`
												: "Sold price"}
										</th>
										<th
											className={`${TH} text-right`}
										>
											Average cost
										</th>
										<th
											className={`${TH} text-right`}
										>
											Margin
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
													l.unitPriceBase,
													s.baseCurrency
												)}
											</td>
											<td
												className={`${TD} ${NUM}`}
											>
												{l.averageCost ===
												null
													? "—"
													: formatMoney(
															l.averageCost,
															s.baseCurrency
														)}
											</td>
											<td
												className={`${TD} ${NUM}`}
											>
												{pct(
													l.marginPct
												)}
											</td>
											<td
												className={`${TD} ${NUM}`}
											>
												{formatMoney(
													l.totalBase,
													s.baseCurrency
												)}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</Card>

					<CreditNotesCard
						creditNotes={d.creditNotes}
						baseCurrency={s.baseCurrency}
					/>
				</>
			)}
		</OrderDetailFrame>
	);
}
