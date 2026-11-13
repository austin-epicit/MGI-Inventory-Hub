import { useMemo, useState } from "react";
import { PackageSearch } from "lucide-react";
import Thumb from "../../components/ui/Thumb";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import AdaptableTable from "../../components/ui/AdaptableTable";
import EmptyState from "../../components/ui/EmptyState";
import ExportButton from "../../components/ui/ExportButton";
import FilterChips from "../../components/ui/FilterChips";
import PageControls from "../../components/ui/PageControls";
import PageHeader from "../../components/ui/PageHeader";
import ReportPagination from "../../components/ui/ReportPagination";
import SearchBar from "../../components/ui/SearchBar";
import { DropdownFilter } from "../../components/ui/StatusFilter";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { useReportSort } from "../../hooks/useReportSort";
import { exportHref } from "../../lib/csv";
import { formatDate, formatMoney, formatQty } from "../../lib/format";
import { PRODUCT_STATUSES, type ConditionGrade, type ProductRow, type ProductSortKey } from "./api";
import { CONDITION_GRADES, GRADE_LABELS, NOT_GRADED } from "./condition";
import GradeBadge from "./GradeBadge";
import { useProductFacets, useProducts } from "./hooks";

const HEADER_LABELS: Record<string, string> = {
	thumb: "",
	sku: "SKU",
	name: "Name",
	category: "Category",
	brand: "Brand",
	grade: "Grade",
	status: "Status",
	onHand: "On hand",
	averageCost: "Average cost",
	listPrices: "List price",
	lastPurchaseDate: "Last purchase",
	lastSoldDate: "Last sold",
};
// Only the columns the API can order by.
const SORTABLE: Record<string, boolean> = {
	sku: true,
	name: true,
	onHand: true,
	averageCost: true,
	lastPurchaseDate: true,
	lastSoldDate: true,
};
const COLUMN_ALIGN: Record<string, "left" | "right"> = { onHand: "right", averageCost: "right" };
// Name takes the flexible width, the rest stay tight so the table fits at 1440px.
const CLAMP = {
	sku: { maxWidth: "12rem" },
	name: { maxWidth: "13rem" },
	category: { maxWidth: "6rem" },
	brand: { maxWidth: "6rem" },
};
const GRADE_OPTIONS = [
	...CONDITION_GRADES.map((g) => ({ value: g, label: GRADE_LABELS[g] })),
	{ value: "none", label: NOT_GRADED },
];
const gradeFromUrl = (v: string | null) =>
	GRADE_OPTIONS.some((o) => o.value === v) ? (v as ConditionGrade | "none") : null;
const NOWRAP = () => "whitespace-nowrap";
const CELL_CLASS = Object.fromEntries(Object.keys(HEADER_LABELS).map((k) => [k, NOWRAP]));

const toOptions = (xs: string[] | undefined) => (xs ?? []).map((v) => ({ value: v, label: v }));

function Dated({ value, date }: { value: number | null; date: string | null }) {
	if (date === null) return <span className="text-text-faint">—</span>;
	return (
		<div className="leading-tight">
			<div>{value === null ? "—" : formatMoney(value)}</div>
			<div className="text-xs text-text-muted">{formatDate(date)}</div>
		</div>
	);
}

