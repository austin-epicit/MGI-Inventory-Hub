import { cloneElement, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, waitFor, within } from "../../test/testUtils";
import { setFormatContext } from "../../lib/format";
import {
	fetchInsightsBreakdown,
	fetchInsightsTrend,
	fetchTopProducts,
	type InsightsBreakdown,
	type InsightsTrend,
	type TopProducts,
} from "./api";
import BreakdownCard, { breakdownHref } from "./BreakdownCard";
import InsightsPage from "./InsightsPage";
import { mixColor, mixRows } from "./mixSeries";
import TrendCard from "./TrendCard";
import ProductsPage from "../products/ProductsPage";
import PurchasesPage from "../purchases/PurchasesPage";
import SalesPage from "../sales/SalesPage";
import { PERIOD_X_AXIS } from "../../components/charts/chartAxis";

vi.mock("./api", async () => {
	const actual = await vi.importActual<typeof import("./api")>("./api");
	return {
		...actual,
		fetchInsightsTrend: vi.fn(),
		fetchInsightsBreakdown: vi.fn(),
		fetchTopProducts: vi.fn(),
		fetchInsightsStock: vi.fn().mockResolvedValue({
			valueHistory: [],
			trackingSince: null,
			age: [],
			slowMovers: [],
		}),
	};
});

// jsdom measures everything as 0x0; a fixed size lets the charts render their ticks.
vi.mock("recharts", async () => {
	const actual = await vi.importActual<typeof import("recharts")>("recharts");
	return {
		...actual,
		ResponsiveContainer: ({
			children,
		}: {
			children: ReactElement<{ width?: number; height?: number }>;
		}) => cloneElement(children, { width: 800, height: 240 }),
	};
});

const trend = (over: Partial<InsightsTrend> = {}): InsightsTrend => ({
	period: "month",
	from: "2025-11-01",
	to: "2026-11-12",
	totals: { sales: 12345.5, purchases: 6789.25, grossProfit: 5000, grossMarginPct: 40.5 },
	points: [
		{
			start: "2026-10-01",
			label: "Oct",
			sales: 1000,
			purchases: 400,
			grossProfit: 300,
			grossMarginPct: 30,
			mix: { Servers: 600, Cables: 300, Uncategorised: 100 },
		},
		{
			start: "2026-11-01",
			label: "Nov 1–12",
			sales: 0,
			purchases: 250,
			grossProfit: 0,
			grossMarginPct: null,
			mix: { Servers: 0, Cables: 0, Uncategorised: 0 },
		},
	],
	mixKeys: ["Servers", "Cables", "Uncategorised"],
	...over,
});

const brow = (over: Partial<InsightsBreakdown["rows"][number]> = {}) => ({
	key: "Servers" as string | null,
	label: "Servers",
	amount: 600,
	grossProfit: 200,
	marginPct: 33.3,
	units: 12,
	orders: 4,
	products: 3,
	...over,
});
const breakdown = (over: Partial<InsightsBreakdown> = {}): InsightsBreakdown => ({
	by: "category",
	kind: "sales",
	total: 1000,
	rows: [brow(), brow({ key: null, label: "Uncategorised", amount: 300, units: 2 })],
	other: brow({ key: null, label: "Other (4)", amount: 100, units: 1 }),
	...over,
});
const tp = (over: Partial<TopProducts["rows"][number]> = {}) => ({
	productId: "p1",
	name: "Rack Server",
	sku: "SRV-1",
	thumbUrl: null,
	sales: 900,
	grossProfit: 300,
	marginPct: 33.3,
	units: 3,
	onHand: 7,
	...over,
});

const fetchMock = vi.mocked(fetchInsightsTrend);
const breakdownMock = vi.mocked(fetchInsightsBreakdown);
const topMock = vi.mocked(fetchTopProducts);

beforeEach(() => {
	setFormatContext({ currency: "USD", timeZone: "America/Los_Angeles" });
	fetchMock.mockReset();
	fetchMock.mockResolvedValue(trend());
	breakdownMock.mockReset();
	breakdownMock.mockResolvedValue(breakdown());
	topMock.mockReset();
	topMock.mockResolvedValue({ rows: [tp()] });
	window.history.replaceState(null, "", "/insights");
});
afterEach(() => vi.clearAllMocks());

