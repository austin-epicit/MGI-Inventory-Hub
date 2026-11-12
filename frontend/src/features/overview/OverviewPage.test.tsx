import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, waitFor, within } from "../../test/testUtils";
import { setFormatContext } from "../../lib/format";
import type { Overview } from "./api";
import OverviewPage from "./OverviewPage";

const overview = (over: Partial<Overview> = {}): Overview => ({
	kpis: {
		stockValue: 12345.5,
		unitsOnHand: 321,
		sales: 2000,
		purchases: 1500.25,
		grossMarginPct: 42.5,
	},
	costMovers: [
		{
			productId: "p-up",
			name: "Rising Widget",
			sku: "RW-1",
			thumbUrl: null,
			lastCost: 12,
			priorAvgCost: 10,
			changePct: 20,
		},
		{
			productId: "p-down",
			name: "Falling Widget",
			sku: "FW-1",
			thumbUrl: null,
			lastCost: 8,
			priorAvgCost: 10,
			changePct: -20,
		},
	],
	recentPurchases: [
		{
			id: "pu-1",
			orderNumber: "PO-0042",
			orderDate: "2026-03-01",
			party: "Acme Supply",
			status: "AUTHORISED",
			totalBase: 100,
		},
	],
	recentSales: [
		{
			id: "so-1",
			orderNumber: "SO-0007",
			orderDate: "2026-02-28",
			party: "Initech",
			status: "AUTHORISED",
			totalBase: 55,
		},
	],
	lastSyncAt: "2026-03-01T18:00:00.000Z",
	...over,
});

let data: Overview;
let fetchSpy: MockInstance<typeof fetch>;
const calls = () => fetchSpy.mock.calls.map(([u]) => String(u));

beforeEach(() => {
	setFormatContext({ currency: "USD", timeZone: "America/Los_Angeles" });
	data = overview();
	fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
		async () =>
			new Response(JSON.stringify({ success: true, data, error: null }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			})
	);
});
afterEach(() => vi.restoreAllMocks());

describe("OverviewPage", () => {
	it("shows the KPIs in base money and the chosen range as their hint", async () => {
		render(<OverviewPage />);
		expect(await screen.findByText("$12,345.50")).toBeInTheDocument();
		expect(screen.getByText("321")).toBeInTheDocument();
		expect(screen.getByText("$2,000.00")).toBeInTheDocument();
		expect(screen.getByText("$1,500.25")).toBeInTheDocument();
		expect(screen.getByText("42.5%")).toBeInTheDocument();
		expect(screen.getAllByText("Last 30 days")).toHaveLength(3);
		expect(calls()).toEqual(["/api/overview?range=30d"]);
	});

	it("shows a dash for the margin when nothing sold", async () => {
		data = overview({ kpis: { ...overview().kpis, grossMarginPct: null } });
		render(<OverviewPage />);
		await screen.findByText("$12,345.50");
		const tile = screen.getByText("Gross margin").parentElement!;
		expect(within(tile).getByText("—")).toBeInTheDocument();
	});

	it("re-queries with the picked range", async () => {
		render(<OverviewPage />);
		await screen.findByText("$12,345.50");
		await userEvent.setup().click(screen.getByRole("button", { name: "90d" }));
		await waitFor(() => expect(calls().at(-1)).toBe("/api/overview?range=90d"));
		expect((await screen.findAllByText("Last 90 days")).length).toBe(3);
	});

	it("reads a rising cost in the bad tone and a falling one in the good tone", async () => {
		render(<OverviewPage />);
		const up = (await screen.findByText("+20.0%")).closest("span")!;
		expect(up.className).toContain("text-error-text");
		const down = screen.getByText("-20.0%").closest("span")!;
		expect(down.className).toContain("text-success-text");
	});

	it("shows a placeholder for a mover without a picture", async () => {
		render(<OverviewPage />);
		await screen.findByText("Rising Widget");
		expect(screen.getAllByTestId("thumb-placeholder")).toHaveLength(2);
	});

	it("links movers and recent orders to their pages", async () => {
		render(<OverviewPage />);
		expect(await screen.findByRole("link", { name: /Rising Widget/ })).toHaveAttribute(
			"href",
			"/products/p-up"
		);
		expect(screen.getByRole("link", { name: /PO-0042/ })).toHaveAttribute(
			"href",
			"/purchases/pu-1"
		);
		expect(screen.getByRole("link", { name: /SO-0007/ })).toHaveAttribute(
			"href",
			"/sales/so-1"
		);
		expect(screen.getByText(/Initech · Feb 28, 2026/)).toBeInTheDocument();
	});

	it("explains empty lists and an unsynced shop", async () => {
		data = overview({
			costMovers: [],
			recentPurchases: [],
			recentSales: [],
			lastSyncAt: null,
		});
		render(<OverviewPage />);
		expect(await screen.findByText("No cost changes to show")).toBeInTheDocument();
		expect(screen.getByText("No purchases yet")).toBeInTheDocument();
		expect(screen.getByText("No sales yet")).toBeInTheDocument();
		expect(screen.getByText("Not synced yet")).toBeInTheDocument();
	});

	it("says so when the overview cannot load", async () => {
		fetchSpy.mockImplementation(
			async () =>
				new Response(
					JSON.stringify({
						success: false,
						data: null,
						error: { code: "X", message: "boom" },
					}),
					{
						status: 500,
						headers: { "Content-Type": "application/json" },
					}
				)
		);
		render(<OverviewPage />);
		expect(await screen.findByText("Could not load the overview")).toBeInTheDocument();
	});
});
