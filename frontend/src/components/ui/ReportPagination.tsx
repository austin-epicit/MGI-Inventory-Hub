import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import Dropdown from "../ui/Dropdown";

interface ReportPaginationProps {
	page: number;
	pageSize: number;
	total: number;
	hasMore: boolean;
	onPageChange: (page: number) => void;
	onPageSizeChange?: (size: number) => void;
	isFetching?: boolean;
}

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

export default function ReportPagination({
	page,
	pageSize,
	total,
	hasMore,
	onPageChange,
	onPageSizeChange,
	isFetching,
}: ReportPaginationProps) {
	if (total === 0) return null;

	const pageCount = Math.max(1, Math.ceil(total / pageSize));
	const firstRow = page * pageSize + 1;
	const lastRow = Math.min((page + 1) * pageSize, total);

	return (
		<div className="flex items-center justify-between gap-3 pt-3 text-sm text-text-muted">
			<span className="flex items-center gap-2 tabular-nums">
				Showing {firstRow.toLocaleString()}–{lastRow.toLocaleString()} of{" "}
				{total.toLocaleString()}
				{isFetching && <Loader2 size={14} className="animate-spin" />}
			</span>
			<div className="flex items-center gap-3">
				{onPageSizeChange && (
					<label className="flex items-center gap-1.5">
						<span>Rows</span>
						<div className="w-20">
							<Dropdown
								aria-label="Rows per page"
								value={String(pageSize)}
								onChange={(v) =>
									onPageSizeChange(Number(v))
								}
								entries={PAGE_SIZE_OPTIONS.map(
									(n) => (
										<option
											key={n}
											value={n}
										>
											{n}
										</option>
									)
								)}
							/>
						</div>
					</label>
				)}
				<span className="tabular-nums">
					Page {(page + 1).toLocaleString()} of{" "}
					{pageCount.toLocaleString()}
				</span>
				<div className="flex items-center gap-1">
					<button
						onClick={() => onPageChange(page - 1)}
						disabled={page <= 0}
						className="flex items-center justify-center h-8 w-8 rounded-md border border-border bg-base text-text-secondary hover:text-text-primary hover:border-border-strong transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
						aria-label="Previous page"
					>
						<ChevronLeft size={16} />
					</button>
					<button
						onClick={() => onPageChange(page + 1)}
						disabled={!hasMore}
						className="flex items-center justify-center h-8 w-8 rounded-md border border-border bg-base text-text-secondary hover:text-text-primary hover:border-border-strong transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
						aria-label="Next page"
					>
						<ChevronRight size={16} />
					</button>
				</div>
			</div>
		</div>
	);
}
