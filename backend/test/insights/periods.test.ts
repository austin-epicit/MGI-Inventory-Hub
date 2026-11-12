import { describe, expect, it } from "vitest";
import { fillPeriods, periodFor, periodStart } from "../../src/insights/periods.js";

describe("periodFor", () => {
	it("uses weeks up to 90d and months beyond", () => {
		expect(periodFor("30d")).toBe("week");
		expect(periodFor("90d")).toBe("week");
		expect(periodFor("6m")).toBe("month");
		expect(periodFor("1y")).toBe("month");
		expect(periodFor("all")).toBe("month");
	});
});

describe("periodStart", () => {
	it("snaps to the Monday of the week", () => {
		expect(periodStart("2026-11-12", "week")).toBe("2026-11-09");
		expect(periodStart("2026-11-09", "week")).toBe("2026-11-09");
		expect(periodStart("2026-11-15", "week")).toBe("2026-11-09"); // Sunday
		expect(periodStart("2026-01-01", "week")).toBe("2025-12-29");
	});
	it("snaps to the 1st of the month", () => {
		expect(periodStart("2026-11-12", "month")).toBe("2026-11-01");
		expect(periodStart("2026-11-01", "month")).toBe("2026-11-01");
	});
});

describe("fillPeriods", () => {
	it("labels clipped months at both ends", () => {
		const r = fillPeriods("2025-12-15", "2026-03-10", "month");
		expect(r.map((x) => x.start)).toEqual([
			"2025-12-01",
			"2026-01-01",
			"2026-02-01",
			"2026-03-01",
		]);
		expect(r[0]!.label).toBe("Dec 15–31");
		expect(r[1]!.label).toBe("Jan 2026");
		expect(r[3]!.label).toBe("Mar 1–10");
	});
	it("labels a month fully covered", () => {
		expect(fillPeriods("2026-11-01", "2026-11-30", "month")).toEqual([
			{ start: "2026-11-01", label: "Nov 2026" },
		]);
	});
	it("clips a single partial month to both bounds", () => {
		expect(fillPeriods("2026-11-01", "2026-11-12", "month")).toEqual([
			{ start: "2026-11-01", label: "Nov 1–12" },
		]);
	});
	it("labels weeks by Monday and clips partial ends", () => {
		const r = fillPeriods("2026-11-01", "2026-11-12", "week");
		expect(r).toEqual([
			{ start: "2026-10-26", label: "Nov 1" },
			{ start: "2026-11-02", label: "Nov 2" },
			{ start: "2026-11-09", label: "Nov 9–12" },
		]);
	});
	it("clips a first week that starts mid-week", () => {
		const r = fillPeriods("2026-11-04", "2026-11-20", "week");
		expect(r[0]).toEqual({ start: "2026-11-02", label: "Nov 4–8" });
		expect(r[2]).toEqual({ start: "2026-11-16", label: "Nov 16–20" });
	});
	it("has no duplicate or skipped week across a year boundary", () => {
		const r = fillPeriods("2025-12-20", "2026-01-20", "week");
		const starts = r.map((x) => x.start);
		expect(starts).toEqual([
			"2025-12-15",
			"2025-12-22",
			"2025-12-29",
			"2026-01-05",
			"2026-01-12",
			"2026-01-19",
		]);
		expect(r[2]!.label).toBe("Dec 29");
	});
});
