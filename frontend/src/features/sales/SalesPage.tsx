import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Receipt } from "lucide-react";
import AdaptableTable from "../../components/ui/AdaptableTable";
import DateRangeFilter from "../../components/ui/DateRangeFilter";
import EmptyState from "../../components/ui/EmptyState";
import ExportButton from "../../components/ui/ExportButton";
import FilterChips from "../../components/ui/FilterChips";
import OrderStatusPill from "../../components/ui/OrderStatusPill";
import PageControls from "../../components/ui/PageControls";
import PageHeader from "../../components/ui/PageHeader";
import ReportPagination from "../../components/ui/ReportPagination";
import SearchBar from "../../components/ui/SearchBar";
import { DropdownFilter } from "../../components/ui/StatusFilter";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { useReportSort } from "../../hooks/useReportSort";
import { exportHref } from "../../lib/csv";
import { formatDate, formatMoney } from "../../lib/format";
import { formatTriggerLabel, type DateRangeValue } from "../../util/dateRangeUtils";
import { orderLabel } from "../../lib/orderLabel";
import { rangeLabel, rangeToYmd } from "../../util/ymdRange";
import type { SaleRow, SaleSortKey } from "./api";
import { useSaleFacets, useSales } from "./hooks";

const HEADER_LABELS: Record<string, string> = {
	orderNumber: "Order",
	orderDate: "Date",
	customer: "Customer",
	priceTierName: "Tier",
	status: "Status",
	invoiceStatus: "Invoice",
	totalBase: "Total",
};
const SORTABLE: Record<string, boolean> = {
	orderNumber: true,
	orderDate: true,
	customer: true,
	status: true,
	totalBase: true,
};
const COLUMN_ALIGN: Record<string, "left" | "right"> = { totalBase: "right" };
const CLAMP = { customer: { maxWidth: "16rem" } };

