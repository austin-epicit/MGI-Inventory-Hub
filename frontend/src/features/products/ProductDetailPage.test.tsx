import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { render, screen, within } from "../../test/testUtils";
import { setFormatContext } from "../../lib/format";
import type { PriceHistory } from "../../types/priceHistory";
import type { ProductDetail, ProductPurchaseRow, ProductSaleRow } from "./api";
import ProductDetailPage from "./ProductDetailPage";

const ID = "00000000-0000-4000-8000-000000000001";

const detail: ProductDetail = {
	product: {
		id: ID,
		sku: "R740-XD",
		name: "Dell PowerEdge R740xd",
		category: "Servers",
		brand: "Dell",
		type: "Stock",
		status: "Active",
		uom: "Item",
		barcode: null,
		averageCost: 1250.5,
		syncedAt: "2026-03-01T12:00:00.000Z",
	},
	images: [],
	stock: [
		{
			location: "Main",
			onHand: 4,
			allocated: 1,
			available: 3,
			onOrder: 2,
			inTransit: 0,
		},
		{
			location: "Annex",
			onHand: 1,
			allocated: 0,
			available: 1,
			onOrder: 0,
			inTransit: 1,
		},
	],
	tiers: [{ code: 1, name: "Retail", value: 1899 }],
	condition: null,
};

const purchases: ProductPurchaseRow[] = [
	{
		purchaseId: "pu-1",
		lineNo: 1,
		orderNumber: "PO-0042",
		orderDate: "2026-03-01",
		supplier: "Northwind",
		status: "VOIDED",
		counted: false,
		quantity: 2,
		unitCostBase: 1200,
		totalBase: 2400,
	},
];

const sales: ProductSaleRow[] = [
	{
		saleId: "sa-1",
		lineNo: 1,
		orderNumber: "SO-0007",
		orderDate: "2026-02-28",
		customer: "Contoso",
		priceTierName: "Retail",
		status: "COMPLETED",
		counted: true,
		quantity: 1,
		unitPriceBase: 1850,
		averageCost: 1250.5,
		totalBase: 1850,
	},
];

const history: PriceHistory = {
	range: { from: "2025-12-01", to: "2026-03-01" },
	bucket: "week",
	purchaseCost: [],
	averageCost: [],
	listPrices: [],
	soldPrices: [],
	listTrackingStartedAt: null,
	stats: {
		lastPurchaseCost: null,
		purchaseCostChangePct: null,
		averageCost: null,
		avgSoldPrice: null,
		marginPct: null,
	},
};

const reply = (data: unknown, count?: number) =>
	new Response(
		JSON.stringify({
			success: true,
			data,
			error: null,
			meta: count === undefined ? {} : { count },
		}),
		{ status: 200, headers: { "Content-Type": "application/json" } }
	);

let fetchSpy: MockInstance<typeof fetch>;
beforeEach(() => {
	setFormatContext({ currency: "USD" });
	fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
		const url = String(input);
		if (url.startsWith(`/api/products/${ID}/purchases`)) return reply(purchases, 1);
		if (url.startsWith(`/api/products/${ID}/sales`)) return reply(sales, 1);
		if (url.startsWith(`/api/products/${ID}/price-history`)) return reply(history);
		if (url === `/api/products/${ID}`) return reply(detail);
		throw new Error(`unexpected ${url}`);
	});
	window.history.pushState({}, "", `/products/${ID}`);
});
afterEach(() => vi.restoreAllMocks());

const renderPage = () =>
	render(
		<Routes>
			<Route path="/products/:id" element={<ProductDetailPage />} />
		</Routes>
	);

