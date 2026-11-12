import type { ApiResponse } from "../types/api";
import { useAuth } from "../auth/store";
import { queryClient } from "./queryClient";

export class ApiError extends Error {
	status: number;
	code: string;
	constructor(status: number, code: string, message: string) {
		super(message);
		this.name = "ApiError";
		this.status = status;
		this.code = code;
	}
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
	const res = await fetch(path, { ...init, headers, credentials: "same-origin" });
	let body: ApiResponse<T> | null = null;
	try {
		body = (await res.json()) as ApiResponse<T>;
	} catch {
		body = null;
	}
	// A dead session must not leave the last user's cached data readable by the next sign-in.
	if (res.status === 401) {
		useAuth.getState().clear();
		queryClient.clear();
	}
	if (!res.ok || !body || !body.success) {
		const err = body?.error;
		throw new ApiError(
			res.status,
			err?.code ?? `HTTP_${res.status}`,
			err?.message ?? `Request failed (${res.status})`
		);
	}
	return body;
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
