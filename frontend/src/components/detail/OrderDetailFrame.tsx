import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, FileX } from "lucide-react";
import { ApiError } from "../../lib/api";
import EmptyState from "../ui/EmptyState";

// Back link plus the not-found / error / loading states shared by the purchase and sale pages.
export default function OrderDetailFrame({
	backTo,
	backLabel,
	noun,
	loaded,
	error,
	onRetry,
	children,
}: {
	backTo: string;
	backLabel: string;
	noun: string;
	loaded: boolean;
	error: Error | null;
	onRetry: () => void;
	children: ReactNode;
}) {
	const back = (
		<Link
			to={backTo}
			className="mb-3 inline-flex items-center gap-1 text-sm text-text-muted transition-colors duration-150 ease-out hover:text-text-primary"
		>
			<ArrowLeft size={14} />
			{backLabel}
		</Link>
	);
	if (error) {
		const missing =
			error instanceof ApiError && (error.status === 404 || error.status === 400);
		return (
			<div className="text-text-primary">
				{back}
				<EmptyState
					icon={<FileX size={32} />}
					title={
						missing
							? `${noun} not found`
							: `Couldn't load this ${noun.toLowerCase()}`
					}
					description={
						missing
							? "It may have been removed from Cin7."
							: "Something went wrong fetching it. Try again."
					}
					action={
						missing
							? undefined
							: { label: "Try again", onClick: onRetry }
					}
				/>
			</div>
		);
	}
	if (!loaded) {
		return (
			<div className="text-text-primary">
				{back}
				<div className="h-8 w-80 animate-pulse rounded bg-surface-raised" />
				<div className="mt-4 h-24 animate-pulse rounded-xl bg-base" />
				<div className="mt-4 h-96 animate-pulse rounded-xl bg-base" />
			</div>
		);
	}
	return (
		<div className="flex flex-col gap-4 text-text-primary">
			<div>{back}</div>
			{children}
		</div>
	);
}
