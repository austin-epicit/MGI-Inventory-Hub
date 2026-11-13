import type { ReactNode } from "react";
import { AlertCircle } from "lucide-react";

interface ReportStateProps {
	loading: boolean;
	error: Error | null;
	errorMessage: string;
	onRetry?: () => void;
	isEmpty?: boolean;
	emptyMessage?: string;
	skeleton?: ReactNode;
	skeletonClassName?: string;
	children: ReactNode;
}

export default function ReportState({
	loading,
	error,
	errorMessage,
	onRetry,
	isEmpty = false,
	emptyMessage = "No data available",
	skeleton,
	skeletonClassName = "h-full rounded-lg",
	children,
}: ReportStateProps) {
	if (error) {
		return (
			<div className="flex items-center gap-2 p-4 bg-error/10 border border-error/20 rounded-lg">
				<AlertCircle size={16} className="text-error-text" />
				<p className="text-sm text-error-text">{errorMessage}</p>
				{onRetry && (
					<button
						type="button"
						onClick={onRetry}
						className="ml-auto text-sm font-medium text-error-text underline hover:no-underline"
					>
						Try again
					</button>
				)}
			</div>
		);
	}

	if (loading) {
		if (skeleton) return <>{skeleton}</>;
		return (
			<div
				className={`bg-base border border-border-subtle animate-pulse ${skeletonClassName}`}
			/>
		);
	}

	if (isEmpty) {
		return (
			<div className="flex items-center justify-center p-4 text-sm text-text-muted">
				{emptyMessage}
			</div>
		);
	}

	return <>{children}</>;
}
