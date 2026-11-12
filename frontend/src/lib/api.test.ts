import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "./api";
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
			code: "HTTP_502",
		});
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
