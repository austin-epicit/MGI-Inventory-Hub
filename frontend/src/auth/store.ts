import { create } from "zustand";
import type { PublicUser } from "../types/user";

// The session itself is the httpOnly cookie; this only mirrors who it belongs to.
interface AuthState {
	user: PublicUser | null;
	setUser: (user: PublicUser) => void;
	clear: () => void;
}

export const useAuth = create<AuthState>()((set) => ({
	user: null,
	setUser: (user) => set({ user }),
	clear: () => set({ user: null }),
}));
