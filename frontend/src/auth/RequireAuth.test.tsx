import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import RequireAuth from "./RequireAuth";
import { useAuth } from "./store";

const envelope = (status: number, data: unknown, error: unknown = null) =>
	new Response(JSON.stringify({ success: status < 400, data, error }), {
		status,
		headers: { "Content-Type": "application/json" },
	});

function LoginProbe() {
	const loc = useLocation();
	return <div>login screen from={(loc.state as { from?: string } | null)?.from}</div>;
}

const renderAt = (path: string) =>
	render(
		<MemoryRouter initialEntries={[path]}>
			<Routes>
				<Route path="/login" element={<LoginProbe />} />
				<Route element={<RequireAuth />}>
					<Route path="/" element={<div>home</div>} />
					<Route element={<RequireAuth role="admin" />}>
						<Route
							path="/settings"
							element={<div>settings</div>}
						/>
					</Route>
				</Route>
			</Routes>
		</MemoryRouter>
	);

describe("RequireAuth", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		act(() => useAuth.setState({ user: null }));
	});

	it("redirects to /login when /api/auth/me answers 401", async () => {
		const spy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(
				envelope(401, null, { code: "UNAUTHENTICATED", message: "no" })
			);
		await act(async () => {
			renderAt("/");
		});
		expect(screen.getByText(/^login screen/)).toBeInTheDocument();
		expect(spy).toHaveBeenCalledTimes(1);
	});

	it("loads /me once and renders the page for a signed-in user", async () => {
		const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			envelope(200, {
				id: "u1",
				email: "a@b.c",
				name: "A",
				role: "viewer",
			})
		);
		await act(async () => {
			renderAt("/");
		});
		expect(screen.getByText("home")).toBeInTheDocument();
		expect(useAuth.getState().user?.id).toBe("u1");
		expect(spy).toHaveBeenCalledTimes(1);
	});

	it("keeps non-admins out of an admin route", async () => {
		act(() =>
			useAuth
				.getState()
				.setUser({ id: "u1", email: "a@b.c", name: "A", role: "viewer" })
		);
		renderAt("/settings");
		expect(screen.getByText("home")).toBeInTheDocument();
		expect(screen.queryByText("settings")).toBeNull();
	});

	it("keeps the query string for the post-login redirect", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			envelope(401, null, { code: "UNAUTHENTICATED", message: "no" })
		);
		await act(async () => {
			renderAt("/?q=bolts&page=2");
		});
		expect(screen.getByText("login screen from=/?q=bolts&page=2")).toBeInTheDocument();
	});

	it("shows a retry, not the login page, when the server fails", async () => {
		const spy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(
				new Response("", {
					status: 500,
					headers: { "Content-Type": "text/plain" },
				})
			)
			.mockResolvedValueOnce(
				envelope(200, {
					id: "u1",
					email: "a@b.c",
					name: "A",
					role: "viewer",
				})
			);
		await act(async () => {
			renderAt("/");
		});
		expect(screen.getByRole("alert")).toHaveTextContent(
			"The server isn't responding. Try again in a moment."
		);
		expect(screen.queryByText(/login screen/)).toBeNull();
		await userEvent.click(screen.getByRole("button", { name: "Try again" }));
		expect(await screen.findByText("home")).toBeInTheDocument();
		expect(spy).toHaveBeenCalledTimes(2);
	});

	it("shows the retry on a network failure too", async () => {
		vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
		await act(async () => {
			renderAt("/");
		});
		expect(screen.getByRole("alert")).toHaveTextContent(
			"Can't reach the server. Check your connection and try again."
		);
		expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
	});
});
