import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render as plainRender } from "@testing-library/react";
import { render, screen, waitFor, within } from "../../test/testUtils";
import { setFormatContext } from "../../lib/format";
import type { PurchaseDetail, PurchaseRow } from "./api";
import PurchaseDetailPage from "./PurchaseDetailPage";
import PurchasesPage from "./PurchasesPage";

const row = (over: Partial<PurchaseRow> = {}): PurchaseRow => ({
	id: "pu-1",
	orderNumber: "PO-0042",
	orderDate: "2026-03-01",
	supplierId: "s1",
	supplier: "Acme Supply",
	status: "AUTHORISED",
	counted: true,
	currency: "USD",
	baseCurrency: "USD",
	total: 100,
	totalBase: 100,
	lineCount: 1,
	receivingStatus: "FULLY RECEIVED",
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

let rows: PurchaseRow[] = [];
let fetchSpy: MockInstance<typeof fetch>;
const listCalls = () =>
	fetchSpy.mock.calls
		.map(([u]) => String(u))
		.filter((u) => u.startsWith("/api/purchases?"))
		.map((u) => new URL(u, "http://x").searchParams);

beforeEach(() => {
	setFormatContext({ currency: "USD" });
	fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) =>
		String(url).startsWith("/api/purchases/facets")
			? reply({
					statuses: ["AUTHORISED", "PARTIALLY RECEIVED", "VOIDED"],
					suppliers: [{ id: "s1", name: "Acme Supply" }],
				})
			: reply(rows, rows.length)
	);
});
afterEach(() => vi.restoreAllMocks());

describe("PurchasesPage", () => {
	it("lists voided and draft orders with a status pill, and sets them aside visually", async () => {
		rows = [
			row(),
			row({
				id: "pu-2",
				orderNumber: "PO-0043",
				status: "VOIDED",
				counted: false,
			}),
			row({
				id: "pu-3",
				orderNumber: "PO-0044",
				status: "DRAFT",
				counted: false,
			}),
		];
		render(<PurchasesPage />);
		const voided = (await screen.findByText("PO-0043")).closest("tr")!;
		expect(within(voided).getByText("Voided")).toHaveAttribute("data-tone", "red");
		expect(voided.querySelector(".text-text-faint")).not.toBeNull();
		const draft = screen.getByText("PO-0044").closest("tr")!;
		expect(within(draft).getByText("Draft")).toHaveAttribute("data-tone", "neutral");
		const live = screen.getByText("PO-0042").closest("tr")!;
		expect(within(live).getByText("Authorised")).toHaveAttribute("data-tone", "blue");
		expect(within(live).getByText("Mar 1, 2026")).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "PO-0042" })).toHaveAttribute(
			"href",
			"/purchases/pu-1"
		);
	});

	it("shows the base total, with the document total under it for a foreign order", async () => {
		rows = [row({ currency: "EUR", total: 92, totalBase: 100 })];
		render(<PurchasesPage />);
		const tr = (await screen.findByText("PO-0042")).closest("tr")!;
		expect(within(tr).getByText("$100.00")).toBeInTheDocument();
		expect(within(tr).getByText("€92.00")).toBeInTheDocument();
	});

	it("builds the status filter from the data, not a fixed list", async () => {
		rows = [row()];
		render(<PurchasesPage />);
		await screen.findByText("PO-0042");
		const user = userEvent.setup();
		await user.click(screen.getByRole("button", { name: /^Status/ }));
		expect(
			await screen.findByRole("option", { name: "Partially received" })
		).toBeInTheDocument();
		await user.click(screen.getByRole("option", { name: "Voided" }));
		await waitFor(() => expect(listCalls().at(-1)!.get("status")).toBe("VOIDED"));
	});

	it("filters by supplier and sends the typed search after the debounce", async () => {
		rows = [row()];
		render(<PurchasesPage />);
		await screen.findByText("PO-0042");
		const user = userEvent.setup();
		await user.click(screen.getByRole("button", { name: /^Supplier/ }));
		await user.click(await screen.findByRole("option", { name: "Acme Supply" }));
		await waitFor(() => expect(listCalls().at(-1)!.get("supplierId")).toBe("s1"));
		await user.type(screen.getByPlaceholderText(/Search by order number/), "acme");
		await waitFor(() => expect(listCalls().at(-1)!.get("search")).toBe("acme"));
	});

	it("sorts through the API and sends inclusive from/to for a date range", async () => {
		rows = [row()];
		render(<PurchasesPage />);
		await screen.findByText("PO-0042");
		const user = userEvent.setup();
		await user.click(screen.getByRole("columnheader", { name: /Total/ }));
		await waitFor(() => expect(listCalls().at(-1)!.get("sort")).toBe("totalBase"));
		await user.click(screen.getByRole("button", { name: /Order date/ }));
		await user.click(screen.getByRole("option", { name: "Today" }));
		await waitFor(() => {
			const q = listCalls().at(-1)!;
			expect(q.get("from")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
			expect(q.get("to")).toBe(q.get("from"));
		});
	});

	it("resolves the Today preset in the Cin7 zone, not the browser zone, and labels the chip with it", async () => {
		// 2026-03-15 23:30 in Los Angeles is already March 16 in Tokyo.
		rows = [row()];
		setFormatContext({ timeZone: "Asia/Tokyo" });
		vi.useFakeTimers({ now: new Date("2026-03-16T06:30:00Z"), toFake: ["Date"] });
		try {
			render(<PurchasesPage />);
			await screen.findByText("PO-0042");
			const user = userEvent.setup();
			await user.click(screen.getByRole("button", { name: /Order date/ }));
			await user.click(screen.getByRole("option", { name: "Today" }));
			await waitFor(() => {
				const q = listCalls().at(-1)!;
				expect(q.get("from")).toBe("2026-03-16");
				expect(q.get("to")).toBe("2026-03-16");
			});
			expect(
				screen.getByText("Order date: Today (Mar 16, 2026)")
			).toBeInTheDocument();
		} finally {
			vi.useRealTimers();
			setFormatContext({
				timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
			});
		}
	});

	it("skips the document-currency line when a foreign order totals zero", async () => {
		rows = [row({ currency: "EUR", total: 0, totalBase: 0 })];
		render(<PurchasesPage />);
		const tr = (await screen.findByText("PO-0042")).closest("tr")!;
		expect(within(tr).getByText("$0.00")).toBeInTheDocument();
		expect(within(tr).queryByText("€0.00")).toBeNull();
	});

	it("shows Cin7 enums in sentence case in the table", async () => {
		rows = [row()];
		render(<PurchasesPage />);
		const tr = (await screen.findByText("PO-0042")).closest("tr")!;
		expect(within(tr).getByText("Fully received")).toBeInTheDocument();
		expect(within(tr).getByText("Invoiced")).toBeInTheDocument();
		expect(within(tr).queryByText("FULLY RECEIVED")).toBeNull();
	});

	it("says so when there are no purchases", async () => {
		rows = [];
		render(<PurchasesPage />);
		expect(await screen.findByText("No purchases yet")).toBeInTheDocument();
	});
});