export default function ProductsPage() {
	const navigate = useNavigate();
	const [searchInput, setSearchInput] = useState("");
	const search = useDebouncedValue(searchInput.trim());
	const [initial] = useSearchParams(); // deep links from Insights arrive as filters
	const [category, setCategory] = useState<string | null>(() => initial.get("category"));
	const [brand, setBrand] = useState<string | null>(() => initial.get("brand"));
	const [grade, setGrade] = useState<ConditionGrade | "none" | null>(() =>
		gradeFromUrl(initial.get("grade"))
	);
	const [status, setStatus] = useState<string | null>(null);
	const [page, setPage] = useState(0);
	const [pageSize, setPageSize] = useState(50);
	const { sort, tableProps } = useReportSort();
	const facets = useProductFacets();

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

	const query = {
		search: search || undefined,
		category: category ?? undefined,
		brand: brand ?? undefined,
		grade: grade ?? undefined,
		status: status ?? undefined,
		sort: sort.sortKey as ProductSortKey | undefined,
		dir: sort.sortKey ? sort.sortDir : undefined,
	};
	const { data, isLoading, isFetching, error, refetch } = useProducts({
		...query,
		page: page + 1,
		limit: pageSize,
	});
	const rows = useMemo(() => data?.rows ?? [], [data]);
	const total = data?.count ?? 0;
	const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
	const rowOf = (r: Record<string, unknown>) => byId.get(r.id as string) as ProductRow;

	const displayRows = useMemo(
		() =>
			rows.map((r) => ({
				id: r.id,
				thumb: r.thumbUrl,
				sku: r.sku,
				name: r.name,
				category: r.category ?? "—",
				brand: r.brand ?? "—",
				grade: r.grade,
				status: r.status,
				onHand: r.onHand,
				averageCost: r.averageCost,
				listPrices: r.listPrices.length,
				lastPurchaseDate: r.lastPurchaseDate,
				lastSoldDate: r.lastSoldDate,
			})),
		[rows]
	);

	const titled = (key: "sku" | "category" | "brand") => (r: Record<string, unknown>) => {
		const v = rowOf(r)[key] ?? "—";
		return <span title={v}>{v}</span>;
	};
	const cellRenderers = {
		sku: titled("sku"),
		name: (r: Record<string, unknown>) => {
			const row = rowOf(r);
			return (
				<Link
					to={`/products/${row.id}`}
					title={row.name}
					onClick={(e) => e.stopPropagation()} // the row click would navigate a second time
					className="text-text-link hover:underline"
				>
					{row.name}
				</Link>
			);
		},
		category: titled("category"),
		brand: titled("brand"),
		grade: (r: Record<string, unknown>) =>
			rowOf(r).grade ? (
				<GradeBadge grade={rowOf(r).grade} />
			) : (
				<span className="text-text-faint">—</span>
			),
		thumb: (r: Record<string, unknown>) => (
			<Thumb url={rowOf(r).thumbUrl} name={rowOf(r).name} />
		),
		onHand: (r: Record<string, unknown>) => formatQty(rowOf(r).onHand),
		averageCost: (r: Record<string, unknown>) => formatMoney(rowOf(r).averageCost),
		listPrices: (r: Record<string, unknown>) => {
			const prices = rowOf(r).listPrices;
			if (prices.length === 0)
				return <span className="text-text-faint">Not set</span>;
			return (
				<div className="leading-tight">
					{prices.map((p) => (
						<div
							key={p.code}
							className="whitespace-nowrap text-xs"
						>
							<span className="text-text-muted">
								{p.name}
							</span>{" "}
							{formatMoney(p.value)}
						</div>
					))}
				</div>
			);
		},
		lastPurchaseDate: (r: Record<string, unknown>) => (
			<Dated value={rowOf(r).lastPurchaseCost} date={rowOf(r).lastPurchaseDate} />
		),
		lastSoldDate: (r: Record<string, unknown>) => (
			<Dated value={rowOf(r).lastSoldPrice} date={rowOf(r).lastSoldDate} />
		),
	};

	const hasFilters = !!(search || category || brand || grade || status);
	const clearAll = () => {
		setSearchInput("");
		setCategory(null);
		setBrand(null);
		setGrade(null);
		setStatus(null);
		setPage(0);
	};

	return (
		<div className="text-text-primary">
			<PageHeader title="Products">
				<ExportButton
					href={exportHref("/api/products", query)}
					disabled={isLoading || total === 0}
				/>
			</PageHeader>
			<PageControls
				className="mb-4"
				left={
					<SearchBar
						placeholder="Search by SKU or name…"
						value={searchInput}
						onChange={filtered(setSearchInput)}
					/>
				}
				right={
					<>
						<DropdownFilter
							placeholder="Category"
							allLabel="All categories"
							exclusive
							values={category ? [category] : null}
							onChange={filtered(setCategory)}
							options={toOptions(facets.data?.categories)}
							loadError={facets.isError}
							onRetryOptions={() => void facets.refetch()}
						/>
						<DropdownFilter
							placeholder="Brand"
							allLabel="All brands"
							exclusive
							values={brand ? [brand] : null}
							onChange={filtered(setBrand)}
							options={toOptions(facets.data?.brands)}
							loadError={facets.isError}
							onRetryOptions={() => void facets.refetch()}
						/>
						<DropdownFilter
							placeholder="Grade"
							allLabel="All grades"
							exclusive
							values={grade ? [grade] : null}
							onChange={filtered(
								setGrade as (
									v: string | null
								) => void
							)}
							options={GRADE_OPTIONS}
						/>
						<DropdownFilter
							placeholder="Status"
							allLabel="All statuses"
							exclusive
							values={status ? [status] : null}
							onChange={filtered(setStatus)}
							options={toOptions([...PRODUCT_STATUSES])}
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
					category
						? {
								label: `Category: ${category}`,
								color: "blue" as const,
								onRemove: () =>
									filtered(setCategory)(null),
							}
						: null,
					brand
						? {
								label: `Brand: ${brand}`,
								color: "cyan" as const,
								onRemove: () =>
									filtered(setBrand)(null),
							}
						: null,
					grade
						? {
								label: `Grade: ${GRADE_OPTIONS.find((o) => o.value === grade)!.label}`,
								color: "orange" as const,
								onRemove: () =>
									filtered(setGrade)(null),
							}
						: null,
					status
						? {
								label: `Status: ${status}`,
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
						icon={<PackageSearch size={40} />}
						title={
							hasFilters
								? "No products match"
								: "No products yet"
						}
						description={
							hasFilters
								? "Try adjusting your filters"
								: "Products appear here after the first Cin7 sync"
						}
					/>
				) : (
					<>
						<AdaptableTable
							data={displayRows}
							loadListener={isLoading}
							errListener={error}
							errorWhat="products"
							onRetry={() => void refetch()}
							onClearFilters={clearAll}
							formatNums={false}
							headerLabels={HEADER_LABELS}
							columnAlign={COLUMN_ALIGN}
							columnClamp={CLAMP}
							cellClass={CELL_CLASS}
							compact
							cellRenderers={cellRenderers}
							sortableColumns={SORTABLE}
							onRowClick={(r) =>
								navigate(
									`/products/${r.id as string}`
								)
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
