import type { SyncStatus } from "../features/settings/api";

export type FreshnessTone = "demo" | "neutral" | "warning" | "error";
export type Freshness = {
	tone: FreshnessTone;
	label: string;
	detail?: string;
	// Shown next to the label instead of only in the tooltip.
	inline?: boolean;
};

export const STALE_AFTER_MS = 30 * 60_000;

const REASONS: Record<string, string> = {
	CIN7_AUTH: "Cin7 rejected the saved credentials",
	CIN7_HTTP: "Cin7 could not be reached",
	CIN7_RATE_LIMIT: "Cin7 rate limit reached",
	INTERRUPTED: "The last sync was interrupted",
};

export function ago(iso: string, now: number): string {
	const mins = Math.floor(Math.max(0, now - Date.parse(iso)) / 60_000);
	if (mins < 1) return "just now";
	if (mins < 60) return `${mins} min ago`;
	const hours = Math.floor(mins / 60);
	return hours < 24 ? `${hours} h ago` : `${Math.floor(hours / 24)} d ago`;
}

export function computeFreshness(status: SyncStatus, now: number): Freshness {
	if (status.source === "fixture") return { tone: "demo", label: "Demo data" };
	if (!status.connected) return { tone: "neutral", label: "Cin7 not connected" };
	const run = status.lastRun;
	if (run?.status === "failed") {
		const reason = (run.errorCode && REASONS[run.errorCode]) || run.errorMessage;
		return {
			tone: "error",
			label: "Sync failing",
			...(reason ? { detail: reason } : {}),
		};
	}
	const skipped = status.quarantined.count;
	const skippedNote = `${skipped} ${skipped === 1 ? "record" : "records"} skipped`;
	if (!status.lastSuccessAt) {
		const label = status.running ? "First sync running" : "Not synced yet";
		// Skipped records are already missing from the totals, even before a clean run.
		if (skipped > 0)
			return { tone: "warning", label, detail: skippedNote, inline: true };
		return { tone: "neutral", label };
	}
	const label = `Synced ${ago(status.lastSuccessAt, now)}`;
	if (run?.status === "partial")
		return { tone: "warning", label, detail: "Some records could not be synced" };
	if (now - Date.parse(status.lastSuccessAt) > STALE_AFTER_MS)
		return { tone: "warning", label, detail: "No successful sync in over 30 minutes" };
	// Skipped records are missing from every total, so the badge must not look healthy.
	if (skipped > 0) return { tone: "warning", label, detail: skippedNote, inline: true };
	return { tone: "neutral", label };
}
