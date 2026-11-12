import { describe, expect, it } from "vitest";
import { orderLabel } from "./orderLabel";

describe("orderLabel", () => {
	it.each([
		["FULLY RECEIVED", "Fully received"],
		["NOT INVOICED", "Not invoiced"],
		["AUTHORISED", "Authorised"],
		["PICKING", "Picking"],
		["PARTIALLY_SHIPPED", "Partially shipped"],
		["Already fine", "Already fine"],
	])("%s -> %s", (raw, label) => {
		expect(orderLabel(raw)).toBe(label);
	});

	it("is empty for missing values", () => {
		expect(orderLabel(null)).toBe("");
	});
});
