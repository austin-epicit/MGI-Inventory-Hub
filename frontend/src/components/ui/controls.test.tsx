import { describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen } from "../../test/testUtils";
import DateRangeFilter from "./DateRangeFilter";
import SearchBar from "./SearchBar";

describe("DateRangeFilter", () => {
	it("clears from a focusable sibling button, not an icon inside the trigger", async () => {
		const onChange = vi.fn();
		render(
			<DateRangeFilter
				label="Date"
				value={{
					option: "custom",
					startDate: new Date(2026, 0, 1),
					endDate: new Date(2026, 0, 31),
				}}
				onChange={onChange}
			/>
		);
		await userEvent
			.setup()
			.click(screen.getByRole("button", { name: "Clear date range" }));
		expect(onChange).toHaveBeenCalledWith({ option: "all" });
	});

	it("offers Start date and End date as buttons in the custom editor", async () => {
		render(
			<DateRangeFilter
				label="Date"
				value={{ option: "all" }}
				onChange={() => {}}
			/>
		);
		const user = userEvent.setup();
		await user.click(screen.getByRole("button", { name: /^Date/ }));
		await user.click(screen.getByRole("option", { name: /Custom/ }));
		expect(screen.getByRole("button", { name: "Start date" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "End date" })).toBeInTheDocument();
	});
});

describe("SearchBar", () => {
	it("names the input by its placeholder", () => {
		render(<SearchBar placeholder="Search products…" value="" onChange={() => {}} />);
		expect(
			screen.getByRole("textbox", { name: "Search products…" })
		).toBeInTheDocument();
	});
});
