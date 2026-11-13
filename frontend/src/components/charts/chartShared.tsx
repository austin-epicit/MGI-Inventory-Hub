import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import EmptyState from "../ui/EmptyState";

// Shared chrome for chart cards.

/**
 * A failed read, rendered as a failed read: every detail card must route a
 * query error into this state rather than its empty state, because "No
 * history yet" over a 500 is a false claim about data that is still there.
 * `onRetry` is the query's refetch; omit it where retrying can't help.
 */
export function QueryErrorState({
	what,
	onRetry,
}: {
	/** What couldn't be loaded, lowercase noun phrase: "stock history". */
	what: string;
	onRetry?: () => void;
}) {
	return (
		<EmptyState
			icon={<AlertTriangle size={26} />}
			title={`Couldn't load ${what}`}
			description="Something went wrong fetching this. The data is still there — try again."
			action={onRetry ? { label: "Try again", onClick: onRetry } : undefined}
		/>
	);
}

/** Header chip: a fact about the whole series that the plot can't state itself. */
export function ChartChip({ children }: { children: ReactNode }) {
	return (
		<span className="text-xs font-medium text-text-muted bg-surface border border-border-subtle rounded-full px-2 py-0.5">
			{children}
		</span>
	);
}

/** The frosted tooltip surface every chart on this tab hovers with. */
export function ChartTooltipShell({ title, children }: { title: ReactNode; children: ReactNode }) {
	return (
		<div className="popover-panel px-3 py-2">
			<p className="text-xs text-text-tertiary mb-1">{title}</p>
			{children}
		</div>
	);
}
