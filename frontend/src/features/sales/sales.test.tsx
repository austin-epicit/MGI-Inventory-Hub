import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render as plainRender } from "@testing-library/react";
import { render, screen, waitFor, within } from "../../test/testUtils";
import { setFormatContext } from "../../lib/format";
import type { SaleDetail, SaleRow } from "./api";
import SaleDetailPage from "./SaleDetailPage";
import SalesPage from "./SalesPage";

const row = (over: Partial<SaleRow> = {}): SaleRow => ({
	id: "sa-1",
	orderNumber: "SO-0007",
	orderDate: "2026-03-01",
	customerId: "c1",
	customer: "Initech",
	priceTierName: "Retail",
	status: "COMPLETED",
	counted: true,
	currency: "USD",
	baseCurrency: "USD",
	total: 100,
	totalBase: 100,
	lineCount: 1,
	invoiceStatus: "INVOICED",
	...over,
});

const reply = (data: unknown, count?: number, status = 200) =>
	new Response(
		JSON.stringify({
			success: status === 200,
			data: status === 200 ? data : null,
			error: status === 200 ? null : { code: "NOT_FOUND", message: "nope" },
			meta: count === undefined ? {} : { count },
		}),
		{ status, headers: { "Content-Type": "application/json" } }
	);

let rows: SaleRow[] = [];
let fetchSpy: MockInstance<typeof fetch>;
const listCalls = () =>
	fetchSpy.mock.calls
		.map(([u]) => String(u))
		.filter((u) => u.startsWith("/api/sales?"))
		.map((u) => new URL(u, "http://x").searchParams);

beforeEach(() => {
	setFormatContext({ currency: "USD" });
	fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) =>
		String(url).startsWith("/api/sales/facets")
			? reply({
					statuses: ["COMPLETED", "PICKING", "VOIDED"],
					customers: [{ id: "c1", name: "Initech" }],
					tiers: ["Retail", "Wholesale"],
				})
			: reply(rows, rows.length)
	);
});
afterEach(() => vi.restoreAllMocks());

describe("SalesPage", () => {
	it("lists voided and draft orders with their status pill", async () => {
		rows = [
			row(),
			row({
				id: "sa-2",
				orderNumber: "SO-0008",
				status: "VOIDED",
				counted: false,
			}),
			row({
				id: "sa-3",
				orderNumber: "SO-0009",
				status: "DRAFT",
				counted: false,
			}),
		];
		render(<SalesPage />);
		const voided = (await screen.findByText("SO-0008")).closest("tr")!;
		expect(within(voided).getByText("Voided")).toHaveAttribute("data-tone", "red");
		const draft = screen.getByText("SO-0009").closest("tr")!;
		expect(within(draft).getByText("Draft")).toHaveAttribute("data-tone", "neutral");
		const live = screen.getByText("SO-0007").closest("tr")!;
		expect(within(live).getByText("Completed")).toHaveAttribute("data-tone", "green");
		expect(within(live).getByText("Retail")).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "SO-0007" })).toHaveAttribute(
			"href",
			"/sales/sa-1"
		);
	});

	it("shows a CAD order's base total with the document total under it", async () => {
		rows = [row({ currency: "CAD", total: 135, totalBase: 100 })];
		render(<SalesPage />);
		const tr = (await screen.findByText("SO-0007")).closest("tr")!;
		expect(within(tr).getByText("$100.00")).toBeInTheDocument();
		expect(within(tr).getByText("CA$135.00")).toBeInTheDocument();
	});

	it("derives status and tier options from the data and sends them to the API", async () => {
		rows = [row()];
		render(<SalesPage />);
		await screen.findByText("SO-0007");
		const user = userEvent.setup();
		await user.click(screen.getByRole("button", { name: /^Status/ }));
		await user.click(await screen.findByRole("option", { name: "Picking" }));
		await waitFor(() => expect(listCalls().at(-1)!.get("status")).toBe("PICKING"));
		await user.click(screen.getByRole("button", { name: /^Tier/ }));
		await user.click(await screen.findByRole("option", { name: "Wholesale" }));
		await waitFor(() => expect(listCalls().at(-1)!.get("tier")).toBe("Wholesale"));
		await user.click(screen.getByRole("button", { name: /^Customer/ }));
		await user.click(await screen.findByRole("option", { name: "Initech" }));
		await waitFor(() => expect(listCalls().at(-1)!.get("customerId")).toBe("c1"));
	});

	it("sends the search term after the debounce", async () => {
		rows = [row()];
		render(<SalesPage />);
		await screen.findByText("SO-0007");
		await userEvent
			.setup()
			.type(screen.getByPlaceholderText(/Search by order number/), "init");
		await waitFor(() => expect(listCalls().at(-1)!.get("search")).toBe("init"));
	});
});

