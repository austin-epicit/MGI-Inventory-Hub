import { Component, type ErrorInfo, type ReactNode } from "react";
import EmptyState from "../components/ui/EmptyState";

type Props = { children: ReactNode; resetKey?: string };
type State = { failed: boolean };

// Keeps one broken page from blanking the shell (nav and header stay usable).
export default class RouteErrorBoundary extends Component<Props, State> {
	state: State = { failed: false };

	static getDerivedStateFromError(): State {
		return { failed: true };
	}

	componentDidCatch(error: Error, info: ErrorInfo) {
		console.error("page render failed", error, info.componentStack);
	}

	componentDidUpdate(prev: Props) {
		// Navigating elsewhere gives the next page a clean try.
		if (this.state.failed && prev.resetKey !== this.props.resetKey)
			this.setState({ failed: false });
	}

	render() {
		if (!this.state.failed) return this.props.children;
		return (
			<EmptyState
				title="This page couldn't be displayed"
				description="Something went wrong while drawing it. Try again, or pick another page."
				action={{
					label: "Reload",
					onClick: () => window.location.reload(),
				}}
			/>
		);
	}
}
