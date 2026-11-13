import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { api, ApiError, errorMessage } from "../lib/api";
import type { PublicUser } from "../types/user";
import { authButton } from "./authForm";
import { useAuth } from "./store";

type Check = "pending" | "done" | { failed: string };

// Asks the server who the cookie belongs to once per mount. Only a 401 means "signed out";
// a 5xx or a network failure says nothing about the session, so it gets a retry, not /login.
export default function RequireAuth({ role }: { role?: PublicUser["role"] }) {
	const user = useAuth((s) => s.user);
	const [check, setCheck] = useState<Check>(user ? "done" : "pending");
	const [attempt, setAttempt] = useState(0);
	const location = useLocation();

	useEffect(() => {
		if (useAuth.getState().user) return;
		let live = true;
		api<PublicUser>("/api/auth/me")
			.then((u) => {
				useAuth.getState().setUser(u);
				if (live) setCheck("done");
			})
			.catch((err) => {
				if (live)
					setCheck(
						err instanceof ApiError && err.status === 401
							? "done"
							: { failed: errorMessage(err) }
					);
			});
		return () => {
			live = false;
		};
	}, [attempt]);

	if (!user && typeof check === "object") {
		return (
			<div className="flex min-h-svh flex-col items-center justify-center gap-3 bg-canvas text-sm text-text-muted">
				<p role="alert">{check.failed}</p>
				<button
					type="button"
					className={`${authButton} !w-auto px-4`}
					onClick={() => {
						setCheck("pending");
						setAttempt((n) => n + 1);
					}}
				>
					Try again
				</button>
			</div>
		);
	}
	if (!user && check === "pending") {
		return (
			<div className="flex min-h-svh items-center justify-center bg-canvas text-sm text-text-muted">
				Loading…
			</div>
		);
	}
	if (!user) {
		// The query string rides along so a deep link returns to the same filtered view.
		const from = location.pathname + location.search;
		return <Navigate to="/login" replace state={{ from }} />;
	}
	if (role && user.role !== role) return <Navigate to="/" replace />;
	return <Outlet />;
}
