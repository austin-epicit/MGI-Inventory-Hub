import { beforeEach, describe, expect, it } from "vitest";
import { useAuth } from "./store";
import type { PublicUser } from "../types/user";

const user = { id: "u1", email: "a@b.co", name: "A", role: "admin" } as unknown as PublicUser;

describe("auth store", () => {
	beforeEach(() => useAuth.setState({ user: null, sessionExpired: false }));

	it("setUser clears a stale sessionExpired flag", () => {
		useAuth.getState().expireSession();
		expect(useAuth.getState().sessionExpired).toBe(true);
		useAuth.getState().setUser(user);
		expect(useAuth.getState().sessionExpired).toBe(false);
		expect(useAuth.getState().user).toEqual(user);
	});
});
