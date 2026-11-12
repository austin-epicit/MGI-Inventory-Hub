import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setFormatContext, todayYmd } from "../lib/format";
import { rangeLabel, rangeToYmd } from "./ymdRange";

describe("rangeToYmd", () => {
	it("is empty for all", () => {
		expect(rangeToYmd({ option: "all" })).toEqual({});
	});

	it("keeps a custom range as the same calendar days, inclusive", () => {
		expect(
			rangeToYmd({
				option: "custom",
				startDate: new Date(2026, 2, 1),
				endDate: new Date(2026, 2, 31),
			})
		).toEqual({ from: "2026-03-01", to: "2026-03-31" });
	});

	it("counts every preset from the given day", () => {
		const t = "2026-03-15";
		expect(rangeToYmd({ option: "last_7_days" }, t)).toEqual({
			from: "2026-03-09",
			to: t,
		});
		expect(rangeToYmd({ option: "last_30_days" }, t)).toEqual({
			from: "2026-02-14",
			to: t,
		});
		expect(rangeToYmd({ option: "this_month" }, t)).toEqual({
			from: "2026-03-01",
			to: t,
		});
		expect(rangeToYmd({ option: "next_month" }, "2026-12-15")).toEqual({
			from: "2027-01-01",
			to: "2027-01-31",
		});
		expect(rangeToYmd({ option: "tomorrow" }, "2026-02-28")).toEqual({
			from: "2026-03-01",
			to: "2026-03-01",
		});
	});
});

describe("app-zone presets", () => {
	const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
	beforeEach(() => {
		// 2026-03-15 23:30 in Los Angeles is already 2026-03-16 in Tokyo.
		vi.useFakeTimers({ now: new Date("2026-03-16T06:30:00Z"), toFake: ["Date"] });
	});
	afterEach(() => {
		vi.useRealTimers();
		setFormatContext({ timeZone: browserTz });
	});

	it("today is the Cin7 zone's date even when the browser zone is a day behind", () => {
		setFormatContext({ timeZone: "Asia/Tokyo" });
		expect(todayYmd()).toBe("2026-03-16");
		expect(rangeToYmd({ option: "today" })).toEqual({
			from: "2026-03-16",
			to: "2026-03-16",
		});
		expect(rangeToYmd({ option: "last_7_days" })).toEqual({
			from: "2026-03-10",
			to: "2026-03-16",
		});
		setFormatContext({ timeZone: "America/Los_Angeles" });
		expect(rangeToYmd({ option: "today" })).toEqual({
			from: "2026-03-15",
			to: "2026-03-15",
		});
	});

	it("the chip label shows the same dates", () => {
		setFormatContext({ timeZone: "Asia/Tokyo" });
		expect(rangeLabel("Today", { option: "today" })).toBe("Today (Mar 16, 2026)");
		expect(rangeLabel("This month", { option: "this_month" })).toBe(
			"This month (Mar 1, 2026 – Mar 16, 2026)"
		);
	});
});
