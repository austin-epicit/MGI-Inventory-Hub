import { useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, PackageX } from "lucide-react";
import CostPriceChart from "../../components/charts/CostPriceChart";
import { PRICE_RANGE_OPTIONS } from "../../components/charts/costPriceSeries";
import OrderStatusPill from "../../components/ui/OrderStatusPill";
import Card from "../../components/ui/Card";
import EmptyState from "../../components/ui/EmptyState";
import ReportPagination from "../../components/ui/ReportPagination";
import ReportState from "../../components/ui/ReportState";
import { ApiError } from "../../lib/api";
import { formatDate, formatDateTime, formatMoney, formatQty } from "../../lib/format";
import type { PriceRange } from "../../types/priceHistory";
import type { ProductDetail, ProductPurchaseRow, ProductSaleRow } from "./api";
import { useProduct, useProductPriceHistory, useProductPurchases, useProductSales } from "./hooks";
import ConditionCard from "./ConditionCard";
import ProductGallery from "./ProductGallery";
import ProductKpis from "./ProductKpis";

const ORDERS_PAGE_SIZE = 10;
const DEFAULT_RANGE: PriceRange = "90d";

const STATUS_TONE: Record<string, string> = {
	Active: "bg-success-bg text-success-text border-success-border",
	"Setup required": "bg-warning-bg text-warning-text border-warning-border",
};

function StatusPill({ status }: { status: string }) {
	return (
		<span
			className={`inline-flex h-5 items-center rounded-full border px-2 text-xs font-medium ${
				STATUS_TONE[status] ??
				"border-border-subtle bg-surface text-text-muted"
			}`}
		>
			{status}
		</span>
	);
}

const TH = "px-3 py-2 text-left text-xs font-medium text-text-tertiary";
const TD = "px-3 py-2 whitespace-nowrap";
const NUM = "text-right tabular-nums";