describe("SaleDetailPage", () => {
	const detail: SaleDetail = {
		sale: {
			id: "sa-1",
			orderNumber: "SO-0007",
			type: "Simple Sale",
			status: "COMPLETED",
			counted: true,
			orderDate: "2026-03-01",
			invoiceDate: "2026-03-01",
			customerId: "c1",
			customer: "Initech",
			priceTierName: "Retail",
			currency: "CAD",
			baseCurrency: "USD",
			currencyRate: 1.35,
			total: 270,
			totalBase: 200,
			cogsBase: 120,
			marginPct: 40,
			invoiceStatus: "INVOICED",
			syncedAt: "2026-03-02T10:00:00.000Z",
		},
		lines: [
			{
				lineNo: 1,
				productId: "p1",
				sku: "SKU-1",
				name: "Copper pipe",
				quantity: 2,
				unitPrice: 135,
				discountPct: 0,
				unitPriceBase: 100,
				averageCost: 60,
				marginPct: 40,
				totalBase: 200,
				thumbUrl: null,
			},
			{
				lineNo: 2,
				productId: null,
				sku: "FREIGHT",
				name: "Shipping",
				quantity: 1,
				unitPrice: 0,
				discountPct: 0,
				unitPriceBase: 0,
				averageCost: null,
				marginPct: null,
				totalBase: 0,
				thumbUrl: null,
			},
		],
	};
	const renderDetail = () =>
		plainRender(
			<QueryClientProvider
				client={
					new QueryClient({
						defaultOptions: { queries: { retry: false } },
					})
				}
			>
				<MemoryRouter initialEntries={["/sales/sa-1"]}>
					<Routes>
						<Route
							path="/sales/:id"
							element={<SaleDetailPage />}
						/>
					</Routes>
				</MemoryRouter>
			</QueryClientProvider>
		);

	it("CAD sale: base total, document total at the rate, margin, and per-line price, cost, margin", async () => {
		fetchSpy.mockImplementation(async () => reply(detail));
		renderDetail();
		expect(await screen.findByRole("heading", { name: "SO-0007" })).toBeInTheDocument();
		expect(screen.getAllByText("$200.00").length).toBeGreaterThan(0);
		expect(screen.getByText(/CA\$270\.00 · 1 CAD = 1\.35 USD/)).toBeInTheDocument();
		expect(screen.getAllByText("40.0%").length).toBe(2); // stat tile + line
		expect(
			screen.getByRole("columnheader", { name: "Sold price — Retail" })
		).toBeInTheDocument();
		const tr = screen.getByText("Copper pipe").closest("tr")!;
		expect(within(tr).getByText("$100.00")).toBeInTheDocument();
		expect(within(tr).getByText("$60.00")).toBeInTheDocument();
		// A line without a recorded average cost has no margin, not 100%.
		const free = screen.getByText("Shipping").closest("tr")!;
		expect(within(free).getAllByText("—").length).toBe(2);
	});

	it("shows a not-found state for an unknown order", async () => {
		fetchSpy.mockImplementation(async () => reply(null, undefined, 404));
		renderDetail();
		expect(await screen.findByText("Sale not found")).toBeInTheDocument();
	});
});
