import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, ChevronDown, LogOut, Monitor, Moon, Palette, Sun } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { queryClient } from "../lib/queryClient";
import { useAuth } from "../auth/store";
import { useToast } from "../hooks/useToast";
import { useThemeStore } from "../stores/themeStore";

const THEMES = [
	["system", Monitor, "System"],
	["light", Sun, "Light"],
	["dark", Moon, "Dark"],
] as const;

export default function UserMenu() {
	const user = useAuth((s) => s.user);
	const clear = useAuth((s) => s.clear);
	const { theme, setTheme } = useThemeStore();
	const [open, setOpen] = useState(false);
	const [themeOpen, setThemeOpen] = useState(false);
	const [signingOut, setSigningOut] = useState(false);
	const wrapperRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const navigate = useNavigate();
	const toast = useToast();

	const logout = async () => {
		setSigningOut(true);
		try {
			await api("/api/auth/logout", { method: "POST" });
		} catch (err) {
			// A 401 means the session is already gone. Anything else left the cookie valid, so
			// staying signed in is the truthful state.
			if (!(err instanceof ApiError && err.status === 401)) {
				toast.error(
					"Couldn't sign out. Check your connection and try again."
				);
				setSigningOut(false);
				return;
			}
		}
		clear();
		queryClient.clear();
		navigate("/login");
	};

	useEffect(() => {
		const onDown = (e: MouseEvent) => {
			if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node))
				setOpen(false);
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			setOpen((wasOpen) => {
				if (wasOpen) triggerRef.current?.focus();
				return false;
			});
		};
		document.addEventListener("mousedown", onDown);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onDown);
			document.removeEventListener("keydown", onKey);
		};
	}, []);

	const initial = user?.name.charAt(0).toUpperCase();

	return (
		<div ref={wrapperRef} className="relative">
			<button
				ref={triggerRef}
				onClick={() => setOpen((o) => !o)}
				aria-label="User menu"
				aria-haspopup="menu"
				aria-expanded={open}
				className={`w-9 h-9 rounded-lg bg-avatar-bg flex items-center justify-center pt-[3px] text-avatar-fg font-semibold text-sm border-b-[3px] transition-colors ${
					open
						? "border-primary"
						: "border-transparent hover:border-primary/40"
				}`}
			>
				{initial}
			</button>

			{open && (
				<div
					role="menu"
					className="absolute top-full right-0 mt-2 w-54 bg-surface-raised border border-border-subtle rounded-lg shadow-lg z-50 overflow-hidden"
				>
					<div className="px-4 py-3 border-b border-border-subtle flex items-start gap-3">
						<span className="w-10 h-10 shrink-0 rounded-lg bg-avatar-bg flex items-center justify-center text-avatar-fg font-semibold text-sm">
							{initial}
						</span>
						<div className="min-w-0">
							<p className="text-sm font-semibold text-text-primary truncate">
								{user?.name}
							</p>
							<p className="text-xs text-text-muted truncate">
								{user?.email}
							</p>
							<p className="text-xs text-text-muted capitalize mt-0.5">
								{user?.role}
							</p>
						</div>
					</div>

					<div className="p-2 flex flex-col">
						<button
							role="menuitem"
							className="w-full flex items-center gap-1 px-3 py-2 text-sm text-text-primary rounded-md hover:bg-surface transition-colors"
							aria-expanded={themeOpen}
							onClick={() => setThemeOpen((o) => !o)}
						>
							<Palette size={16} />
							Theme
							<ChevronDown
								size={13}
								className={`ml-auto transition-transform duration-200 ${themeOpen ? "rotate-180" : ""}`}
							/>
						</button>
						{themeOpen && (
							<div className="flex flex-col pb-0.5">
								{THEMES.map(
									([value, Icon, label]) => (
										<button
											role="menuitemradio"
											key={value}
											aria-checked={
												theme ===
												value
											}
											onClick={() =>
												setTheme(
													value
												)
											}
											className={`w-full flex items-center gap-2 pl-8 pr-3 py-1.5 text-sm rounded-md transition-colors ${
												theme ===
												value
													? "text-primary hover:bg-surface"
													: "text-text-muted hover:text-text-primary hover:bg-surface"
											}`}
										>
											<Icon
												size={
													14
												}
											/>
											{label}
											{theme ===
												value && (
												<Check
													size={
														12
													}
													className="ml-auto"
												/>
											)}
										</button>
									)
								)}
							</div>
						)}
					</div>

					<div className="border-t border-border-subtle p-2">
						<button
							role="menuitem"
							onClick={logout}
							disabled={signingOut}
							className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-tertiary rounded-md hover:text-text-primary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
						>
							<LogOut size={16} />
							{signingOut ? "Signing out…" : "Sign out"}
						</button>
					</div>
				</div>
			)}
		</div>
	);
}
