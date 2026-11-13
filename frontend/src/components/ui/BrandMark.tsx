// MGI mark, vectorized from MGI-icon-4C; the dark half follows the text color so it shows in both themes.
export default function BrandMark({ className = "" }: { className?: string }) {
	return (
		<svg viewBox="-58 0 604 604" className={className} aria-hidden="true">
			<path d="M300 115 L115 300 L300 488 Z" fill="currentColor" />
			<path d="M300 115 L487 300 L300 488 Z" fill="#f69622" />
			<g fill="none" stroke="currentColor">
				<path strokeWidth={17} d="M75 263 L280 60 M75 340 L280 543" />
				<g strokeWidth={19}>
					<circle cx="301" cy="40" r="23" />
					<circle cx="36" cy="300" r="23" />
					<circle cx="301" cy="563" r="23" />
				</g>
			</g>
		</svg>
	);
}