describe("InsightsPage", () => {
	it("renders the title, range toggle and footnote, defaulting to 1y", async () => {
		render(<InsightsPage />);
		expect(screen.getByRole("heading", { name: "Insights" })).toBeInTheDocument();
		expect(screen.getByRole("group", { name: "Date range" })).toBeInTheDocument();
		expect(screen.getByText("Sales are net of credit notes.")).toBeInTheDocument();
		await waitFor(() => expect(fetchMock).toHaveBeenCalled());
		expect(fetchMock.mock.calls.every(([r]) => r === "1y")).toBe(true);
	});

	it("asks for the range in the URL", async () => {
		window.history.replaceState(null, "", "/insights?range=90d");
		render(<InsightsPage />);
		await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("90d"));
		expect(fetchMock).not.toHaveBeenCalledWith("1y");
	});

	it("keeps a picked range in the URL without pushing history", async () => {
		const user = userEvent.setup();
		const before = window.history.length;
		render(<InsightsPage />);
		await user.click(screen.getByRole("button", { name: "90d" }));
		await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("90d"));
		expect(window.location.search).toBe("?range=90d");
		expect(window.history.length).toBe(before);
	});

	it("shows an error with Retry when the trend can't load, and retries", async () => {
		const user = userEvent.setup();
		fetchMock.mockRejectedValue(new Error("boom"));
		render(<InsightsPage />);
		expect(
			await screen.findByText("Couldn't load sales and purchases")
		).toBeInTheDocument();
		expect(screen.getByText("Couldn't load the sales mix")).toBeInTheDocument();
		const calls = fetchMock.mock.calls.length;
		fetchMock.mockResolvedValue(trend());
		await user.click(screen.getAllByRole("button", { name: "Retry" })[0]!);
		await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(calls));
	});
});

describe("TrendCard", () => {
	it("shows the range totals as chips and the partial period's label", async () => {
		render(<InsightsPage />);
		expect(await screen.findByText("Sales $12,345.50")).toBeInTheDocument();
		expect(screen.getByText("Purchases $6,789.25")).toBeInTheDocument();
		expect(screen.getByText("Gross margin 40.5%")).toBeInTheDocument();
		expect(
			screen.getByRole("heading", { name: "Sales and purchases" })
		).toBeInTheDocument();
		expect(screen.getAllByText("Nov 1–12").length).toBeGreaterThan(0);
	});

	it("shows a dash for the margin chip when nothing costed sold", async () => {
		fetchMock.mockResolvedValue(
			trend({
				totals: {
					sales: 0,
					purchases: 10,
					grossProfit: 0,
					grossMarginPct: null,
				},
			})
		);
		render(<InsightsPage />);
		expect(await screen.findByText("Gross margin —")).toBeInTheDocument();
	});
});

describe("TrendCard alignment", () => {
	it("puts the periods on a band scale for every plot", () => {
		expect(PERIOD_X_AXIS.scale).toBe("band");
	});

	it("centres each margin dot on its period's bar group", async () => {
		fetchMock.mockResolvedValue(
			trend({
				points: ["A", "B", "C"].map((label, i) => ({
					start: `2026-0${i + 1}-01`,
					label,
					sales: 10 * (i + 1),
					purchases: 5,
					grossProfit: 2,
					grossMarginPct: 20,
					mix: {},
				})),
			})
		);
		const { container } = render(<TrendCard range="1y" />);
		await screen.findByText("A");
		const bars = [...container.querySelectorAll(".recharts-rectangle")].map((e) => ({
			x: Number(e.getAttribute("x")),
			w: Number(e.getAttribute("width")),
		}));
		const dots = [...container.querySelectorAll(".recharts-line-dot")].map((e) =>
			Number(e.getAttribute("cx"))
		);
		expect(bars).toHaveLength(6); // three Sales, then three Purchases
		expect(dots).toHaveLength(3);
		dots.forEach((cx, i) => {
			const sales = bars[i]!;
			const purchases = bars[i + 3]!;
			const groupCentre = (sales.x + purchases.x + purchases.w) / 2;
			expect(Math.abs(cx - groupCentre)).toBeLessThan(1);
		});
	});
});

