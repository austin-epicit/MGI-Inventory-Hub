import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { api, ApiError, errorMessage } from "../lib/api";
import { EMAIL_ERROR, isValidEmail } from "../lib/validation";
import type { PublicUser } from "../types/user";
import {
	authButton,
	authCard,
	authError,
	authHint,
	authLink,
	authPage,
	authTitle,
	passwordProblem,
} from "./authForm";
import { AuthField, SetupStatusError } from "./authParts";
import { useAuth } from "./store";
import { useSetupStatus } from "./useSetupStatus";

type Form = { setupToken: string; name: string; email: string; password: string };
type Errors = Partial<Record<keyof Form, string>>;

function validate(f: Form): Errors {
	const errors: Errors = {};
	if (!f.setupToken.trim()) errors.setupToken = "Enter the setup token.";
	if (!f.name.trim()) errors.name = "Enter your name.";
	if (!f.email.trim()) errors.email = "Enter your email.";
	else if (!isValidEmail(f.email)) errors.email = EMAIL_ERROR;
	const pw = passwordProblem(f.password);
	if (pw) errors.password = pw;
	return errors;
}

export default function SetupPage() {
	const [form, setForm] = useState<Form>({
		setupToken: "",
		name: "",
		email: "",
		password: "",
	});
	const [errors, setErrors] = useState<Errors>({});
	const [formError, setFormError] = useState("");
	const [busy, setBusy] = useState(false);
	const setUser = useAuth((s) => s.setUser);
	const navigate = useNavigate();
	const { data: status, isError: statusError, refetch } = useSetupStatus();

	if (status && !status.needsSetup) return <Navigate to="/login" replace />;

	const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => {
		setForm((f) => ({ ...f, [k]: e.target.value }));
		setErrors((er) => ({ ...er, [k]: undefined }));
	};

	const submit = async (e: React.FormEvent) => {
		e.preventDefault();
		const found = validate(form);
		setErrors(found);
		setFormError("");
		if (Object.keys(found).length > 0) return;
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
			const msg = errorMessage(err);
			const field = err instanceof ApiError ? err.field : null;
			if (field && field in form) setErrors({ [field]: msg });
			else setFormError(msg);
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className={authPage}>
			<form noValidate onSubmit={submit} className={authCard}>
				<h2 className={authTitle}>Create the first admin</h2>
				{statusError && <SetupStatusError onRetry={() => void refetch()} />}
				{formError && (
					<p role="alert" className={authError}>
						{formError}
					</p>
				)}
				<AuthField
					type="password"
					label="Setup token"
					autoComplete="off"
					value={form.setupToken}
					onChange={set("setupToken")}
					error={errors.setupToken}
				/>
				<AuthField
					type="text"
					label="Name"
					autoComplete="name"
					value={form.name}
					onChange={set("name")}
					error={errors.name}
				/>
				<AuthField
					type="email"
					label="Email"
					autoComplete="username"
					value={form.email}
					onChange={set("email")}
					error={errors.email}
				/>
				<AuthField
					type="password"
					label="Password"
					placeholder="Password (12+ characters)"
					autoComplete="new-password"
					value={form.password}
					onChange={set("password")}
					error={errors.password}
				/>
				<button type="submit" disabled={busy} className={authButton}>
					{busy ? "Creating admin…" : "Create admin"}
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
