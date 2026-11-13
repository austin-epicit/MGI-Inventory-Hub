import { cloneElement, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen } from "../../test/testUtils";
import { setFormatContext } from "../../lib/format";
import type { PriceHistory } from "../../types/priceHistory";
import CostPriceChart from "./CostPriceChart";

// jsdom measures everything as 0x0; a fixed size lets the chart render for real.
vi.mock("recharts", async () => {
	const actual = await vi.importActual<typeof import("recharts")>("recharts");
	return {
		...actual,
		ResponsiveContainer: ({
			children,
		}: {
			children: ReactElement<{ width?: number; height?: number }>;
		}) => cloneElement(children, { width: 800, height: 300 }),
	};
});

const history = (over: Partial<PriceHistory> = {}): PriceHistory => ({
	range: { from: "2026-01-01", to: "2026-03-31" },
	bucket: "week",
	purchaseCost: [
		{
			date: "2026-01-20",
			unitCost: 400,
			qty: 2,
			purchaseId: "po-1",
			orderNumber: "PO-1",
			supplier: "Acme",
		},
	],
	averageCost: [{ date: "2026-01-01", value: 390 }],
	listPrices: [],
	soldPrices: [],
	listTrackingStartedAt: null,
	stats: {
		lastPurchaseCost: 450,
		purchaseCostChangePct: 12.5,
		averageCost: 390,
		avgSoldPrice: null,
		marginPct: null,
	},
	...over,
});

const tiered = (n: number): Partial<PriceHistory> => ({
	listPrices: Array.from({ length: n }, (_, i) => ({
		code: i + 1,
		name: `Tier ${i + 1}`,
		points: [{ date: "2026-01-01", value: 500 + i }],
	})),
	soldPrices: Array.from({ length: n }, (_, i) => ({
		tierName: `Tier ${i + 1}`,
		buckets: [{ start: "2026-01-05", avg: 480 + i, min: 470, max: 490, units: 10 - i }],
	})),
});

const renderChart = (
	h: PriceHistory | undefined,
	extra: { isLoading?: boolean; isStale?: boolean } = {}
) =>
	render(
		<CostPriceChart
			history={h}
			isLoading={extra.isLoading ?? false}
			isStale={extra.isStale ?? false}
			error={null}
			onRetry={vi.fn()}
			range="90d"
			onRangeChange={vi.fn()}
		/>
	);

const chip = (name: string) => screen.getByRole("button", { name });

beforeEach(() => setFormatContext({ currency: "USD" }));