describe("CategoryMixCard", () => {
	it("switches to shares summing to 100 per period", async () => {
		const user = userEvent.setup();
		render(<InsightsPage />);
		expect(
			await screen.findByRole("heading", { name: "Sales mix by category" })
		).toBeInTheDocument();
		expect(screen.queryByText("100%")).not.toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Share" }));
		expect(await screen.findByText("100%")).toBeInTheDocument();
	});

	it("names every category in the legend", async () => {
		render(<InsightsPage />);
		await screen.findByRole("heading", { name: "Sales mix by category" });
		for (const k of ["Servers", "Cables", "Uncategorised"])
			expect((await screen.findAllByText(k)).length).toBeGreaterThan(0); // the Breakdown table repeats some
	});
});

describe("mixRows", () => {
	const t = trend();

	it("keeps amounts as they are", () => {
		const rows = mixRows(t.points, t.mixKeys, "amount");
		expect(rows[0]).toEqual({
			label: "Oct",
			total: 1000,
			values: { Servers: 600, Cables: 300, Uncategorised: 100 },
		});
	});

	it("turns each period into shares that sum to 100", () => {
		const rows = mixRows(t.points, t.mixKeys, "share");
		expect(rows[0]!.values).toEqual({ Servers: 60, Cables: 30, Uncategorised: 10 });
		const sum = t.mixKeys.reduce((s, k) => s + rows[0]!.values[k]!, 0);
		expect(sum).toBeCloseTo(100, 6);
	});

	it("leaves a period with no sales at zero rather than NaN", () => {
		const rows = mixRows(t.points, t.mixKeys, "share");
		for (const k of t.mixKeys) expect(rows[1]!.values[k]).toBe(0);
	});
});

describe("mixColor", () => {
	it("gives named categories the slots in order and the tails neutrals", () => {
		expect(mixColor("Servers", 0)).toBe("var(--color-chart-cat-1)");
		expect(mixColor("Cables", 4)).toBe("var(--color-chart-cat-5)");
		expect(mixColor("Other", 5)).toBe("var(--color-chart-cat-other)");
		expect(mixColor("Uncategorised", 6)).toBe("var(--color-chart-cat-uncategorised)");
	});
});

