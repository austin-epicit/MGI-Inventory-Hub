import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
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

export default function SetupPage() {
	const [form, setForm] = useState({ setupToken: "", name: "", email: "", password: "" });
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const setUser = useAuth((s) => s.setUser);
	const navigate = useNavigate();
	const { data: status } = useSetupStatus();

	if (status && !status.needsSetup) return <Navigate to="/login" replace />;

	const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
		setForm((f) => ({ ...f, [k]: e.target.value }));

	const submit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError("");
		setBusy(true);
		try {
			setUser(
				await api<PublicUser>("/api/auth/setup", {
					method: "POST",
					body: JSON.stringify(form),
				})
			);
			navigate("/", { replace: true });
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
				<h2 className={authTitle}>Create the first admin</h2>
				{error && (
					<p role="alert" className={authError}>
						{error}
					</p>
				)}
				<input
					type="password"
					placeholder="Setup token"
					aria-label="Setup token"
					autoComplete="off"
					value={form.setupToken}
					onChange={set("setupToken")}
					className={authInput}
				/>
				<input
					type="text"
					placeholder="Name"
					aria-label="Name"
					autoComplete="name"
					value={form.name}
					onChange={set("name")}
					className={authInput}
				/>
				<input
					type="email"
					placeholder="Email"
					aria-label="Email"
					autoComplete="username"
					value={form.email}
					onChange={set("email")}
					className={authInput}
				/>
				<input
					type="password"
					placeholder="Password (12+ characters)"
					aria-label="Password"
					autoComplete="new-password"
					value={form.password}
					onChange={set("password")}
					className={authInput}
				/>
				<button type="submit" disabled={busy} className={authButton}>
					Create admin
				</button>
				<p className={authHint}>
					<Link to="/login" className={authLink}>
						Back to sign in
					</Link>
				</p>
			</form>
		</div>
	);
}
