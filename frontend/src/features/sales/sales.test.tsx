import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { clickExport } from "../../test/clickExport";
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
	it("hides drafts by default with a visible chip, and one click shows them", async () => {
		rows = [row()];
		render(<SalesPage />);
		await screen.findByText("SO-0007");
		expect(listCalls().at(-1)!.get("excludeStatus")).toBe("DRAFT");
		expect(screen.getByText("Drafts hidden")).toBeInTheDocument();
		await userEvent
			.setup()
			.click(screen.getByRole("button", { name: "Remove Drafts hidden filter" }));
		await waitFor(() => expect(listCalls().at(-1)!.has("excludeStatus")).toBe(false));
		expect(screen.queryByText("Drafts hidden")).toBeNull();
	});

	it("picking a status replaces the draft exclusion", async () => {
		rows = [row()];
		render(<SalesPage />);
		await screen.findByText("SO-0007");
		const user = userEvent.setup();
		await user.click(screen.getByRole("button", { name: /^Status/, expanded: false }));
		await user.click(await screen.findByRole("option", { name: "Picking" }));
		await waitFor(() => expect(listCalls().at(-1)!.get("status")).toBe("PICKING"));
		expect(listCalls().at(-1)!.has("excludeStatus")).toBe(false);
		expect(screen.queryByText("Drafts hidden")).toBeNull();
	});

	it("lists voided and draft orders with their status pill once drafts are shown", async () => {
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
		await screen.findByText("SO-0008");
		await userEvent
			.setup()
			.click(screen.getByRole("button", { name: "Remove Drafts hidden filter" }));
		await waitFor(() => expect(listCalls().at(-1)!.has("excludeStatus")).toBe(false));
		const voided = screen.getByText("SO-0008").closest("tr")!;
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
		await user.click(screen.getByRole("button", { name: /^Status/, expanded: false }));
		await user.click(await screen.findByRole("option", { name: "Picking" }));
		await waitFor(() => expect(listCalls().at(-1)!.get("status")).toBe("PICKING"));
		await user.click(screen.getByRole("button", { name: /^Tier/, expanded: false }));
		await user.click(await screen.findByRole("option", { name: "Wholesale" }));
		await waitFor(() => expect(listCalls().at(-1)!.get("tier")).toBe("Wholesale"));
		await user.click(
			screen.getByRole("button", { name: /^Customer/, expanded: false })
		);
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

describe("SalesPage facet failures", () => {
	afterEach(() => window.history.replaceState(null, "", "/"));

	it("says the customer name couldn't load, and Try again refetches the options", async () => {
		rows = [row()];
		window.history.replaceState(null, "", "/sales?customerId=c1");
		let down = true;
		fetchSpy.mockImplementation(async (url) => {
			if (String(url).startsWith("/api/sales/facets"))
				return down
					? new Response("<html>bad gateway</html>", { status: 502 })
					: reply({
							statuses: ["COMPLETED"],
							customers: [{ id: "c1", name: "Initech" }],
							tiers: ["Retail"],
						});
			return reply(rows, rows.length);
		});
		render(<SalesPage />);
		expect(
			await screen.findByText("Customer: (couldn't load name)")
		).toBeInTheDocument();
		expect(screen.queryByText("Customer: …")).toBeNull();
		const user = userEvent.setup();
		await user.click(
			screen.getByRole("button", { name: /^Customer/, expanded: false })
		);
		const list = screen.getByRole("listbox", { name: "Customer" });
		expect(within(list).getByText("Couldn't load options.")).toBeInTheDocument();
		down = false;
		await user.click(within(list).getByRole("button", { name: "Try again" }));
		expect((await screen.findAllByText("Customer: Initech")).length).toBeGreaterThan(0);
	});
});

describe("SalesPage export", () => {
	it("requests the server export with customer and tier, and no paging", async () => {
		rows = [row()];
		render(<SalesPage />);
		await screen.findByText("SO-0007");
		const user = userEvent.setup();
		await user.click(screen.getByRole("button", { name: /^Tier/, expanded: false }));
		await user.click(await screen.findByRole("option", { name: "Wholesale" }));
		await user.click(
			screen.getByRole("button", { name: /^Customer/, expanded: false })
		);
		await user.click(await screen.findByRole("option", { name: "Initech" }));
		await waitFor(() => expect(listCalls().at(-1)!.get("customerId")).toBe("c1"));
		const url = await clickExport(fetchSpy);
		expect(url.pathname).toBe("/api/sales/export.csv");
		expect(url.searchParams.get("customerId")).toBe("c1");
		expect(url.searchParams.get("tier")).toBe("Wholesale");
		expect(url.searchParams.has("page")).toBe(false);
		expect(url.searchParams.has("limit")).toBe(false);
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
		creditNotes: [],
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

	it("lists credit notes in a card with number, date, status, total and lines; drafts read as not counted", async () => {
		fetchSpy.mockImplementation(async () =>
			reply({
				...detail,
				creditNotes: [
					{
						id: "cn-1",
						number: "CN-0001",
						date: "2026-03-10",
						status: "AUTHORISED",
						counted: true,
						totalBase: 100,
						lines: [
							{
								sku: "SKU-1",
								name: "Copper pipe",
								quantity: 1,
								unitPriceBase: 100,
								totalBase: 100,
							},
						],
					},
					{
						id: "cn-2",
						number: "CN-0002",
						date: "2026-03-12",
						status: "DRAFT",
						counted: false,
						totalBase: 50,
						lines: [
							{
								sku: "SKU-9",
								name: "Elbow joint",
								quantity: 2,
								unitPriceBase: 25,
								totalBase: 50,
							},
						],
					},
				],
			})
		);
		renderDetail();
		expect(await screen.findByText("Credit notes")).toBeInTheDocument();
		const card = screen.getByRole("table", { name: "Credit notes" });
		const ok = within(card).getByText("CN-0001").closest("tr")!;
		expect(within(ok).getByText("Mar 10, 2026")).toBeInTheDocument();
		expect(within(ok).getByText("Authorised")).toBeInTheDocument();
		expect(within(ok).getByText("$100.00")).toBeInTheDocument();
		expect(within(ok).queryByText("Not counted")).not.toBeInTheDocument();
		expect(within(card).getByText("Copper pipe")).toBeInTheDocument();
		const draft = within(card).getByText("CN-0002").closest("tr")!;
		expect(within(draft).getByText("Draft")).toBeInTheDocument();
		expect(within(draft).getByText("Not counted")).toBeInTheDocument();
		expect(within(card).getByText("Elbow joint")).toBeInTheDocument();
	});

	it("shows a dash for a credit note with no number or date", async () => {
		fetchSpy.mockImplementation(async () =>
			reply({
				...detail,
				creditNotes: [
					{
						id: "cn-3",
						number: null,
						date: null,
						status: "AUTHORISED",
						counted: true,
						totalBase: 10,
						lines: [
							{
								sku: "SKU-7",
								name: "Gasket",
								quantity: 1,
								unitPriceBase: 10,
								totalBase: 10,
							},
						],
					},
				],
			})
		);
		renderDetail();
		const table = await screen.findByRole("table", { name: "Credit notes" });
		const row = within(table).getByText("Authorised").closest("tr")!;
		expect(within(row).getAllByText("—").length).toBe(2);
		expect(table.textContent).not.toContain(String.fromCharCode(0xfffd));
	});

	it("renders no credit notes card when there are none", async () => {
		fetchSpy.mockImplementation(async () => reply(detail));
		renderDetail();
		await screen.findByRole("heading", { name: "SO-0007" });
		expect(screen.queryByText("Credit notes")).not.toBeInTheDocument();
	});

	it("shows a not-found state for an unknown order", async () => {
		fetchSpy.mockImplementation(async () => reply(null, undefined, 404));
		renderDetail();
		expect(await screen.findByText("Sale not found")).toBeInTheDocument();
	});
});
