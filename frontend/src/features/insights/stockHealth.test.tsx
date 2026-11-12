import { cloneElement, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { render, screen, waitFor, within } from "../../test/testUtils";
import { setFormatContext } from "../../lib/format";
import { fetchInsightsStock, SLOW_MOVER_DAYS, type InsightsStock } from "./api";
import SlowMoversCard from "./SlowMoversCard";
import StockAgeCard from "./StockAgeCard";
import StockValueCard from "./StockValueCard";

vi.mock("./api", async () => {
	const actual = await vi.importActual<typeof import("./api")>("./api");
	return { ...actual, fetchInsightsStock: vi.fn() };
});

// jsdom measures everything as 0x0; a fixed size lets the charts render.
vi.mock("recharts", async () => {
	const actual = await vi.importActual<typeof import("recharts")>("recharts");
	return {
		...actual,
		ResponsiveContainer: ({
			children,
		}: {
			children: ReactElement<{ width?: number; height?: number }>;
		}) => cloneElement(children, { width: 400, height: 240 }),
	};
});

const stockMock = fetchInsightsStock as unknown as MockInstance;

const BUCKETS = ["0-30", "31-90", "91-180", "181-365", "365+", "none"] as const;

const stock = (over: Partial<InsightsStock> = {}): InsightsStock => ({
	valueHistory: [
		{ day: "2026-11-10", value: 1000, units: 10 },
		{ day: "2026-11-11", value: 1200, units: 12 },
	],
	trackingSince: "2026-11-10",
	age: BUCKETS.map((bucket, i) => ({
		bucket,
		value: (i + 1) * 100,
		units: i + 1,
		products: i + 1,
	})),
	slowMovers: [
		{
			productId: "p1",
			name: "Rack Rail",
			sku: "RR-1",
			thumbUrl: null,
			onHand: 4,
			value: 800,
			lastSold: "2026-05-02",
		},
		{
			productId: "p2",
			name: "Patch Cable",
			sku: "PC-1",
			thumbUrl: null,
			onHand: 9,
			value: 90,
			lastSold: null,
		},
	],
	...over,
});

beforeEach(() => {
	setFormatContext({ currency: "USD", timeZone: "America/Los_Angeles" });
	stockMock.mockReset();
	stockMock.mockResolvedValue(stock());
});

describe("StockValueCard", () => {
	it("draws a line and the tracking-since chip with 2+ days", async () => {
		const { container } = render(<StockValueCard />);
		expect(await screen.findByText("Tracking since Nov 10, 2026")).toBeInTheDocument();
		expect(container.querySelector(".recharts-line")).not.toBeNull();
	});

	it("shows the empty state with fewer than 2 days", async () => {
		stockMock.mockResolvedValue(
			stock({
				valueHistory: [{ day: "2026-11-10", value: 1000, units: 10 }],
			})
		);
		render(<StockValueCard />);
		expect(
			await screen.findByText(
				"Stock value is recorded once a day from the first sync"
			)
		).toBeInTheDocument();
		expect(screen.queryByText(/Tracking since/)).not.toBeInTheDocument();
	});

	it("shows an error state with a retry on a failed read", async () => {
		stockMock.mockRejectedValue(new Error("boom"));
		render(<StockValueCard />);
		expect(await screen.findByText("Couldn't load stock value")).toBeInTheDocument();
	});
});

describe("StockAgeCard", () => {
	it("renders the six buckets in order with the hint", async () => {
		render(<StockAgeCard />);
		const list = await screen.findByRole("list", { name: "Stock value by age" });
		const items = within(list).getAllByRole("listitem");
		expect(items.map((li) => li.querySelector("[data-label]")?.textContent)).toEqual([
			"0–30 days",
			"31–90 days",
			"91–180 days",
			"181–365 days",
			"Over 365 days",
			"No purchase on record",
		]);
		expect(
			screen.getByText(
				"Age is measured from the product's last purchase, not from each unit's receipt."
			)
		).toBeInTheDocument();
		expect(screen.getByText("Positive stock $2,100.00")).toBeInTheDocument();
	});
});

describe("SlowMoversCard", () => {
	it("shows Never for a product never sold and links each row to the product", async () => {
		render(<SlowMoversCard />);
		expect(await screen.findByText(/Never sold/)).toBeInTheDocument();
		expect(screen.getByText(/last sold May 2, 2026/)).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "Rack Rail" })).toHaveAttribute(
			"href",
			"/products/p1"
		);
		expect(screen.getByRole("link", { name: "Patch Cable" })).toHaveAttribute(
			"href",
			"/products/p2"
		);
	});

	it("gives each product link a title with the full name and states the window from the constant", async () => {
		render(<SlowMoversCard />);
		expect(await screen.findByRole("link", { name: "Rack Rail" })).toHaveAttribute(
			"title",
			"Rack Rail"
		);
		expect(
			screen.getByText(
				`In stock, with no sale in the last ${SLOW_MOVER_DAYS} days.`
			)
		).toBeInTheDocument();
	});

	it("says so when nothing is slow", async () => {
		stockMock.mockResolvedValue(stock({ slowMovers: [] }));
		render(<SlowMoversCard />);
		await waitFor(() => expect(screen.getByText("No slow movers")).toBeInTheDocument());
	});
});