function StockCard({ stock }: { stock: ProductDetail["stock"] }) {
	return (
		<Card title="Stock by location" flush>
			{stock.length === 0 ? (
				<p className="px-4 py-6 text-center text-sm text-text-muted">
					No stock recorded in Cin7
				</p>
			) : (
				<div className="overflow-x-auto">
					<table
						aria-label="Stock by location"
						className="w-full text-[13px]"
					>
						<thead className="border-b border-border-subtle">
							<tr>
								<th className={TH}>Location</th>
								<th className={`${TH} text-right`}>
									On hand
								</th>
								<th className={`${TH} text-right`}>
									Available
								</th>
								<th className={`${TH} text-right`}>
									On order
								</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-border-subtle">
							{stock.map((s) => (
								<tr key={s.location}>
									<td
										className={`${TD} max-w-[10rem] truncate`}
										title={s.location}
									>
										{s.location}
									</td>
									<td
										className={`${TD} ${NUM}`}
									>
										{formatQty(
											s.onHand
										)}
									</td>
									<td
										className={`${TD} ${NUM}`}
									>
										{formatQty(
											s.available
										)}
									</td>
									<td
										className={`${TD} ${NUM}`}
									>
										{formatQty(
											s.onOrder
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</Card>
	);
}

function ListPricesCard({ tiers }: { tiers: ProductDetail["tiers"] }) {
	return (
		<Card title="List prices">
			{tiers.length === 0 ? (
				<p className="text-sm text-text-muted">
					No list prices set in Cin7
				</p>
			) : (
				<dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-sm">
					{tiers.map((t) => (
						<div key={t.code} className="contents">
							<dt
								className="truncate text-text-secondary"
								title={t.name}
							>
								{t.name}
							</dt>
							<dd className="text-right font-medium tabular-nums">
								{formatMoney(t.value)}
							</dd>
						</div>
					))}
				</dl>
			)}
		</Card>
	);
}

interface Column<T> {
	header: string;
	numeric?: boolean;
	cell: (row: T) => ReactNode;
}

// Voided and draft orders stay listed with their status; only charts and KPIs skip them.
function OrdersCard<T extends { counted: boolean }>({
	title,
	what,
	query,
	page,
	onPage,
	columns,
	rowKey,
}: {
	title: string;
	what: string;
	query: {
		data?: { rows: T[]; count: number };
		isLoading: boolean;
		isFetching: boolean;
		error: Error | null;
		refetch: () => unknown;
	};
	page: number;
	onPage: (p: number) => void;
	columns: Column<T>[];
	rowKey: (row: T) => string;
}) {
	const rows = query.data?.rows ?? [];
	const total = query.data?.count ?? 0;
	return (
		<Card title={title} flush>
			<ReportState
				loading={query.isLoading}
				error={query.error}
				errorMessage={`Couldn't load ${what}`}
				onRetry={() => void query.refetch()}
				isEmpty={total === 0}
				emptyMessage={`No ${what} for this product`}
				skeletonClassName="h-40 m-4 rounded-lg"
			>
				<div className="overflow-x-auto">
					<table className="w-full text-[13px]">
						<thead className="border-b border-border-subtle">
							<tr>
								{columns.map((c) => (
									<th
										key={c.header}
										className={`${TH}${c.numeric ? " text-right" : ""}`}
									>
										{c.header}
									</th>
								))}
							</tr>
						</thead>
						<tbody className="divide-y divide-border-subtle">
							{rows.map((r) => (
								<tr
									key={rowKey(r)}
									className={
										r.counted
											? ""
											: "text-text-faint"
									}
								>
									{columns.map((c) => (
										<td
											key={
												c.header
											}
											className={`${TD}${c.numeric ? ` ${NUM}` : ""}`}
										>
											{c.cell(r)}
										</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
				</div>
				<div className="px-4 pb-3">
					<ReportPagination
						page={page}
						pageSize={ORDERS_PAGE_SIZE}
						total={total}
						hasMore={(page + 1) * ORDERS_PAGE_SIZE < total}
						onPageChange={onPage}
						isFetching={query.isFetching}
					/>
				</div>
			</ReportState>
		</Card>
	);
}

const orderLink = (to: string, label: string) => (
	<Link to={to} className="font-medium text-text-link hover:underline">
		{label}
	</Link>
);
const dateCell = (d: string | null) => (d ? formatDate(d) : "—");
const party = (name: string) => (
	<span className="block max-w-[12rem] truncate" title={name}>
		{name}
	</span>
);

const PURCHASE_COLUMNS: Column<ProductPurchaseRow>[] = [
	{ header: "Order", cell: (r) => orderLink(`/purchases/${r.purchaseId}`, r.orderNumber) },
	{ header: "Date", cell: (r) => dateCell(r.orderDate) },
	{ header: "Supplier", cell: (r) => party(r.supplier) },
	{ header: "Status", cell: (r) => <OrderStatusPill status={r.status} /> },
	{ header: "Qty", numeric: true, cell: (r) => formatQty(r.quantity) },
	{ header: "Purchase cost", numeric: true, cell: (r) => formatMoney(r.unitCostBase) },
	{ header: "Total", numeric: true, cell: (r) => formatMoney(r.totalBase) },
];

const SALE_COLUMNS: Column<ProductSaleRow>[] = [
	{ header: "Order", cell: (r) => orderLink(`/sales/${r.saleId}`, r.orderNumber) },
	{ header: "Date", cell: (r) => dateCell(r.orderDate) },
	{ header: "Customer", cell: (r) => party(r.customer) },
	{ header: "Tier", cell: (r) => r.priceTierName ?? "—" },
	{ header: "Status", cell: (r) => <OrderStatusPill status={r.status} /> },
	{ header: "Qty", numeric: true, cell: (r) => formatQty(r.quantity) },
	{ header: "Sold price", numeric: true, cell: (r) => formatMoney(r.unitPriceBase) },
	{ header: "Total", numeric: true, cell: (r) => formatMoney(r.totalBase) },
];

function RecentOrders({ id }: { id: string }) {
	const [purchasePage, setPurchasePage] = useState(0);
	const [salePage, setSalePage] = useState(0);
	const purchases = useProductPurchases(id, purchasePage + 1, ORDERS_PAGE_SIZE);
	const sales = useProductSales(id, salePage + 1, ORDERS_PAGE_SIZE);
	return (
		<div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
			<OrdersCard<ProductPurchaseRow>
				title="Recent purchases"
				what="purchase orders"
				query={purchases}
				page={purchasePage}
				onPage={setPurchasePage}
				columns={PURCHASE_COLUMNS}
				rowKey={(r) => `${r.purchaseId}:${r.lineNo}`}
			/>
			<OrdersCard<ProductSaleRow>
				title="Recent sales"
				what="sales orders"
				query={sales}
				page={salePage}
				onPage={setSalePage}
				columns={SALE_COLUMNS}
				rowKey={(r) => `${r.saleId}:${r.lineNo}`}
			/>
		</div>
	);
}

export default function ProductDetailPage() {
	const { id = "" } = useParams();
	const [searchParams, setSearchParams] = useSearchParams();
	const rangeParam = searchParams.get("range");
	const range: PriceRange = PRICE_RANGE_OPTIONS.some((r) => r.id === rangeParam)
		? (rangeParam as PriceRange)
		: DEFAULT_RANGE;
	// Kept in the URL so a shared link or a refresh shows the same range; replace, not push.
	const setRange = (next: PriceRange) => {
		const params = new URLSearchParams(searchParams);
		if (next === DEFAULT_RANGE) params.delete("range");
		else params.set("range", next);
		setSearchParams(params, { replace: true });
	};

	const detail = useProduct(id);
	const history = useProductPriceHistory(id, range);

	const back = (
		<Link
			to="/products"
			className="mb-3 inline-flex items-center gap-1 text-sm text-text-muted transition-colors duration-150 ease-out hover:text-text-primary"
		>
			<ArrowLeft size={14} />
			Products
		</Link>
	);

	if (detail.error) {
		// A malformed id is a 400; retrying it can never work.
		const missing =
			detail.error instanceof ApiError &&
			(detail.error.status === 404 || detail.error.status === 400);
		return (
			<div className="text-text-primary">
				{back}
				<EmptyState
					icon={<PackageX size={32} />}
					title={
						missing
							? "Product not found"
							: "Couldn't load this product"
					}
					description={
						missing
							? "It may have been removed from Cin7."
							: "Something went wrong fetching it. Try again."
					}
					action={
						missing
							? undefined
							: {
									label: "Try again",
									onClick: () =>
										detail.refetch(),
								}
					}
				/>
			</div>
		);
	}

	if (!detail.data) {
		return (
			<div className="text-text-primary">
				{back}
				<div className="h-8 w-80 animate-pulse rounded bg-surface-raised" />
				<div className="mt-4 h-24 animate-pulse rounded-xl bg-base" />
				<div className="mt-4 h-96 animate-pulse rounded-xl bg-base" />
			</div>
		);
	}

	const { product, images, stock, tiers, condition } = detail.data;
	return (
		<div className="flex flex-col gap-4 text-text-primary">
			<div>
				{back}
				<h2 className="break-words text-2xl font-semibold">
					{product.name}
				</h2>
				<div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-tertiary">
					<span className="font-mono text-text-secondary">
						{product.sku}
					</span>
					<StatusPill status={product.status} />
					{[product.category, product.brand]
						.filter(Boolean)
						.map((v) => (
							<span key={v}>{v}</span>
						))}
					<span className="text-text-faint">
						Synced {formatDateTime(product.syncedAt)}
					</span>
				</div>
			</div>

			<ProductKpis detail={detail.data} />

			{/* Rail layout: chart + stock take two thirds, pictures + list prices the rest. The
			    columns stretch to one height; the plot or the picture frame absorbs the difference. */}
			<div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
				<div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
					<CostPriceChart
						className="flex-1"
						history={history.data}
						isLoading={history.isLoading}
						isStale={history.isPlaceholderData}
						error={history.error}
						onRetry={() => history.refetch()}
						range={range}
						onRangeChange={setRange}
					/>
					<StockCard stock={stock} />
				</div>
				<div className="flex min-w-0 flex-col gap-4">
					<ConditionCard
						productId={product.id}
						condition={condition}
					/>
					<Card title="Pictures" className="flex-1">
						<ProductGallery
							images={images}
							name={product.name}
						/>
					</Card>
					<ListPricesCard tiers={tiers} />
				</div>
			</div>

			<RecentOrders id={product.id} />
		</div>
	);
}
