import { useParams } from "react-router-dom";
import SetPasswordForm from "./SetPasswordForm";

export default function AcceptInvitePage() {
	const { token = "" } = useParams();
	return (
		<SetPasswordForm
			title="Accept your invite"
			endpoint="/api/auth/accept-invite"
			token={token}
			cta="Set password and sign in"
		/>
	);
}
