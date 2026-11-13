import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, errorMessage } from "./api";
import { useAuth } from "../auth/store";
import { queryClient } from "./queryClient";

const reply = (status: number, body: unknown) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});

describe("api()", () => {
	let fetchSpy: ReturnType<typeof vi.spyOn>;
	beforeEach(() => {
		fetchSpy = vi.spyOn(globalThis, "fetch");
		useAuth.setState({ user: null });
	});
	afterEach(() => vi.restoreAllMocks());

	it("returns the unwrapped data and sends same-origin JSON headers", async () => {
		fetchSpy.mockResolvedValue(
			reply(200, { success: true, data: { id: 1 }, error: null, meta: {} })
		);
		const out = await api<{ id: number }>("/api/products", {
			method: "POST",
			body: JSON.stringify({ a: 1 }),
		});
		expect(out).toEqual({ id: 1 });
		const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("/api/products");
		expect(init.credentials).toBe("same-origin");
		expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
	});

	it("throws ApiError carrying the envelope code and message", async () => {
		fetchSpy.mockResolvedValue(
			reply(409, {
				success: false,
				data: null,
				error: {
					code: "ALREADY_SET_UP",
					message: "The first admin already exists",
				},
			})
		);
		const err = await api("/api/auth/setup", { method: "POST" }).catch((e) => e);
		expect(err).toBeInstanceOf(ApiError);
		expect(err).toMatchObject({
			status: 409,
			code: "ALREADY_SET_UP",
			message: "The first admin already exists",
		});
	});

	it("throws a generic ApiError when the body is not an envelope", async () => {
		fetchSpy.mockResolvedValue(
			new Response("<html>bad gateway</html>", { status: 502 })
		);
		await expect(api("/api/x")).rejects.toMatchObject({
			status: 502,
			code: "SERVER_UNAVAILABLE",
		});
	});

	it("maps a fetch rejection to a NETWORK ApiError", async () => {
		fetchSpy.mockRejectedValue(new TypeError("Failed to fetch"));
		const err = await api("/api/x").catch((e) => e);
		expect(err).toBeInstanceOf(ApiError);
		expect(err).toMatchObject({
			status: 0,
			code: "NETWORK",
			message: "Can't reach the server. Check your connection and try again.",
		});
	});

	it.each([502, 503, 504])(
		"%i with an HTML body reads as server unavailable",
		async (status) => {
			fetchSpy.mockResolvedValue(
				new Response("<html>bad gateway</html>", {
					status,
					headers: { "Content-Type": "text/html" },
				})
			);
			const err = (await api("/api/x").catch((e) => e)) as ApiError;
			expect(err).toMatchObject({
				status,
				code: "SERVER_UNAVAILABLE",
				message: "The server isn't responding. Try again in a moment.",
			});
			expect(err.message).not.toMatch(/Request failed/);
		}
	);

	it("an empty 502 reads as server unavailable", async () => {
		fetchSpy.mockResolvedValue(new Response(null, { status: 502 }));
		await expect(api("/api/x")).rejects.toMatchObject({ code: "SERVER_UNAVAILABLE" });
	});

	it("a 422 JSON envelope keeps its own message", async () => {
		fetchSpy.mockResolvedValue(
			reply(422, {
				success: false,
				data: null,
				error: {
					code: "TOO_MANY_ROWS",
					message: "Too many rows to export.",
				},
			})
		);
		await expect(api("/api/x")).rejects.toMatchObject({
			status: 422,
			message: "Too many rows to export.",
		});
	});

	it("a 401 on a signed-in session flags sessionExpired", async () => {
		useAuth.setState({ sessionExpired: false });
		useAuth.getState().setUser({ id: "u1", email: "a@b.c", name: "A", role: "admin" });
		fetchSpy.mockResolvedValue(
			reply(401, {
				success: false,
				data: null,
				error: { code: "UNAUTHENTICATED", message: "x" },
			})
		);
		await expect(api("/api/products")).rejects.toMatchObject({ status: 401 });
		expect(useAuth.getState().sessionExpired).toBe(true);
	});

	it("a 401 with nobody signed in (bad login) does not flag sessionExpired", async () => {
		useAuth.setState({ sessionExpired: false, user: null });
		fetchSpy.mockResolvedValue(
			reply(401, {
				success: false,
				data: null,
				error: { code: "INVALID", message: "x" },
			})
		);
		await expect(api("/api/auth/login")).rejects.toMatchObject({ status: 401 });
		expect(useAuth.getState().sessionExpired).toBe(false);
	});

	it("401 clears the session", async () => {
		useAuth.getState().setUser({ id: "u1", email: "a@b.c", name: "A", role: "admin" });
		fetchSpy.mockResolvedValue(
			reply(401, {
				success: false,
				data: null,
				error: { code: "UNAUTHENTICATED", message: "Sign in" },
			})
		);
		await expect(api("/api/products")).rejects.toMatchObject({ status: 401 });
		expect(useAuth.getState().user).toBeNull();
	});

	it("401 also empties the query cache", async () => {
		queryClient.setQueryData(["secret"], { rows: 1 });
		fetchSpy.mockResolvedValue(
			reply(401, {
				success: false,
				data: null,
				error: { code: "UNAUTHENTICATED", message: "x" },
			})
		);
		await expect(api("/api/products")).rejects.toMatchObject({ status: 401 });
		expect(queryClient.getQueryData(["secret"])).toBeUndefined();
	});
});

describe("errorMessage()", () => {
	const net = "Can't reach the server. Check your connection and try again.";
	it("falls back to the network sentence for non-ApiErrors", () => {
		expect(errorMessage(new Error("x"))).toBe(net);
		expect(errorMessage("boom")).toBe(net);
	});
	it("returns the ApiError message", () => {
		expect(errorMessage(new ApiError(409, "CONFLICT", "Already exists"))).toBe(
			"Already exists"
		);
	});
	it("prefers an override by status, then by code", () => {
		const e = new ApiError(403, "FORBIDDEN", "Not allowed");
		expect(errorMessage(e, { 403: "Only an admin can change the condition." })).toBe(
			"Only an admin can change the condition."
		);
		expect(errorMessage(e, { FORBIDDEN: "By code" })).toBe("By code");
	});
});
