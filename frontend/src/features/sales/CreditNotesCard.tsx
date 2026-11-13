import Card from "../../components/ui/Card";
import OrderStatusPill from "../../components/ui/OrderStatusPill";
import { formatDate, formatMoney, formatQty } from "../../lib/format";
import type { SaleCreditNote } from "./api";

const TH = "px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted";
const TD = "px-3 py-2 whitespace-nowrap";
const NUM = "text-right tabular-nums";

export default function CreditNotesCard({
	creditNotes,
	baseCurrency,
}: {
	creditNotes: SaleCreditNote[];
	baseCurrency: string;
}) {
	if (creditNotes.length === 0) return null;
	return (
		<Card title="Credit notes" flush>
			<div className="overflow-x-auto">
				<table aria-label="Credit notes" className="w-full text-[13px]">
					<thead className="border-b border-border-subtle">
						<tr>
							<th className={TH}>Number</th>
							<th className={TH}>Date</th>
							<th className={TH}>Status</th>
							<th className={`${TH} text-right`}>Qty</th>
							<th className={`${TH} text-right`}>
								Price
							</th>
							<th className={`${TH} text-right`}>
								Total
							</th>
						</tr>
					</thead>
					{creditNotes.map((n) => (
						<tbody
							key={n.id}
							className="divide-y divide-border-subtle border-b border-border-subtle last:border-b-0"
						>
							<tr className="bg-surface/40 font-medium">
								<td className={`${TD} font-mono`}>
									{n.number ?? "—"}
								</td>
								<td className={TD}>
									{n.date
										? formatDate(n.date)
										: "—"}
								</td>
								<td className={TD}>
									<span className="inline-flex items-center gap-2">
										<OrderStatusPill
											status={
												n.status
											}
										/>
										{!n.counted && (
											<span className="text-xs font-normal text-text-faint">
												Not
												counted
											</span>
										)}
									</span>
								</td>
								<td className={TD} />
								<td className={TD} />
								<td className={`${TD} ${NUM}`}>
									{formatMoney(
										n.totalBase,
										baseCurrency
									)}
								</td>
							</tr>
							{n.lines.map((l, i) => (
								<tr
									key={i}
									className="text-text-secondary"
								>
									<td
										className={`${TD} pl-6 font-mono`}
									>
										{l.sku}
									</td>
									<td
										className={`${TD} max-w-[24rem] truncate`}
										colSpan={2}
										title={l.name}
									>
										{l.name}
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
											baseCurrency
										)}
									</td>
									<td
										className={`${TD} ${NUM}`}
									>
										{formatMoney(
											l.totalBase,
											baseCurrency
										)}
									</td>
								</tr>
							))}
						</tbody>
					))}
				</table>
			</div>
		</Card>
	);
}
