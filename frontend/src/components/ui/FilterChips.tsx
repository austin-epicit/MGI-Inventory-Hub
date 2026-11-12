import { X } from "lucide-react";

export type ChipColor = "purple" | "blue" | "green" | "orange" | "cyan" | "rose";

export interface FilterChip {
	label: string;
	color: ChipColor;
	classes?: string;
	onRemove: () => void;
	highlighted?: boolean;
}

interface FilterChipsProps {
	filters: (FilterChip | null | undefined)[];
	resultCount: number;
	onClearAll: () => void;
}

const COLOR_STYLES: Record<ChipColor, { bg: string; border: string; text: string; ring: string }> =
	{
		purple: {
			bg: "bg-reviewing-bg",
			border: "border-reviewing/30",
			text: "text-reviewing-text",
			ring: "ring-reviewing",
		},
		blue: {
			bg: "bg-primary-hover/20",
			border: "border-primary/30",
			text: "text-primary-text",
			ring: "ring-primary",
		},
		green: {
			bg: "bg-success-bg",
			border: "border-success/30",
			text: "text-success-text",
			ring: "ring-success",
		},
		orange: {
			bg: "bg-orange-bg",
			border: "border-orange-border",
			text: "text-orange-text",
			ring: "ring-orange",
		},
		cyan: {
			bg: "bg-info-bg",
			border: "border-info/30",
			text: "text-info-text",
			ring: "ring-info",
		},
		rose: {
			bg: "bg-rejected-bg",
			border: "border-rejected/30",
			text: "text-rejected-text",
			ring: "ring-rejected",
		},
	};

export default function FilterChips({
	filters: rawFilters,
	resultCount,
	onClearAll,
}: FilterChipsProps) {
	const filters = rawFilters.filter((f): f is FilterChip => f != null);
	if (filters.length === 0) return null;

	return (
		<div className="mb-3 p-2.5 bg-base rounded-md border border-border/60">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2 flex-wrap">
					<span className="text-sm text-text-tertiary">
						Active filters:
					</span>
					{filters.map((chip) => {
						const { bg, border, text, ring } =
							COLOR_STYLES[chip.color];
						const shell =
							chip.classes ?? `${bg} ${border} ${text}`;
						return (
							<div
								key={chip.label}
								className={`flex items-center gap-2 px-3 py-1.5 border rounded-md transition-shadow ${shell} ${chip.highlighted ? `ring-2 ${ring}` : ""}`}
							>
								<span className="text-sm">
									{chip.label}
								</span>
								<button
									onClick={chip.onRemove}
									className="p-1 -m-1 hover:text-text-primary transition-colors"
									aria-label={`Remove ${chip.label} filter`}
								>
									<X size={14} />
								</button>
							</div>
						);
					})}
					<span className="text-sm text-text-muted">
						• {resultCount}{" "}
						{resultCount === 1 ? "result" : "results"}
					</span>
				</div>
				<button
					onClick={onClearAll}
					className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-error-text hover:text-error-text hover:bg-surface-raised/50 rounded-md transition-colors"
				>
					Clear All
					<X size={14} />
				</button>
			</div>
		</div>
	);
}
