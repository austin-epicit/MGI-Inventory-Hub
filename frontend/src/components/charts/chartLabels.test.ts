import { describe, it, expect } from "vitest";
import { stackLabels, type LabelSlot } from "./chartLabels";

const slot = (key: string, y: number): LabelSlot => ({ key, label: key, color: "#fff", y });

const bounds = { minGap: 13, top: 10, bottom: 300 };

describe("stackLabels", () => {
	it("leaves labels alone when their series already end far apart", () => {
		const out = stackLabels([slot("a", 50), slot("b", 120)], bounds);
		expect(out.map((s) => [s.key, s.y])).toEqual([
			["a", 50],
			["b", 120],
		]);
	});

	it("separates labels whose lines nearly overlap — the reported defect", () => {
		const out = stackLabels([slot("setCost", 100), slot("wac", 102)], bounds);
		expect(out[1].y - out[0].y).toBeGreaterThanOrEqual(13);
	});

	it("separates a full pile-up of four series", () => {
		const out = stackLabels(
			[slot("a", 100), slot("b", 100), slot("c", 100), slot("d", 100)],
			bounds
		);
		for (let i = 1; i < out.length; i++) {
			expect(out[i].y - out[i - 1].y).toBeGreaterThanOrEqual(13);
		}
	});

	it("keeps every label inside the plot", () => {
		const out = stackLabels([slot("a", 295), slot("b", 298), slot("c", 299)], bounds);
		expect(Math.min(...out.map((s) => s.y))).toBeGreaterThanOrEqual(bounds.top);
		expect(Math.max(...out.map((s) => s.y))).toBeLessThanOrEqual(bounds.bottom);
	});

	it("pulls a label anchored above the plot down to the top bound", () => {
		const out = stackLabels([slot("a", -40)], bounds);
		expect(out[0].y).toBe(bounds.top);
	});

	it("preserves series order by value, so a label still sits nearest its own line", () => {
		const out = stackLabels(
			[slot("high", 60), slot("low", 200), slot("mid", 130)],
			bounds
		);
		expect(out.map((s) => s.key)).toEqual(["high", "mid", "low"]);
	});

	it("does not mutate the input slots", () => {
		const input = [slot("a", 100), slot("b", 101)];
		stackLabels(input, bounds);
		expect(input.map((s) => s.y)).toEqual([100, 101]);
	});
});