describe("PurchasesPage export", () => {
	it("links the server export with supplier and status, and no paging", async () => {
		rows = [row()];
		render(<PurchasesPage />);
		await screen.findByText("PO-0042");
		const user = userEvent.setup();
		await user.click(screen.getByRole("button", { name: /^Supplier/ }));
		await user.click(await screen.findByRole("option", { name: "Acme Supply" }));
		await user.click(screen.getByRole("button", { name: /^Status/ }));
		await user.click(await screen.findByRole("option", { name: "Voided" }));
		await waitFor(() => expect(listCalls().at(-1)!.get("status")).toBe("VOIDED"));
		const link = await screen.findByRole("link", { name: "Export CSV" });
		const url = new URL(link.getAttribute("href")!, "http://x");
		expect(url.pathname).toBe("/api/purchases/export.csv");
		expect(url.searchParams.get("supplierId")).toBe("s1");
		expect(url.searchParams.get("status")).toBe("VOIDED");
		expect(url.searchParams.has("page")).toBe(false);
		expect(url.searchParams.has("limit")).toBe(false);
	});

	it("carries the from/to of a date preset", async () => {
		rows = [row()];
		render(<PurchasesPage />);
		await screen.findByText("PO-0042");
		const user = userEvent.setup();
		await user.click(screen.getByRole("button", { name: /Order date/ }));
		await user.click(await screen.findByText("Last 7 days"));
		await waitFor(() => expect(listCalls().at(-1)!.get("from")).toBeTruthy());
		const link = await screen.findByRole("link", { name: "Export CSV" });
		const url = new URL(link.getAttribute("href")!, "http://x");
		expect(url.searchParams.get("from")).toBe(listCalls().at(-1)!.get("from"));
		expect(url.searchParams.get("to")).toBe(listCalls().at(-1)!.get("to"));
	});
});

describe("PurchaseDetailPage", () => {
	const detail: PurchaseDetail = {
		purchase: {
			id: "pu-1",
			orderNumber: "PO-0042",
			type: "Simple Purchase",
			status: "RECEIVED",
			counted: true,
			orderDate: "2026-03-01",
			supplierId: "s1",
			supplier: "Acme Supply",
			currency: "EUR",
			baseCurrency: "USD",
			currencyRate: 0.92,
			total: 92,
			totalBase: 100,
			receivingStatus: "FULLY RECEIVED",
			invoiceStatus: "INVOICED",
			syncedAt: "2026-03-02T10:00:00.000Z",
		},
		lines: [
			{
				lineNo: 1,
				productId: "p1",
				sku: "SKU-1",
				name: "Copper pipe",
				quantity: 4,
				unitPrice: 23,
				discountPct: 0,
				unitCostBase: 25,
				totalBase: 100,
				thumbUrl: "/api/images/i1/thumb",
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
				<MemoryRouter initialEntries={["/purchases/pu-1"]}>
					<Routes>
						<Route
							path="/purchases/:id"
							element={<PurchaseDetailPage />}
						/>
					</Routes>
				</MemoryRouter>
			</QueryClientProvider>
		);

	it("shows base total with the document total and rate, lines with unit cost and thumbnail", async () => {
		fetchSpy.mockImplementation(async () => reply(detail));
		renderDetail();
		expect(await screen.findByRole("heading", { name: "PO-0042" })).toBeInTheDocument();
		expect(screen.getByText("Received")).toHaveAttribute("data-tone", "green");
		expect(screen.getAllByText("$100.00").length).toBeGreaterThan(0);
		expect(screen.getByText(/€92\.00 · 1 EUR = 0\.92 USD/)).toBeInTheDocument();
		expect(screen.getByText("Fully received")).toBeInTheDocument();
		const tr = screen.getByText("Copper pipe").closest("tr")!;
		expect(within(tr).getByText("$25.00")).toBeInTheDocument();
		expect(within(tr).getByRole("img", { name: "Copper pipe" })).toHaveAttribute(
			"src",
			"/api/images/i1/thumb"
		);
		expect(within(tr).getByRole("link", { name: "SKU-1" })).toHaveAttribute(
			"href",
			"/products/p1"
		);
	});

	it("shows a not-found state for an unknown order", async () => {
		fetchSpy.mockImplementation(async () => reply(null, undefined, 404));
		renderDetail();
		expect(await screen.findByText("Purchase not found")).toBeInTheDocument();
	});
});
