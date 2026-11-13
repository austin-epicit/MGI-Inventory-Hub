import { Boxes } from "lucide-react";
import LoadSvg from "../../assets/icons/loading.svg?react";
import { QueryErrorState } from "../../components/charts/chartShared";
import Card from "../../components/ui/Card";
import EmptyState from "../../components/ui/EmptyState";
import ExportButton from "../../components/ui/ExportButton";
import { downloadCsv, localYmd, type CsvColumn } from "../../lib/csv";
import { formatCount, formatMoney, formatQty, plural } from "../../lib/format";
import type { AgeBucket, InsightsStock } from "./api";
import { useInsightsStock } from "./hooks";

const BUCKET_LABEL: Record<AgeBucket, string> = {
	"0-30": "0–30 days",
	"31-90": "31–90 days",
	"91-180": "91–180 days",
	"181-365": "181–365 days",
	"365+": "Over 365 days",
	none: "No purchase on record",
};

// Bucket names use en dashes so a spreadsheet never reads "31-90" as a date.
const CSV_COLUMNS: CsvColumn<InsightsStock["age"][number]>[] = [
	{ label: "Age", value: (a) => BUCKET_LABEL[a.bucket] },
	{ label: "Products", value: (a) => a.products },
	{ label: "Units", value: (a) => a.units },
	{ label: "Stock value", value: (a) => a.value },
];

/** Stock value by time since the product's last counted purchase. */
export default function StockAgeCard() {
	const { data, isLoading, error, refetch } = useInsightsStock();

	const exportCsv = () =>
		data &&
		downloadCsv(`mgi-insights-stock-age-${localYmd()}.csv`, CSV_COLUMNS, data.age);

	let body;
	if (error) body = <QueryErrorState what="stock age" onRetry={() => void refetch()} />;
	else if (isLoading || !data)
		body = (
			<div
				className="flex h-[240px] items-center justify-center"
				aria-label="Loading stock age"
			>
				<LoadSvg className="h-7 w-7" />
			</div>
		);
	else {
		// Negative stock can make a bucket negative; bars scale on positive values only.
		const positive = data.age.map((a) => Math.max(a.value, 0));
		const total = positive.reduce((s, v) => s + v, 0);
		const max = Math.max(...positive, 0);
		body =
			total === 0 ? (
				<EmptyState icon={<Boxes size={26} />} title="No stock on hand" />
			) : (
				<>
					<p className="mb-3 text-xs text-text-muted">
						Age is measured from the product's last purchase,
						not from each unit's receipt.
					</p>
					<ul aria-label="Stock value by age" className="space-y-2.5">
						{data.age.map((a, i) => (
							<li key={a.bucket}>
								<div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
									<span
										data-label
										className="truncate text-text-secondary"
									>
										{
											BUCKET_LABEL[
												a
													.bucket
											]
										}
									</span>
									<span className="shrink-0 tabular-nums text-text-primary">
										{formatMoney(
											a.value
										)}
										<span className="ml-1.5 text-text-muted">
											{formatCount(
												a.products
											)}{" "}
											{plural(
												a.products,
												"product"
											)}
											,{" "}
											{formatQty(
												a.units
											)}{" "}
											{plural(
												a.units,
												"unit"
											)}
										</span>
									</span>
								</div>
								<div className="h-2 rounded-r bg-surface">
									<div
										className="h-full rounded-r"
										style={{
											width: `${max > 0 ? (positive[i]! / max) * 100 : 0}%`,
											background:
												a.bucket ===
												"none"
													? "var(--color-chart-cat-other)"
													: "var(--color-chart-primary)",
										}}
									/>
								</div>
							</li>
						))}
					</ul>
					<p className="mt-3 text-xs text-text-muted">
						Total (positive buckets) {formatMoney(total)}
					</p>
				</>
			);
	}

	return (
		<Card
			title="Stock age"
			headerAction={
				<ExportButton onExport={exportCsv} disabled={isLoading || !data} />
			}
		>
			{body}
		</Card>
	);
}
