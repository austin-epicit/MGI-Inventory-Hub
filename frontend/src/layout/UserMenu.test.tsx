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
	await user.click(screen.getByRole("button", { name: /log out/i }));
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
