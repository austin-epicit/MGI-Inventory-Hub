import { describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, within } from "../../test/testUtils";
import ProductGallery from "./ProductGallery";
import type { ProductImage } from "./api";

const img = (n: number): ProductImage => ({
	id: `img-${n}`,
	thumbUrl: `/api/images/img-${n}/thumb`,
	mediumUrl: `/api/images/img-${n}/medium`,
	originalUrl: `/api/images/img-${n}/original`,
	isPrimary: n === 1,
});

describe("ProductGallery", () => {
	it("falls back to a placeholder without pictures", () => {
		render(<ProductGallery images={[]} name="Dell R740" />);
		expect(
			screen.getByRole("img", { name: "No picture for Dell R740" })
		).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: /Open picture/ })).toBeNull();
	});

	it("shows the medium picture and opens the original in a lightbox, Escape closes it", async () => {
		const user = userEvent.setup();
		render(<ProductGallery images={[img(1), img(2)]} name="Dell R740" />);
		expect(screen.getByAltText("Dell R740, picture 1 of 2")).toHaveAttribute(
			"src",
			"/api/images/img-1/medium"
		);
		await user.click(screen.getByRole("button", { name: "Open picture 1 of 2" }));
		const dialog = screen.getByRole("dialog", { name: "Dell R740 pictures" });
		expect(dialog.querySelector("img")).toHaveAttribute(
			"src",
			"/api/images/img-1/original"
		);
		await user.click(within(dialog).getByRole("button", { name: "Next picture" }));
		expect(dialog.querySelector("img")).toHaveAttribute(
			"src",
			"/api/images/img-2/original"
		);
		await user.keyboard("{ArrowLeft}");
		expect(dialog.querySelector("img")).toHaveAttribute(
			"src",
			"/api/images/img-1/original"
		);
		await user.keyboard("{Escape}");
		expect(screen.queryByRole("dialog")).toBeNull();
	});
});
