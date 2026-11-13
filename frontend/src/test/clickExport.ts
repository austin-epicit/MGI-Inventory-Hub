import { expect, vi, type MockInstance } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, waitFor } from "@testing-library/react";

// The export is a fetch, so its URL is read off the request the button makes.
export async function clickExport(fetchSpy: MockInstance<typeof fetch>) {
	URL.createObjectURL = vi.fn(() => "blob:x");
	URL.revokeObjectURL = vi.fn();
	vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
	await userEvent.setup().click(await screen.findByRole("button", { name: "Export CSV" }));
	let found: string | undefined;
	await waitFor(() => {
		found = fetchSpy.mock.calls
			.map(([u]) => String(u))
			.find((u) => u.includes("/export.csv"));
		expect(found).toBeDefined();
	});
	return new URL(found!, "http://x");
}