describe("BreakdownCard", () => {
	it("defaults to category and shows the sales columns", async () => {
		render(<InsightsPage />);
		await waitFor(() => expect(breakdownMock).toHaveBeenCalledWith("1y", "category"));
		const table = await screen.findByRole("table", { name: "Breakdown by category" });
		for (const h of [
			"Category",
			"Sales",
			"Gross profit",
			"Margin %",
			"Units",
			"Orders",
		])
			expect(
				within(table).getByRole("columnheader", { name: h })
			).toBeInTheDocument();
		expect(screen.getByText("Other (4)")).toBeInTheDocument();
	});

	it("sets ?by= and refetches when the dimension changes", async () => {
		const user = userEvent.setup();
		render(<InsightsPage />);
		await screen.findByText("Other (4)");
		await user.click(screen.getByRole("button", { name: "Customer" }));
		await waitFor(() => expect(breakdownMock).toHaveBeenCalledWith("1y", "customer"));
		expect(window.location.search).toBe("?by=customer");
	});

	it("offers Grade in the picker and refetches by grade", async () => {
		const user = userEvent.setup();
		render(<InsightsPage />);
		await screen.findByText("Other (4)");
		await user.click(screen.getByRole("button", { name: "Grade" }));
		await waitFor(() => expect(breakdownMock).toHaveBeenCalledWith("1y", "grade"));
	});

	it("shows Spend / Units bought / POs / Products for suppliers", async () => {
		window.history.replaceState(null, "", "/insights?by=supplier");
		breakdownMock.mockResolvedValue(
			breakdown({
				by: "supplier",
				kind: "purchases",
				rows: [
					brow({
						key: "s1",
						label: "Acme",
						grossProfit: null,
						marginPct: null,
					}),
				],
				other: null,
			})
		);
		render(<InsightsPage />);
		const table = await screen.findByRole("table", { name: "Breakdown by supplier" });
		for (const h of ["Spend", "Units bought", "POs", "Products"])
			expect(
				within(table).getByRole("columnheader", { name: h })
			).toBeInTheDocument();
		expect(
			within(table).queryByRole("columnheader", { name: "Margin %" })
		).not.toBeInTheDocument();
		expect(screen.getByRole("link", { name: "Acme" })).toHaveAttribute(
			"href",
			"/purchases?supplierId=s1"
		);
	});

	it("links keyed rows, and leaves Uncategorised and Other as plain text", async () => {
		render(<InsightsPage />);
		expect(await screen.findByRole("link", { name: "Servers" })).toHaveAttribute(
			"href",
			"/products?category=Servers"
		);
		expect(
			within(
				screen.getByRole("table", { name: "Breakdown by category" })
			).getByText("Uncategorised")
		).toBeInTheDocument();
		expect(
			screen.queryByRole("link", { name: "Uncategorised" })
		).not.toBeInTheDocument();
		expect(screen.queryByRole("link", { name: /Other/ })).not.toBeInTheDocument();
	});

	it("sizes each bar against the largest amount", async () => {
		render(<BreakdownCard range="1y" by="category" onByChange={() => {}} />);
		await screen.findByRole("table", { name: "Breakdown by category" });
		const bars = screen.getAllByTestId("breakdown-bar");
		expect(bars[0]).toHaveStyle({ width: "100%" });
		expect(bars[1]).toHaveStyle({ width: "50%" });
	});

	it("says so when the range has no rows", async () => {
		breakdownMock.mockResolvedValue(breakdown({ rows: [], other: null, total: 0 }));
		render(<InsightsPage />);
		expect(
			await screen.findByText("Nothing to break down in this range")
		).toBeInTheDocument();
	});

	it("shows an error state when the breakdown can't load", async () => {
		breakdownMock.mockRejectedValue(new Error("boom"));
		render(<InsightsPage />);
		expect(await screen.findByText("Couldn't load the breakdown")).toBeInTheDocument();
	});
});

describe("breakdownHref", () => {
	it("maps each dimension to its list page filter, URL-encoded", () => {
		expect(breakdownHref("tier", "Wholesale")).toBe("/sales?tier=Wholesale");
		expect(breakdownHref("category", "Cables & Wire")).toBe(
			"/products?category=Cables%20%26%20Wire"
		);
		expect(breakdownHref("brand", "Acme")).toBe("/products?brand=Acme");
		expect(breakdownHref("customer", "c1")).toBe("/sales?customerId=c1");
		expect(breakdownHref("supplier", "s1")).toBe("/purchases?supplierId=s1");
	});
	it("maps grade to the products filter, with 'none' for ungraded", () => {
		expect(breakdownHref("grade", "A")).toBe("/products?grade=A");
		expect(breakdownHref("grade", null)).toBe("/products?grade=none");
	});
	it("returns null for a null key", () => {
		expect(breakdownHref("category", null)).toBeNull();
	});
});