describe("ProductDetailPage", () => {
	it("shows the header, KPIs, stock by location and current list prices", async () => {
		renderPage();
		expect(
			await screen.findByRole("heading", { name: "Dell PowerEdge R740xd" })
		).toBeInTheDocument();
		expect(screen.getByText("R740-XD")).toBeInTheDocument();
		expect(screen.getByText("Active")).toBeInTheDocument();
		// On hand sums the locations; stock value = on hand × average cost.
		expect(screen.getByText("$6,252.50")).toBeInTheDocument();
		const stock = screen.getByRole("table", { name: "Stock by location" });
		expect(within(stock).getByText("Annex")).toBeInTheDocument();
		expect(within(stock).getByText("Main")).toBeInTheDocument();
		expect(screen.getByText("$1,899.00")).toBeInTheDocument();
		expect(screen.getByRole("img", { name: /No picture/ })).toBeInTheDocument();
	});

	it("recent purchases and sales link to their order pages; voided orders keep their status", async () => {
		renderPage();
		const po = await screen.findByRole("link", { name: "PO-0042" });
		expect(po).toHaveAttribute("href", "/purchases/pu-1");
		expect(within(po.closest("tr")!).getByText("Voided")).toBeInTheDocument();
		expect(within(po.closest("tr")!).getByText("Mar 1, 2026")).toBeInTheDocument();
		const so = await screen.findByRole("link", { name: "SO-0007" });
		expect(so).toHaveAttribute("href", "/sales/sa-1");
		expect(within(so.closest("tr")!).getByText("Retail")).toBeInTheDocument();
		expect(within(so.closest("tr")!).getAllByText("$1,850.00").length).toBeGreaterThan(
			0
		);
	});

	it("keeps two identical lines of one order as separate rows (keyed by line number)", async () => {
		const err = vi.spyOn(console, "error").mockImplementation(() => {});
		const twin = [purchases[0]!, { ...purchases[0]!, lineNo: 2 }];
		fetchSpy.mockImplementation(async (input) => {
			const url = String(input);
			if (url.startsWith(`/api/products/${ID}/purchases`)) return reply(twin, 2);
			if (url.startsWith(`/api/products/${ID}/sales`)) return reply(sales, 1);
			if (url.startsWith(`/api/products/${ID}/price-history`))
				return reply(history);
			return reply(detail);
		});
		renderPage();
		expect(await screen.findAllByRole("link", { name: "PO-0042" })).toHaveLength(2);
		expect(err.mock.calls.some((c) => String(c[0]).includes("same key"))).toBe(false);
	});

	it("treats a malformed product link (400) as not found, with no Try again", async () => {
		fetchSpy.mockImplementation(
			async () =>
				new Response(
					JSON.stringify({
						success: false,
						data: null,
						error: {
							code: "VALIDATION_ERROR",
							message: "Not a valid id.",
						},
					}),
					{
						status: 400,
						headers: { "Content-Type": "application/json" },
					}
				)
		);
		renderPage();
		expect(await screen.findByText("Product not found")).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
	});

	it("offers Try again when a product's purchases fail to load", async () => {
		let down = true;
		fetchSpy.mockImplementation(async (input) => {
			const url = String(input);
			if (url.startsWith(`/api/products/${ID}/purchases`))
				return down
					? new Response("<html>bad gateway</html>", { status: 502 })
					: reply(purchases, 1);
			if (url.startsWith(`/api/products/${ID}/sales`)) return reply(sales, 1);
			if (url.startsWith(`/api/products/${ID}/price-history`))
				return reply(history);
			return reply(detail);
		});
		renderPage();
		expect(
			await screen.findByText("Couldn't load purchase orders")
		).toBeInTheDocument();
		down = false;
		await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
		expect(await screen.findByRole("link", { name: "PO-0042" })).toBeInTheDocument();
	});

	it("asks for the price history of the chosen range", async () => {
		renderPage();
		await screen.findByText("No purchases or sales in this range");
		expect(
			fetchSpy.mock.calls.some(([u]) =>
				String(u).startsWith(`/api/products/${ID}/price-history?range=90d`)
			)
		).toBe(true);
	});
});
