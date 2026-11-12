import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import type { PublicUser } from "../types/user";
import {
	authButton,
	authCard,
	authHint,
	authLink,
	authPage,
	authError,
	authInput,
	authTitle,
} from "./authForm";
import { useAuth } from "./store";
import { useSetupStatus } from "./useSetupStatus";

export default function LoginPage() {
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const user = useAuth((s) => s.user);
	const setUser = useAuth((s) => s.setUser);
	const navigate = useNavigate();
	const from = (useLocation().state as { from?: string } | null)?.from ?? "/";
	const { data: status } = useSetupStatus();

	if (user) return <Navigate to={from} replace />;

	const submit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError("");
		setBusy(true);
		try {
			const u = await api<PublicUser>("/api/auth/login", {
				method: "POST",
				body: JSON.stringify({ email, password }),
			});
			setUser(u);
			navigate(from, { replace: true });
		} catch (err) {
			setError(
				err instanceof ApiError ? err.message : "Could not reach the server"
			);
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className={authPage}>
			<form onSubmit={submit} className={authCard}>
				<h2 className={authTitle}>MGI Inventory Hub</h2>
				{error && (
					<p role="alert" className={authError}>
						{error}
					</p>
				)}
				<input
					type="email"
					placeholder="Email"
					aria-label="Email"
					autoComplete="username"
					value={email}
					onChange={(e) => setEmail(e.target.value)}
					className={authInput}
				/>
				<input
					type="password"
					placeholder="Password"
					aria-label="Password"
					autoComplete="current-password"
					value={password}
					onChange={(e) => setPassword(e.target.value)}
					className={authInput}
				/>
				<button type="submit" disabled={busy} className={authButton}>
					Sign in
				</button>
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
