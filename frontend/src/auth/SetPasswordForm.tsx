import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import type { PublicUser } from "../types/user";
import { authButton, authCard, authPage, authError, authInput, authTitle } from "./authForm";
import { useAuth } from "./store";

// Invite and reset links differ only in endpoint and wording; both sign the user in.
export default function SetPasswordForm({
	title,
	endpoint,
	token,
	cta,
}: {
	title: string;
	endpoint: string;
	token: string;
	cta: string;
}) {
	const [password, setPassword] = useState("");
	const [confirm, setConfirm] = useState("");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const setUser = useAuth((s) => s.setUser);
	const navigate = useNavigate();

	const submit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (password !== confirm) {
			setError("Passwords do not match");
			return;
		}
		setError("");
		setBusy(true);
		try {
			setUser(
				await api<PublicUser>(endpoint, {
					method: "POST",
					body: JSON.stringify({ token, password }),
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
				<h2 className={authTitle}>{title}</h2>
				{error && (
					<p role="alert" className={authError}>
						{error}
					</p>
				)}
				<input
					type="password"
					placeholder="New password (12+ characters)"
					aria-label="New password"
					autoComplete="new-password"
					value={password}
					onChange={(e) => setPassword(e.target.value)}
					className={authInput}
				/>
				<input
					type="password"
					placeholder="Confirm password"
					aria-label="Confirm password"
					autoComplete="new-password"
					value={confirm}
					onChange={(e) => setConfirm(e.target.value)}
					className={authInput}
				/>
				<button type="submit" disabled={busy} className={authButton}>
					{cta}
				</button>
			</form>
		</div>
	);
}
