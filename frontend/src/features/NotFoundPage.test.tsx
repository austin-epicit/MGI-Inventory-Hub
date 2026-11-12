import { describe, expect, it } from "vitest";
import { render, screen } from "../test/testUtils";
import NotFoundPage from "./NotFoundPage";

describe("NotFoundPage", () => {
	it("says the page is missing and links home", () => {
		render(<NotFoundPage />);
		expect(screen.getByText("Page not found")).toBeInTheDocument();
		expect(screen.getByRole("link", { name: /back to overview/i })).toHaveAttribute(
			"href",
			"/"
		);
	});
});
