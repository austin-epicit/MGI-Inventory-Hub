import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { act, render, screen } from "../test/testUtils";
import { useAuth } from "../auth/store";
import { useToastStore } from "../stores/toastStore";
import UserMenu from "./UserMenu";

const reply = (status: number) =>
	new Response(
		JSON.stringify({
			success: status < 400,
			data: null,
			error: status < 400 ? null : { code: "X", message: "x" },
		}),
		{
			status,
			headers: { "Content-Type": "application/json" },
		}
	);

const open = async () => {
	act(() =>
		useAuth.setState({ user: { id: "1", email: "a@b.c", name: "Ann", role: "viewer" } })
	);
	render(<UserMenu />);
	const user = userEvent.setup();
	await user.click(screen.getByRole("button", { name: "User menu" }));
	await user.click(screen.getByRole("menuitem", { name: /sign out/i }));
};

afterEach(() => {
	vi.restoreAllMocks();
	act(() => {
		useAuth.setState({ user: null });
		useToastStore.setState({ toasts: [] });
	});
});

describe("UserMenu logout", () => {
	it("stays signed in and toasts an error when the request fails", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(reply(503));
		await open();
		await vi.waitFor(() =>
			expect(useToastStore.getState().toasts.map((t) => t.kind)).toContain(
				"error"
			)
		);
		expect(useAuth.getState().user).not.toBeNull();
	});

	it("signs out when the request succeeds", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(reply(200));
		await open();
		await vi.waitFor(() => expect(useAuth.getState().user).toBeNull());
	});
});

describe("UserMenu a11y and busy state", () => {
	it("exposes menu semantics and disables Sign out while pending", async () => {
		let release: () => void = () => undefined;
		vi.spyOn(globalThis, "fetch").mockImplementation(
			() =>
				new Promise<Response>((r) => {
					release = () => r(reply(200));
				})
		);
		act(() =>
			useAuth.setState({
				user: { id: "1", email: "a@b.c", name: "Ann", role: "viewer" },
			})
		);
		render(<UserMenu />);
		const user = userEvent.setup();
		const trigger = screen.getByRole("button", { name: "User menu" });
		expect(trigger).toHaveAttribute("aria-haspopup", "menu");
		await user.click(trigger);
		const theme = screen.getByRole("menuitem", { name: /theme/i });
		expect(theme).toHaveAttribute("aria-expanded", "false");
		await user.click(theme);
		expect(theme).toHaveAttribute("aria-expanded", "true");
		expect(screen.getByRole("menuitemradio", { name: "System" })).toHaveAttribute(
			"aria-checked",
			"true"
		);
		expect(screen.getByRole("menuitemradio", { name: "Dark" })).toHaveAttribute(
			"aria-checked",
			"false"
		);
		await user.click(screen.getByRole("menuitem", { name: "Sign out" }));
		expect(screen.getByRole("menuitem", { name: /signing out/i })).toBeDisabled();
		release();
	});

	it("closes on Escape and returns focus to the trigger", async () => {
		act(() =>
			useAuth.setState({
				user: { id: "1", email: "a@b.c", name: "Ann", role: "viewer" },
			})
		);
		render(<UserMenu />);
		const user = userEvent.setup();
		const trigger = screen.getByRole("button", { name: "User menu" });
		await user.click(trigger);
		expect(screen.getByRole("menu")).toHaveClass("popover-panel");
		await user.keyboard("{Escape}");
		expect(screen.queryByRole("menu")).toBeNull();
		expect(trigger).toHaveFocus();
	});
});
