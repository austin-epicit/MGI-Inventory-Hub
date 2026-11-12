import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ThemeState {
	theme: "dark" | "light" | "system";
	setTheme: (theme: "dark" | "light" | "system") => void;
}

export const useThemeStore = create<ThemeState>()(
	persist(
		(set) => ({
			theme: "system",
			setTheme: (theme) => set({ theme }),
		}),
		{ name: "theme-preference" }
	)
);
