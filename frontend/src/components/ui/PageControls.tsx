import type { ReactNode } from "react";

interface PageControlsProps {
	left?: ReactNode;
	middle?: ReactNode;
	right?: ReactNode;
	className?: string;
}

export default function PageControls({ left, middle, right, className }: PageControlsProps) {
	return (
		<div className={`flex flex-wrap items-center gap-2 ${className ?? ""}`}>
			{left && (
				<div className="flex flex-1 min-w-0 items-center gap-2">{left}</div>
			)}
			{left && middle && <div className="h-6 w-px bg-border hidden sm:block" />}
			{middle && <div className="flex items-center">{middle}</div>}
			{middle && right && <div className="h-6 w-px bg-border hidden sm:block" />}
			{right && <div className="flex items-center gap-2 shrink-0">{right}</div>}
		</div>
	);
}
