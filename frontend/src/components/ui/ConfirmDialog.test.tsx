import { describe, expect, it } from "vitest";
import { render, screen } from "../../test/testUtils";
import ConfirmDialog from "./ConfirmDialog";

describe("ConfirmDialog", () => {
	it("announces its error", () => {
		render(
			<ConfirmDialog
				open
				title="T"
				body="b"
				confirmLabel="Go"
				error="Nope"
				onConfirm={() => undefined}
				onCancel={() => undefined}
			/>
		);
		expect(screen.getByRole("alert")).toHaveTextContent("Nope");
	});
});
