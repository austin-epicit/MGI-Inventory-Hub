import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "../test/testUtils";
import LoginPage from "./LoginPage";

const setupStatus = (needsSetup: boolean) =>
	vi.spyOn(globalThis, "fetch").mockResolvedValue(
		new Response(JSON.stringify({ success: true, data: { needsSetup }, error: null }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		})
	);

describe("LoginPage", () => {
	afterEach(() => vi.restoreAllMocks());

	it("links to /setup when setup-status says needsSetup", async () => {
		setupStatus(true);
		render(<LoginPage />);
		const link = await screen.findByRole("link", { name: /set up/i });
		expect(link).toHaveAttribute("href", "/setup");
	});

	it("shows no setup link once an admin exists", async () => {
		const spy = setupStatus(false);
		render(<LoginPage />);
		await screen.findByRole("button", { name: /sign in/i });
		await vi.waitFor(() => expect(spy).toHaveBeenCalled());
		expect(screen.queryByRole("link", { name: /set up/i })).toBeNull();
	});
});
