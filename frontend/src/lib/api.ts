import type { ApiResponse } from "../types/api";
import { useAuth } from "../auth/store";
import { queryClient } from "./queryClient";

export class ApiError extends Error {
	status: number;
	code: string;
	// First invalid request field the server named, for routing the message to its input.
	field: string | null;
	constructor(status: number, code: string, message: string, field: string | null = null) {
		super(message);
		this.name = "ApiError";
		this.status = status;
		this.code = code;
		this.field = field;
	}
}

const NETWORK_MESSAGE = "Can't reach the server. Check your connection and try again.";
const UNAVAILABLE_MESSAGE = "The server isn't responding. Try again in a moment.";

// True when no usable answer came back (offline, or proxy up with the API down).
export function isTransportError(err: unknown): boolean {
	return (
		!(err instanceof ApiError) ||
		err.code === "NETWORK" ||
		err.code === "SERVER_UNAVAILABLE"
	);
}

// Turns any thrown value into user-facing text. Overrides win, keyed by HTTP status or error code.
export function errorMessage(
	err: unknown,
	overrides?: Partial<Record<number | string, string>>
): string {
	if (err instanceof ApiError) {
		return overrides?.[err.status] ?? overrides?.[err.code] ?? err.message;
	}
	return NETWORK_MESSAGE;
}

// Unwraps the `{ success, data, error }` envelope. A 401 drops the session and the query cache;
// RequireAuth sees the empty store and routes to /login.
async function request<T>(path: string, init: RequestInit): Promise<ApiResponse<T>> {
	const headers = new Headers(init.headers);
	headers.set("Accept", "application/json");
	// The API's Origin check wants a JSON content type on every write.
	const isWrite = init.body !== undefined || (init.method ?? "GET").toUpperCase() !== "GET";
	if (isWrite && !headers.has("Content-Type"))
		headers.set("Content-Type", "application/json");
	const res = await guardedFetch(path, { ...init, headers });
	let body: ApiResponse<T> | null = null;
	try {
		body = (await res.json()) as ApiResponse<T>;
	} catch {
		body = null;
	}
	if (!res.ok || !body || !body.success) throw failureFor(res, body);
	return body;
}

async function guardedFetch(path: string, init: RequestInit): Promise<Response> {
	try {
		return await fetch(path, { ...init, credentials: "same-origin" });
	} catch {
		throw new ApiError(0, "NETWORK", NETWORK_MESSAGE);
	}
}

// The one error path for every response that isn't a usable success. Also runs the 401 session
// teardown, so it must be called for each failed response.
function failureFor(res: Response, body: ApiResponse<unknown> | null): ApiError {
	// A dead session must not leave the last user's cached data readable by the next sign-in.
	if (res.status === 401) {
		// Only a signed-in user was "expired"; a wrong password on /login is not.
		if (useAuth.getState().user) useAuth.getState().expireSession();
		useAuth.getState().clear();
		queryClient.clear();
	}
	if (!body && res.status >= 500) {
		// Proxy up, API down: an HTML or empty 502/503/504, not a JSON envelope.
		return new ApiError(res.status, "SERVER_UNAVAILABLE", UNAVAILABLE_MESSAGE);
	}
	const err = body?.error;
	return new ApiError(
		res.status,
		err?.code ?? `HTTP_${res.status}`,
		err?.message ?? `Request failed (${res.status})`,
		err?.field ?? null
	);
}

// Raw-response fetch for file downloads: success returns the Response untouched, failure goes
// through the same envelope/401/transport handling as `api`.
export async function apiDownload(path: string): Promise<Response> {
	const res = await guardedFetch(path, {});
	if (res.ok) return res;
	let body: ApiResponse<unknown> | null = null;
	try {
		body = (await res.json()) as ApiResponse<unknown>;
	} catch {
		body = null;
	}
	throw failureFor(res, body);
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
	return (await request<T>(path, init)).data as T;
}

// For paged lists: `count` is the filtered total from meta.
export async function apiList<T>(
	path: string,
	init: RequestInit = {}
): Promise<{ rows: T[]; count: number }> {
	const body = await request<T[]>(path, init);
	const rows = body.data ?? [];
	return { rows, count: body.meta?.count ?? rows.length };
}
