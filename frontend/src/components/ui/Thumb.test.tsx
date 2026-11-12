import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "../../test/testUtils";
import Thumb from "./Thumb";

describe("Thumb", () => {
	it("shows the picture, and the placeholder when there is no url", () => {
		const { rerender } = render(<Thumb url="/api/images/a/thumb" name="Widget" />);
		expect(screen.getByAltText("Widget")).toHaveAttribute("src", "/api/images/a/thumb");
		expect(screen.queryByTestId("thumb-placeholder")).toBeNull();
		rerender(<Thumb url={null} name="Widget" />);
		expect(screen.getByTestId("thumb-placeholder")).toBeInTheDocument();
	});

	it("falls back to the placeholder when the picture fails to load", () => {
		const { rerender } = render(<Thumb url="/api/images/gone/thumb" name="Widget" />);
		fireEvent.error(screen.getByAltText("Widget"));
		expect(screen.queryByAltText("Widget")).toBeNull();
		expect(screen.getByTestId("thumb-placeholder")).toBeInTheDocument();
		// A different picture gets its own try.
		rerender(<Thumb url="/api/images/other/thumb" name="Widget" />);
		expect(screen.getByAltText("Widget")).toBeInTheDocument();
	});
});
