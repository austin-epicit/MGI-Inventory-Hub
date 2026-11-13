import { create } from "zustand";
import type { PublicUser } from "../types/user";

// The session itself is the httpOnly cookie; this only mirrors who it belongs to.
interface AuthState {
	user: PublicUser | null;
	/** Set when a 401 ended a signed-in session; LoginPage explains it. */
	sessionExpired: boolean;
	setUser: (user: PublicUser) => void;
	clear: () => void;
	expireSession: () => void;
	clearSessionExpired: () => void;
}

export const useAuth = create<AuthState>()((set) => ({
	user: null,
	sessionExpired: false,
	setUser: (user) => set({ user, sessionExpired: false }),
	clear: () => set({ user: null }),
	expireSession: () => set({ sessionExpired: true }),
	clearSessionExpired: () => set({ sessionExpired: false }),
}));
