import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "../test/testUtils";
import userEvent from "@testing-library/user-event";
import LoginPage from "./LoginPage";
import { useAuth } from "./store";

const setupStatus = (needsSetup: boolean) =>
	vi.spyOn(globalThis, "fetch").mockResolvedValue(
		new Response(JSON.stringify({ success: true, data: { needsSetup }, error: null }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		})
	);

describe("LoginPage", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		useAuth.setState({ user: null, sessionExpired: false });
	});

	it("explains an ended session, and clears it on successful sign-in", async () => {
		useAuth.setState({ sessionExpired: true });
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
			const user = { id: "u1", email: "a@b.c", name: "A", role: "admin" };
			const data = String(input).includes("/login")
				? user
				: { needsSetup: false };
			return new Response(JSON.stringify({ success: true, data, error: null }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		});
		render(<LoginPage />);
		expect(
			await screen.findByText("Your session ended. Sign in again to continue.")
		).toBeInTheDocument();
		await userEvent.type(screen.getByLabelText("Email"), "a@b.c");
		await userEvent.type(screen.getByLabelText("Password"), "secret");
		await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
		await vi.waitFor(() => expect(useAuth.getState().sessionExpired).toBe(false));
	});

	it("shows no session note on a fresh visit", async () => {
		setupStatus(false);
		render(<LoginPage />);
		await screen.findByRole("button", { name: /sign in/i });
		expect(screen.queryByText(/Your session ended/)).toBeNull();
	});

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