describe("CostPriceChart", () => {
	it("every tier at 0: cost series stay on and the chart says no list prices are set", () => {
		renderChart(history());
		expect(screen.getByText("No list prices set in Cin7")).toBeInTheDocument();
		expect(chip("Purchase cost")).toHaveAttribute("aria-pressed", "true");
		expect(chip("Average cost")).toHaveAttribute("aria-pressed", "true");
		expect(screen.queryByRole("button", { name: /^List price/ })).toBeNull();
	});

	it("no purchases and no sales: an empty state, not a blank plot", () => {
		renderChart(
			history({
				purchaseCost: [],
				...tiered(1),
				soldPrices: [],
			})
		);
		expect(screen.getByText("No purchases or sales in this range")).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Purchase cost" })).toBeNull();
		// The range control stays so a longer range can be picked.
		expect(screen.getByRole("group", { name: "History range" })).toBeInTheDocument();
	});

	it("chips toggle series, and a fifth tier waits until one of four is hidden", async () => {
		const user = userEvent.setup();
		renderChart(history(tiered(5)));
		expect(chip("Sold price — Tier 1")).toHaveAttribute("aria-pressed", "true");
		expect(chip("List price — Tier 5")).toHaveAttribute("aria-pressed", "false");
		expect(chip("List price — Tier 5")).toBeDisabled();
		await user.click(chip("Sold price — Tier 2"));
		await user.click(chip("List price — Tier 2"));
		expect(chip("List price — Tier 2")).toHaveAttribute("aria-pressed", "false");
		expect(chip("List price — Tier 5")).toBeEnabled();
		await user.click(chip("List price — Tier 5"));
		expect(chip("List price — Tier 5")).toHaveAttribute("aria-pressed", "true");
	});

	it("headline strip: rising purchase cost reads in the warning tone, not error red", () => {
		renderChart(history());
		const delta = screen.getByText("+12.5%");
		expect(delta.closest("span")).toHaveClass("text-warning-text");
		expect(delta.closest("span")).not.toHaveClass("text-error-text");
		expect(screen.getByText("$450.00")).toBeInTheDocument();
	});

	it("headline strip: falling purchase cost reads in the success tone", () => {
		renderChart(history({ stats: { ...history().stats, purchaseCostChangePct: -8 } }));
		expect(screen.getByText(/8\.0%/).closest("span")).toHaveClass("text-success-text");
	});

	it("headline strip: the last purchase cost says it is scoped to the range", () => {
		renderChart(
			history({ stats: { ...history().stats, purchaseCostChangePct: null } })
		);
		expect(screen.getByText("In selected range")).toBeInTheDocument();
	});

	it("headline strip: no purchase in the range says so instead of a bare dash", () => {
		renderChart(
			history({
				stats: {
					...history().stats,
					lastPurchaseCost: null,
					purchaseCostChangePct: null,
				},
			})
		);
		expect(screen.getByText("No purchase in range")).toBeInTheDocument();
	});

	it("margin mode needs sales; with them it can be picked", async () => {
		renderChart(history());
		expect(screen.getByRole("button", { name: "Margin" })).toBeDisabled();
		const user = userEvent.setup();
		renderChart(history(tiered(1)));
		const margin = screen.getAllByRole("button", { name: "Margin" })[1]!;
		await user.click(margin);
		expect(margin).toHaveAttribute("aria-pressed", "true");
	});

	it("loading shows a spinner and no chips", () => {
		renderChart(undefined, { isLoading: true });
		expect(screen.getByLabelText("Loading price history")).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Purchase cost" })).toBeNull();
	});

	it("axis ticks are the API calendar dates, never shifted a day by the browser zone", () => {
		const { container } = renderChart(
			history({
				range: { from: "2026-03-01", to: "2026-03-29" },
				purchaseCost: [
					{
						date: "2026-03-01",
						unitCost: 400,
						qty: 1,
						purchaseId: "po-1",
						orderNumber: "PO-1",
						supplier: "Acme",
					},
				],
				averageCost: [{ date: "2026-03-01", value: 390 }],
			})
		);
		const ticks = [...container.querySelectorAll(".recharts-cartesian-axis-tick-value")]
			.map((t) => t.textContent ?? "")
			.filter((t) => /^[A-Z][a-z]{2} \d/.test(t));
		expect(ticks).toEqual([
			"Mar 1, 2026",
			"Mar 8, 2026",
			"Mar 15, 2026",
			"Mar 22, 2026",
			"Mar 29, 2026",
		]);
	});

	it("marks where list price tracking began when that falls inside the range", () => {
		const h = history({ ...tiered(1), listTrackingStartedAt: "2026-02-01" });
		const { container, unmount } = renderChart(h);
		expect(container.textContent).toContain("List price tracking began");
		unmount();
		const before = renderChart({ ...h, listTrackingStartedAt: "2025-06-01" });
		expect(before.container.textContent).not.toContain("List price tracking began");
	});

	it("labels the end of every visible series", () => {
		const { container } = renderChart(history(tiered(1)));
		const text = container.querySelector(".recharts-wrapper svg")!.textContent;
		expect(text).toContain("Average cost");
		expect(text).toContain("List price — Tier 1");
		expect(text).toContain("Sold price — Tier 1");
	});

	it("stacks end labels at least 16px apart even when two series end at nearly the same price", () => {
		const { container } = renderChart(history(tiered(1)));
		const ys = [...container.querySelectorAll(".recharts-wrapper svg text")]
			.filter((t) =>
				/^(Average cost|List price|Sold price)/.test(t.textContent ?? "")
			)
			.map((t) => Number(t.getAttribute("y")))
			.sort((a, b) => a - b);
		expect(ys.length).toBe(3);
		for (let i = 1; i < ys.length; i++)
			expect(ys[i]! - ys[i - 1]!).toBeGreaterThanOrEqual(16);
	});

	it("draws a hollow dot per purchase and sold-price dots only on real buckets", () => {
		const { container } = renderChart(
			history({
				...tiered(1),
				purchaseCost: [
					{
						date: "2026-01-08",
						unitCost: 400,
						qty: 2,
						purchaseId: "po-1",
						orderNumber: "PO-1",
						supplier: "Acme",
					},
				],
				soldPrices: [
					{
						tierName: "Tier 1",
						buckets: [
							{
								start: "2026-01-05",
								avg: 480,
								min: 480,
								max: 480,
								units: 2,
							},
							{
								start: "2026-01-12",
								avg: 490,
								min: 490,
								max: 490,
								units: 1,
							},
						],
					},
				],
			})
		);
		const circles = [...container.querySelectorAll(".recharts-wrapper circle")];
		expect(circles.filter((c) => c.getAttribute("r") === "4")).toHaveLength(1);
		expect(circles.filter((c) => c.getAttribute("r") === "3")).toHaveLength(2);
	});

	const yTicks = (container: HTMLElement) =>
		[...container.querySelectorAll(".recharts-cartesian-axis-tick-value")]
			.map((t) => t.textContent ?? "")
			.filter((t) => t.startsWith("$") || t.startsWith("-$"));

	it("amounts: the Y axis fits the prices instead of starting at $0", () => {
		const { container } = renderChart(
			history({
				purchaseCost: [
					{
						date: "2026-01-20",
						unitCost: 1440,
						qty: 1,
						purchaseId: "po-1",
						orderNumber: "PO-1",
						supplier: "Acme",
					},
				],
				averageCost: [
					{ date: "2026-01-01", value: 1450 },
					{ date: "2026-02-01", value: 1520 },
				],
			})
		);
		const ticks = yTicks(container);
		expect(ticks.length).toBeGreaterThan(2);
		expect(ticks).not.toContain("$0");
	});

	it("margin: hides the chips that plot nothing there and keeps $0 in the axis", async () => {
		const user = userEvent.setup();
		const { container } = renderChart(
			history({
				...tiered(1),
				soldPrices: [
					{
						tierName: "Tier 1",
						buckets: [
							{
								start: "2026-01-05",
								avg: 480,
								min: 470,
								max: 490,
								units: 3,
							},
						],
					},
				],
			})
		);
		await user.click(screen.getByRole("button", { name: "Margin" }));
		expect(screen.queryByRole("button", { name: "Purchase cost" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Average cost" })).toBeNull();
		expect(screen.queryByRole("button", { name: "List price — Tier 1" })).toBeNull();
		expect(chip("Sold price — Tier 1")).toHaveAttribute("aria-pressed", "true");
		expect(yTicks(container)).toContain("$0");
	});

	it("a range still loading dims the previous one under a spinner", () => {
		const { container } = renderChart(history(), { isStale: true });
		expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
		expect(screen.getByLabelText("Loading price history")).toBeInTheDocument();
		expect(screen.getByText("$450.00").closest(".opacity-40")).not.toBeNull();
	});

	it("the tracking label sits above the plot, clear of every series", () => {
		const { container } = renderChart(
			history({ ...tiered(1), listTrackingStartedAt: "2026-03-28" })
		);
		const label = [...container.querySelectorAll("text")].find(
			(t) => t.textContent === "List price tracking began"
		)!;
		const plotTop = 22; // chart margin.top
		expect(Number(label.getAttribute("y"))).toBeLessThan(plotTop);
	});

	it("an unset list price breaks its line: set → unset → set is two segments", () => {
		const { container } = renderChart(
			history({
				listPrices: [
					{
						code: 1,
						name: "Retail",
						points: [
							{ date: "2026-01-01", value: 500 },
							{ date: "2026-02-01", value: null },
							{ date: "2026-03-01", value: 520 },
						],
					},
				],
			})
		);
		const path = [...container.querySelectorAll("path.recharts-line-curve")].find(
			(p) => p.getAttribute("stroke") === "var(--color-chart-tier-1)"
		)!;
		expect(path.getAttribute("d")!.match(/M/g)).toHaveLength(2);
	});
});
