import type { ReactNode } from "react";

export interface EmptyStateAction {
	label: string;
	onClick: () => void;
	icon?: ReactNode;
}

export interface EmptyStateProps {
	title: string;
	description?: string;
	icon?: ReactNode;
	action?: EmptyStateAction;
}

// Shared empty-state layout — extracted from the detail page's Tracking tab
// SerialsTable/BatchesTable. Callers own their own copy/CTA;
// this only owns layout + token choices so every empty state reads identically.
export default function EmptyState({ title, description, icon, action }: EmptyStateProps) {
	return (
		<div className="flex flex-col items-center justify-center py-14 text-center">
			{icon && <div className="mb-2 text-text-faint">{icon}</div>}
			<p className="text-sm font-medium text-text-secondary">{title}</p>
			{description && (
				<p className="text-xs text-text-muted mt-1 max-w-72">
					{description}
				</p>
			)}
			{action && (
				<button
					type="button"
					onClick={action.onClick}
					className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-primary-fill hover:bg-primary-fill-hover text-on-primary rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
				>
					{action.icon}
					{action.label}
				</button>
			)}
		</div>
	);
}
