import { describe, expect, it } from "vitest";
import { render, screen } from "../../test/testUtils";
import OrderStatusPill from "./OrderStatusPill";
import { orderStatusTone } from "./orderStatusTone";

describe("order status tone", () => {
	it.each([
		["VOIDED", "red"],
		["DRAFT", "neutral"],
		["COMPLETED", "green"],
		["INVOICED", "green"],
		["RECEIVED", "green"],
		["AUTHORISED", "blue"],
		["PARTIALLY RECEIVED", "blue"],
	])("%s is %s", (status, tone) => {
		expect(orderStatusTone(status)).toBe(tone);
	});

	it("is case-insensitive and shows the status as written", () => {
		render(<OrderStatusPill status="Voided" />);
		expect(screen.getByText("Voided")).toHaveAttribute("data-tone", "red");
	});
});
