import { orderLabel } from "../../lib/orderLabel";
import { orderStatusTone, TONES } from "./orderStatusTone";

export default function OrderStatusPill({ status }: { status: string }) {
	return (
		<span
			data-tone={orderStatusTone(status)}
			className={`inline-flex h-5 items-center whitespace-nowrap rounded-full border px-2 text-xs font-medium ${TONES[orderStatusTone(status)]}`}
		>
			{orderLabel(status)}
		</span>
	);
}
