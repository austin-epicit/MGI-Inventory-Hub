import BrandMark from "../components/ui/BrandMark";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import EmptyState from "../components/ui/EmptyState";
import { api, ApiError, errorMessage } from "../lib/api";
import type { PublicUser } from "../types/user";
import {
	authButton,
	authCard,
	authError,
	authLink,
	authPage,
	authTitle,
	passwordProblem,
} from "./authForm";
import { AuthField } from "./authParts";
import { useAuth } from "./store";

type Errors = { password?: string; confirm?: string };

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
	const [errors, setErrors] = useState<Errors>({});
	const [formError, setFormError] = useState("");
	const [linkDead, setLinkDead] = useState(false);
	const [busy, setBusy] = useState(false);
	const setUser = useAuth((s) => s.setUser);
	const navigate = useNavigate();

	const submit = async (e: React.FormEvent) => {
		e.preventDefault();
		const found: Errors = {};
		const problem = passwordProblem(password);
		if (problem) found.password = problem;
		else if (password !== confirm) found.confirm = "Passwords do not match.";
		setErrors(found);
		setFormError("");
		if (found.password || found.confirm) return;
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
			if (err instanceof ApiError && err.code === "INVALID_TOKEN")
				setLinkDead(true);
			else if (err instanceof ApiError && err.field === "password")
				setErrors({ password: errorMessage(err) });
			else setFormError(errorMessage(err));
		} finally {
			setBusy(false);
		}
	};

	if (linkDead)
		return (
			<div className={authPage}>
				<div className={authCard}>
					<EmptyState title="This link has expired or was already used. Ask an admin for a new link." />
					<p className="text-center text-sm">
						<Link to="/login" className={authLink}>
							Go to sign in
						</Link>
					</p>
				</div>
			</div>
		);

	return (
		<div className={authPage}>
			<form noValidate onSubmit={submit} className={authCard}>
				<BrandMark className="mx-auto mb-1 h-10 w-10 text-text-primary" />
				<h2 className={authTitle}>{title}</h2>
				{formError && (
					<p role="alert" className={authError}>
						{formError}
					</p>
				)}
				<AuthField
					type="password"
					label="New password"
					placeholder="New password (12+ characters)"
					autoComplete="new-password"
					value={password}
					onChange={(e) => {
						setPassword(e.target.value);
						setErrors((er) => ({ ...er, password: undefined }));
					}}
					error={errors.password}
				/>
				<AuthField
					type="password"
					label="Confirm password"
					autoComplete="new-password"
					value={confirm}
					onChange={(e) => {
						setConfirm(e.target.value);
						setErrors((er) => ({ ...er, confirm: undefined }));
					}}
					error={errors.confirm}
				/>
				<button type="submit" disabled={busy} className={authButton}>
					{busy ? "Saving password…" : cta}
				</button>
			</form>
		</div>
	);
}
