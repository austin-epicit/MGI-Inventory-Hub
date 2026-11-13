import { useEffect, useState } from "react";
import { useThemeStore } from "../stores/themeStore";

// Every transition-colors element would otherwise animate the swap, leaving text the old
// color on the new background for a moment. Transitions are off until two frames have painted.
function setDocumentTheme(next: "dark" | "light") {
	const root = document.documentElement;
	if (root.dataset.theme === next) return;
	root.classList.add("theme-switching");
	root.dataset.theme = next;
	requestAnimationFrame(() =>
		requestAnimationFrame(() => root.classList.remove("theme-switching"))
	);
}

export function useApplyTheme() {
	const theme = useThemeStore((s) => s.theme);

	useEffect(() => {
		const mq = window.matchMedia("(prefers-color-scheme: dark)");

		const apply = (prefersDark: boolean) => {
			setDocumentTheme(prefersDark ? "dark" : "light");
		};

		if (theme === "system") {
			apply(mq.matches);
			// Chrome's print preview emulates prefers-color-scheme: light and fires
			// a change event at the page — without this guard the on-screen app would
			// flip to light behind the preview. Ignore changes while printing, then
			// re-apply the true system preference once the dialog closes.
			let printing = false;
			const handler = (e: MediaQueryListEvent) => {
				if (!printing) apply(e.matches);
			};
			const onBeforePrint = () => {
				printing = true;
			};
			const onAfterPrint = () => {
				printing = false;
				apply(mq.matches);
			};
			mq.addEventListener("change", handler);
			window.addEventListener("beforeprint", onBeforePrint);
			window.addEventListener("afterprint", onAfterPrint);
			return () => {
				mq.removeEventListener("change", handler);
				window.removeEventListener("beforeprint", onBeforePrint);
				window.removeEventListener("afterprint", onAfterPrint);
			};
		} else {
			setDocumentTheme(theme);
		}
	}, [theme]);
}

export function useResolvedTheme(): "dark" | "light" {
	const theme = useThemeStore((s) => s.theme);
	const [systemDark, setSystemDark] = useState(
		() => window.matchMedia("(prefers-color-scheme: dark)").matches
	);

	useEffect(() => {
		if (theme !== "system") return;
		const mq = window.matchMedia("(prefers-color-scheme: dark)");
		const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches);
		setSystemDark(mq.matches);
		mq.addEventListener("change", handler);
		return () => mq.removeEventListener("change", handler);
	}, [theme]);

	if (theme === "dark") return "dark";
	if (theme === "light") return "light";
	return systemDark ? "dark" : "light";
}
