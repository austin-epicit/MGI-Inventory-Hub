import { NavLink } from "react-router-dom";

export default function SideNavItem({
	to,
	icon,
	label,
	expanded,
	end = true,
	badge,
	badgeLabel,
}: {
	to: string;
	icon: React.ReactNode;
	label: string;
	expanded: boolean;
	end?: boolean;
	/** Short count text pinned to the icon; omit for none. */
	badge?: string;
	/** Spoken form of the badge ("3 open alerts"); the visible text alone is just a number. */
	badgeLabel?: string;
}) {
	return (
		<NavLink
			to={to}
			end={end}
			className={({ isActive }) =>
				`
				group relative flex items-center h-10 short:h-8 scroll-mb-6 rounded-md mx-2
				transition-colors duration-200
				${isActive ? "bg-primary-bg text-primary-text" : "text-text-tertiary hover:text-text-primary hover:bg-surface-raised"}
				`
			}
		>
			{/* Icon container - fixed at collapsed sidebar width for alignment */}
			<div className="w-12 flex items-center justify-center flex-shrink-0">
				<span className="relative flex">
					{icon}
					{badge && (
						<span
							role="img"
							aria-label={badgeLabel ?? badge}
							data-testid="nav-badge"
							className="absolute -right-2 -top-1.5 min-w-4 rounded-full border border-border bg-surface-raised px-1 text-center text-[10px] font-semibold leading-4 text-text-secondary tabular-nums"
						>
							{badge}
						</span>
					)}
				</span>
			</div>

			{/* Label - min-w-0 is what lets truncate work inside the flex row */}
			<div
				className={`
					flex-1 min-w-0 flex items-center overflow-hidden
					transition-[opacity,transform] duration-200 ease-in-out
					${expanded ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-2 pointer-events-none"}
				`}
			>
				<span className="text-sm whitespace-nowrap truncate w-full pr-2">
					{label}
				</span>
			</div>
		</NavLink>
	);
}
