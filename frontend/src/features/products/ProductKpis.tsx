import DetailStatRow from "../../components/detail/DetailStatRow";
import { formatMoney, formatQty } from "../../lib/format";
import type { ProductDetail } from "./api";

/** Stock and cost at a glance; quantities sum every location. */
export default function ProductKpis({ detail }: { detail: ProductDetail }) {
	const total = (pick: (s: ProductDetail["stock"][number]) => number) =>
		detail.stock.reduce((sum, s) => sum + pick(s), 0);
	const onHand = total((s) => s.onHand);
	const unit = detail.product.uom ?? undefined;
	return (
		<DetailStatRow
			tiles={[
				{ label: "On hand", value: formatQty(onHand), hint: unit },
				{
					label: "Available",
					value: formatQty(total((s) => s.available)),
					hint: `${formatQty(total((s) => s.allocated))} allocated`,
				},
				{
					label: "On order",
					value: formatQty(total((s) => s.onOrder)),
					hint: `${formatQty(total((s) => s.inTransit))} in transit`,
				},
				{
					label: "Average cost",
					value: formatMoney(detail.product.averageCost),
				},
				{
					label: "Stock value",
					value: formatMoney(onHand * detail.product.averageCost),
					hint: "On hand × average cost",
				},
			]}
		/>
	);
}
