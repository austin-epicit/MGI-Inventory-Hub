import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { api, ApiError, errorMessage } from "../lib/api";
import type { PublicUser } from "../types/user";
import {
	authButton,
	authCard,
	authHint,
	authLink,
	authPage,
	authError,
	authTitle,
} from "./authForm";
import { AuthField, SetupStatusError } from "./authParts";
import { useAuth } from "./store";
import { useSetupStatus } from "./useSetupStatus";

export default function LoginPage() {
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState("");
	const [fieldError, setFieldError] = useState<"email" | "password" | null>(null);
	const [busy, setBusy] = useState(false);
	const user = useAuth((s) => s.user);
	const setUser = useAuth((s) => s.setUser);
	const sessionExpired = useAuth((s) => s.sessionExpired);
	const clearSessionExpired = useAuth((s) => s.clearSessionExpired);
	const navigate = useNavigate();
	const from = (useLocation().state as { from?: string } | null)?.from ?? "/";
	const { data: status, isError: statusError, refetch } = useSetupStatus();

	if (user) return <Navigate to={from} replace />;

	const submit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError("");
		setFieldError(null);
		setBusy(true);
		try {
			const u = await api<PublicUser>("/api/auth/login", {
				method: "POST",
				body: JSON.stringify({ email, password }),
			});
			clearSessionExpired();
			setUser(u);
			navigate(from, { replace: true });
		} catch (err) {
			const msg = errorMessage(err, {
				VALIDATION_ERROR: "Enter a valid email and your password.",
			});
			const field = err instanceof ApiError ? err.field : null;
			if (err instanceof ApiError && err.code === "VALIDATION_ERROR") {
				setFieldError(field === "password" ? "password" : "email");
				setError(msg);
			} else setError(msg);
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className={authPage}>
			<form noValidate onSubmit={submit} className={authCard}>
				<h2 className={authTitle}>MGI Inventory Hub</h2>
				{sessionExpired && !error && (
					<p role="status" className={authHint}>
						Your session ended. Sign in again to continue.
					</p>
				)}
				{error && !fieldError && (
					<p role="alert" className={authError}>
						{error}
					</p>
				)}
				<AuthField
					type="email"
					label="Email"
					autoComplete="username"
					value={email}
					onChange={(e) => setEmail(e.target.value)}
					error={fieldError === "email" ? error : undefined}
				/>
				<AuthField
					type="password"
					label="Password"
					autoComplete="current-password"
					value={password}
					onChange={(e) => setPassword(e.target.value)}
					error={fieldError === "password" ? error : undefined}
				/>
				<button
					type="submit"
					disabled={busy || !email || !password}
					className={authButton}
				>
					{busy ? "Signing in…" : "Sign in"}
				</button>
				{statusError && <SetupStatusError onRetry={() => void refetch()} />}
				{status?.needsSetup && (
					<p className={authHint}>
						No admin yet.{" "}
						<Link to="/setup" className={authLink}>
							Set up the first admin
						</Link>
					</p>
				)}
			</form>
		</div>
	);
}
