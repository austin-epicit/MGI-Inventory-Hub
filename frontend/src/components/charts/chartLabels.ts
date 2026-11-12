// Vertical de-collision for direct series labels.
//
// Labelling each line at its own end point only works while the lines END far
// apart. On the cost & pricing chart they routinely don't — set cost and paid
// cost track each other by design, and list vs charged price often land within a
// dollar — so the labels drew on top of each other. Anchoring each label to its
// series' value and then pushing them apart keeps the mapping honest (a label
// still sits nearest its own line) while guaranteeing they stay readable.

export interface LabelSlot {
	/** Series identity, for React keys. */
	key: string;
	label: string;
	color: string;
	/** Preferred y: where the series actually ends. */
	y: number;
	/** Dash pattern of the line this labels, so the swatch matches the plot. */
	dash?: string;
}

/**
 * Value → pixel y on a linear axis. Recharts 3.7 exposes the plot area and the y
 * DOMAIN as public hooks but not the y scale itself (`useYAxis` is internal), so
 * the mapping lives here — where it's also testable without a chart. Returns null
 * for a degenerate domain rather than dividing by zero.
 */
export function valueToY(
	value: number,
	domain: [number, number],
	plot: { y: number; height: number }
): number | null {
	const [min, max] = domain;
	if (!Number.isFinite(min) || !Number.isFinite(max) || max === min) return null;
	const ratio = (value - min) / (max - min);
	return plot.y + (1 - ratio) * plot.height;
}

/**
 * Two-pass stacking: push down from the top to open `minGap` between neighbours,
 * then push back up from the bottom so the last label can't spill past `bottom`.
 * Ordering by preferred y is what keeps each label beside its own line after the
 * nudging.
 */
export function stackLabels(
	slots: LabelSlot[],
	{ minGap, top, bottom }: { minGap: number; top: number; bottom: number }
): LabelSlot[] {
	const ordered = slots.map((s) => ({ ...s })).sort((a, b) => a.y - b.y);

	let cursor = top;
	for (const slot of ordered) {
		slot.y = Math.max(slot.y, cursor);
		cursor = slot.y + minGap;
	}

	// The downward pass can run the tail past the plot, so walk back up. `bottom`
	// wins over `minGap` only when there isn't room for both — which packs the
	// labels evenly rather than leaving one off-canvas.
	cursor = bottom;
	for (let i = ordered.length - 1; i >= 0; i--) {
		ordered[i].y = Math.min(ordered[i].y, cursor);
		cursor = ordered[i].y - minGap;
	}

	return ordered;
}
