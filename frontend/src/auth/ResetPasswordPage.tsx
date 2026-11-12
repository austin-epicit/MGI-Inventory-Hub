import { useParams } from "react-router-dom";
import SetPasswordForm from "./SetPasswordForm";

export default function ResetPasswordPage() {
	const { token = "" } = useParams();
	return (
		<SetPasswordForm
			title="Reset your password"
			endpoint="/api/auth/reset"
			token={token}
			cta="Reset password and sign in"
		/>
	);
}