export default function SalesPage() {
	const navigate = useNavigate();
	const [searchInput, setSearchInput] = useState("");
	const search = useDebouncedValue(searchInput.trim());
	const [status, setStatus] = useState<string | null>(null);
	const [initial] = useSearchParams(); // deep links from Insights arrive as filters
	const [customerId, setCustomerId] = useState<string | null>(() =>
		initial.get("customerId")
	);
	const [tier, setTier] = useState<string | null>(() => initial.get("tier"));
	const [dates, setDates] = useState<DateRangeValue>({ option: "all" });
	const [page, setPage] = useState(0);
	const [pageSize, setPageSize] = useState(50);
	const { sort, tableProps } = useReportSort();
	const facets = useSaleFacets();

	// Any change to what is being asked for starts again from page 1.
	const filtered =
		<T,>(set: (v: T) => void) =>
		(v: T) => {
			set(v);
			setPage(0);
		};
	const sortProps = {
		...tableProps,
		onSortChange: (col: string) => {
			tableProps.onSortChange(col);
			setPage(0);
		},
	};

	const range = useMemo(() => rangeToYmd(dates), [dates]);
	const query = {
		search: search || undefined,
		status: status ?? undefined,
		customerId: customerId ?? undefined,
		tier: tier ?? undefined,
		...range,
		sort: sort.sortKey as SaleSortKey | undefined,
		dir: sort.sortKey ? sort.sortDir : undefined,
	};
	const { data, isLoading, isFetching, error } = useSales({
		...query,
		page: page + 1,
		limit: pageSize,
	});
	const rows = useMemo(() => data?.rows ?? [], [data]);
	const total = data?.count ?? 0;
	const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
	const rowOf = (r: Record<string, unknown>) => byId.get(r.id as string) as SaleRow;

	const displayRows = useMemo(
		() =>
			rows.map((r) => ({
				id: r.id,
				orderNumber: r.orderNumber,
				orderDate: r.orderDate,
				customer: r.customer,
				priceTierName: r.priceTierName,
				status: r.status,
				invoiceStatus: r.invoiceStatus,
				totalBase: r.totalBase,
			})),
		[rows]
	);

	// Voided and draft orders stay in the list but read as set aside.
	const faint = (r: Record<string, unknown>) =>
		`whitespace-nowrap font-normal${rowOf(r).counted ? "" : " text-text-faint"}`;
	const cellClass = Object.fromEntries(Object.keys(HEADER_LABELS).map((k) => [k, faint]));
	const dash = <span className="text-text-faint">—</span>;
	const cellRenderers = {
		orderNumber: (r: Record<string, unknown>) => (
			<Link
				to={`/sales/${rowOf(r).id}`}
				className="font-medium text-text-link hover:underline"
			>
				{rowOf(r).orderNumber}
			</Link>
		),
		orderDate: (r: Record<string, unknown>) => {
			const d = rowOf(r).orderDate;
			return d ? formatDate(d) : dash;
		},
		customer: (r: Record<string, unknown>) => (
			<span title={rowOf(r).customer}>{rowOf(r).customer}</span>
		),
		priceTierName: (r: Record<string, unknown>) => rowOf(r).priceTierName ?? dash,
		status: (r: Record<string, unknown>) => (
			<OrderStatusPill status={rowOf(r).status} />
		),
		invoiceStatus: (r: Record<string, unknown>) =>
			orderLabel(rowOf(r).invoiceStatus) || dash,
		totalBase: (r: Record<string, unknown>) => {
			const o = rowOf(r);
			return (
				<div className="leading-tight">
					<div>{formatMoney(o.totalBase, o.baseCurrency)}</div>
					{o.currency !== o.baseCurrency && o.total !== 0 && (
						<div className="text-xs text-text-muted">
							{formatMoney(o.total, o.currency)}
						</div>
					)}
				</div>
			);
		},
	};

	const customerName = facets.data?.customers.find((c) => c.id === customerId)?.name;
	const hasDates = dates.option !== "all";
	const hasFilters = !!(search || status || customerId || tier || hasDates);
	const clearAll = () => {
		setSearchInput("");
		setStatus(null);
		setCustomerId(null);
		setTier(null);
		setDates({ option: "all" });
		setPage(0);
	};

	return (
		<div className="text-text-primary">
			<PageHeader title="Sales">
				<ExportButton
					href={exportHref("/api/sales", query)}
					disabled={isLoading || total === 0}
				/>
			</PageHeader>
			<PageControls
				className="mb-4"
				left={
					<SearchBar
						placeholder="Search by order number or customer..."
						value={searchInput}
						onChange={filtered(setSearchInput)}
					/>
				}
				right={
					<>
						<DateRangeFilter
							label="Order date"
							value={dates}
							onChange={filtered(setDates)}
						/>
						<DropdownFilter
							placeholder="Customer"
							allLabel="All customers"
							exclusive
							values={customerId ? [customerId] : null}
							onChange={filtered(setCustomerId)}
							options={(facets.data?.customers ?? []).map(
								(c) => ({
									value: c.id,
									label: c.name,
								})
							)}
						/>
						<DropdownFilter
							placeholder="Tier"
							allLabel="All tiers"
							exclusive
							values={tier ? [tier] : null}
							onChange={filtered(setTier)}
							options={(facets.data?.tiers ?? []).map(
								(v) => ({
									value: v,
									label: v,
								})
							)}
						/>
						<DropdownFilter
							placeholder="Status"
							allLabel="All statuses"
							exclusive
							values={status ? [status] : null}
							onChange={filtered(setStatus)}
							options={(facets.data?.statuses ?? []).map(
								(v) => ({
									value: v,
									label: orderLabel(v),
								})
							)}
						/>
					</>
				}
			/>
			<FilterChips
				filters={[
					search
						? {
								label: `Search: "${search}"`,
								color: "purple" as const,
								onRemove: () =>
									filtered(setSearchInput)(
										""
									),
							}
						: null,
					hasDates
						? {
								label: `Order date: ${rangeLabel(formatTriggerLabel(dates), dates)}`,
								color: "cyan" as const,
								onRemove: () =>
									filtered(setDates)({
										option: "all",
									}),
							}
						: null,
					customerId
						? {
								label: `Customer: ${customerName ?? (facets.data ? "Unknown" : "…")}`,
								color: "blue" as const,
								onRemove: () =>
									filtered(setCustomerId)(
										null
									),
							}
						: null,
					tier
						? {
								label: `Tier: ${tier}`,
								color: "orange" as const,
								onRemove: () =>
									filtered(setTier)(null),
							}
						: null,
					status
						? {
								label: `Status: ${orderLabel(status)}`,
								color: "green" as const,
								onRemove: () =>
									filtered(setStatus)(null),
							}
						: null,
				]}
				resultCount={total}
				onClearAll={clearAll}
			/>
			<div className="overflow-x-auto rounded-lg border border-border-subtle bg-base p-3 text-left text-[13px] shadow-sm">
				{!isLoading && !error && total === 0 ? (
					<EmptyState
						icon={<Receipt size={40} />}
						title={
							hasFilters
								? "No sales match"
								: "No sales yet"
						}
						description={
							hasFilters
								? "Try adjusting your filters"
								: "Sales orders appear here after the first Cin7 sync"
						}
					/>
				) : (
					<>
						<AdaptableTable
							data={displayRows}
							loadListener={isLoading}
							errListener={error}
							formatNums={false}
							headerLabels={HEADER_LABELS}
							columnAlign={COLUMN_ALIGN}
							columnClamp={CLAMP}
							cellClass={cellClass}
							compact
							cellRenderers={cellRenderers}
							sortableColumns={SORTABLE}
							onRowClick={(r) =>
								navigate(`/sales/${r.id as string}`)
							}
							{...sortProps}
						/>
						<ReportPagination
							page={page}
							pageSize={pageSize}
							total={total}
							hasMore={(page + 1) * pageSize < total}
							onPageChange={setPage}
							onPageSizeChange={filtered(setPageSize)}
							isFetching={isFetching}
						/>
					</>
				)}
			</div>
		</div>
	);
}
