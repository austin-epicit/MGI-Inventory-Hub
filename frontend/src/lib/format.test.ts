import { describe, expect, it, vi } from "vitest";
import {
	formatDate,
	formatDateTime,
	formatMoney,
	formatMoneyCompact,
	formatQty,
	formatRelative,
	setFormatContext,
} from "./format";

describe("formatDate", () => {
	it("keeps the calendar date under a zone west of UTC", () => {
		expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(
			"America/Los_Angeles"
		);
		expect(formatDate("2026-03-01")).toBe("Mar 1, 2026");
	});

	it("does not shift a date across a DST boundary", () => {
		expect(formatDate("2026-03-08")).toBe("Mar 8, 2026");
		expect(formatDate("2026-11-01")).toBe("Nov 1, 2026");
	});

	it("returns an impossible calendar date as written instead of rolling it forward", () => {
		expect(formatDate("2026-02-31")).toBe("2026-02-31");
		expect(formatDate("2026-13-01")).toBe("2026-13-01");
		expect(formatDate("2026-02-28")).toBe("Feb 28, 2026");
	});

	it("rejects anything that is not a plain date", () => {
		expect(formatDate("2026-03-01T00:00:00Z")).toBe("2026-03-01T00:00:00Z");
	});
});

describe("formatDateTime", () => {
	it("renders in the app time zone, not the browser's", () => {
		setFormatContext({ timeZone: "Asia/Tokyo" });
		expect(formatDateTime("2026-03-01T00:00:00.000Z")).toBe("Mar 1, 2026, 9:00 AM");
		setFormatContext({ timeZone: "America/Los_Angeles" });
		expect(formatDateTime("2026-03-01T00:00:00.000Z")).toBe("Feb 28, 2026, 4:00 PM");
	});
});

describe("formatMoney", () => {
	it("uses the base currency by default and always shows 2 decimals", () => {
		setFormatContext({ currency: "USD" });
		expect(formatMoney(1234.5)).toBe("$1,234.50");
		expect(formatMoney(512.1726)).toBe("$512.17");
		expect(formatMoney(0.0375)).toBe("$0.04");
		expect(formatMoney(12, "EUR")).toBe("€12.00");
	});

	it("does not throw on an invalid currency code", () => {
		expect(formatMoney(1234.5, "NOPE1")).toBe("NOPE1 1,234.50");
		expect(formatMoney(2, "")).toBe(" 2.00");
	});

	it("builds each currency formatter once", () => {
		const Real = Intl.NumberFormat;
		const spy = vi.spyOn(Intl, "NumberFormat").mockImplementation(function (
			...a: ConstructorParameters<typeof Real>
		) {
			return new Real(...a);
		} as unknown as typeof Intl.NumberFormat);
		formatMoney(1, "CAD");
		formatMoney(2, "CAD");
		formatMoney(3, "CAD");
		expect(spy).toHaveBeenCalledTimes(1);
		spy.mockRestore();
	});
});

describe("formatMoneyCompact", () => {
	it("abbreviates thousands in the base currency for axis ticks", () => {
		setFormatContext({ currency: "USD" });
		expect(formatMoneyCompact(1250)).toBe("$1.3K");
		expect(formatMoneyCompact(400)).toBe("$400");
		expect(formatMoneyCompact(-1200, "EUR")).toBe("-€1.2K");
	});

	it("falls back to the full amount for a currency code Intl does not know", () => {
		expect(formatMoneyCompact(1250, "NOPE")).toBe("NOPE 1,250.00");
	});
});

describe("formatQty", () => {
	it("keeps fractional units up to 4 decimals and groups thousands", () => {
		expect(formatQty(1234.5)).toBe("1,234.5");
		expect(formatQty(0.12345)).toBe("0.1235");
		expect(formatQty(3)).toBe("3");
	});
});

describe("formatRelative", () => {
	it("speaks in minutes, hours and days", () => {
		const now = Date.parse("2026-03-01T12:00:00Z");
		expect(formatRelative("2026-03-01T11:55:00Z", now)).toBe("5 minutes ago");
		expect(formatRelative("2026-03-01T09:00:00Z", now)).toBe("3 hours ago");
		expect(formatRelative("2026-02-26T12:00:00Z", now)).toBe("3 days ago");
		expect(formatRelative("2026-03-01T11:59:50Z", now)).toBe("just now");
	});
});

describe("setFormatContext", () => {
	it("ignores a zone Intl does not know, so rendering cannot throw", () => {
		setFormatContext({ timeZone: "Asia/Tokyo" });
		setFormatContext({ timeZone: "Eastern Standard Time" });
		expect(formatDateTime("2026-03-01T00:00:00.000Z")).toBe("Mar 1, 2026, 9:00 AM");
		setFormatContext({ timeZone: "America/Los_Angeles" });
	});
});
