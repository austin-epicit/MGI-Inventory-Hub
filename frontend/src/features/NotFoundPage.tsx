import { Link } from "react-router-dom";
import EmptyState from "../components/ui/EmptyState";

export default function NotFoundPage() {
	return (
		<div className="flex flex-col items-center">
			<EmptyState
				title="Page not found"
				description="This address doesn't match anything in the app."
			/>
			<Link to="/" className="-mt-8 text-sm text-text-link hover:underline">
				Back to Overview
			</Link>
		</div>
	);
}