describe("TopProductsCard", () => {
	it("lists products with their figures and a link to the product", async () => {
		render(<InsightsPage />);
		expect(await screen.findByRole("link", { name: /Rack Server/ })).toHaveAttribute(
			"href",
			"/products/p1"
		);
		const table = screen.getByRole("table", { name: "Top products" });
		expect(within(table).getByText("SRV-1")).toBeInTheDocument();
		expect(within(table).getByText("$900.00")).toBeInTheDocument();
		expect(within(table).getByText("33.3%")).toBeInTheDocument();
		for (const h of ["Sales", "Gross profit", "Margin %", "Units sold", "On hand"])
			expect(
				within(table).getByRole("columnheader", { name: h })
			).toBeInTheDocument();
		expect(topMock).toHaveBeenCalledWith("1y", "sales");
	});

	it("refetches with sort=profit when Gross profit is picked", async () => {
		const user = userEvent.setup();
		render(<InsightsPage />);
		await screen.findByRole("link", { name: /Rack Server/ });
		await user.click(screen.getByRole("button", { name: "Gross profit" }));
		await waitFor(() => expect(topMock).toHaveBeenCalledWith("1y", "profit"));
	});

	it("shows dashes for an uncosted product", async () => {
		topMock.mockResolvedValue({ rows: [tp({ grossProfit: null, marginPct: null })] });
		render(<InsightsPage />);
		await screen.findByRole("link", { name: /Rack Server/ });
		expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
	});
});

describe("list page deep links", () => {
	const reply = (data: unknown) =>
		new Response(
			JSON.stringify({ success: true, data, error: null, meta: { count: 0 } }),
			{
				status: 200,
				headers: { "Content-Type": "application/json" },
			}
		);
	let spy: MockInstance<typeof fetch>;
	const calls = (prefix: string) =>
		spy.mock.calls
			.map(([u]) => String(u))
			.filter((u) => u.startsWith(prefix))
			.map((u) => new URL(u, "http://x").searchParams);
	beforeEach(() => {
		spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
			const u = String(url);
			if (u.startsWith("/api/products/facets"))
				return reply({ categories: ["Servers"], brands: ["Acme"] });
			if (u.startsWith("/api/sales/facets"))
				return reply({
					statuses: [],
					customers: [{ id: "c-9", name: "Initech" }],
					tiers: ["Wholesale"],
				});
			if (u.startsWith("/api/purchases/facets"))
				return reply({
					statuses: [],
					suppliers: [{ id: "s-9", name: "Acme Supply" }],
				});
			return reply([]);
		});
	});
	afterEach(() => spy.mockRestore());

	it("Products reads category from the URL and shows the chip", async () => {
		window.history.replaceState(null, "", "/products?category=Servers");
		render(<ProductsPage />);
		await waitFor(() =>
			expect(calls("/api/products?")[0]?.get("category")).toBe("Servers")
		);
		expect(await screen.findByText("Category: Servers")).toBeInTheDocument();
	});

	it("Products reads brand from the URL", async () => {
		window.history.replaceState(null, "", "/products?brand=Acme");
		render(<ProductsPage />);
		await waitFor(() => expect(calls("/api/products?")[0]?.get("brand")).toBe("Acme"));
		expect(await screen.findByText("Brand: Acme")).toBeInTheDocument();
	});

	it("Sales reads customerId and shows the customer's name", async () => {
		window.history.replaceState(null, "", "/sales?customerId=c-9");
		render(<SalesPage />);
		await waitFor(() => expect(calls("/api/sales?")[0]?.get("customerId")).toBe("c-9"));
		// Once on the chip and once on the dropdown trigger.
		await waitFor(() =>
			expect(screen.getAllByText(/Initech/).length).toBeGreaterThanOrEqual(2)
		);
		expect(screen.queryByText("Customer: Unknown")).not.toBeInTheDocument();
	});

	it("Sales reads tier from the URL", async () => {
		window.history.replaceState(null, "", "/sales?tier=Wholesale");
		render(<SalesPage />);
		await waitFor(() => expect(calls("/api/sales?")[0]?.get("tier")).toBe("Wholesale"));
		expect(await screen.findByText("Tier: Wholesale")).toBeInTheDocument();
	});

	it("Purchases reads supplierId and shows the supplier's name", async () => {
		window.history.replaceState(null, "", "/purchases?supplierId=s-9");
		render(<PurchasesPage />);
		await waitFor(() =>
			expect(calls("/api/purchases?")[0]?.get("supplierId")).toBe("s-9")
		);
		await waitFor(() =>
			expect(screen.getAllByText(/Acme Supply/).length).toBeGreaterThanOrEqual(2)
		);
		expect(screen.queryByText(/Unknown/)).not.toBeInTheDocument();
	});
});
