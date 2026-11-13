import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/store";
import { errorMessage } from "../lib/api";
import { useSyncStatus } from "../features/settings/hooks";
import { computeFreshness, type FreshnessTone } from "./freshness";

const TONE: Record<FreshnessTone, string> = {
	demo: "border-info-border bg-info-bg text-info-text",
	neutral: "border-border-subtle bg-surface text-text-muted",
	warning: "border-warning-border bg-warning-bg text-warning-text",
	error: "border-error-border bg-error-bg text-error-text",
};

export default function FreshnessIndicator() {
	const { data, isError, error } = useSyncStatus();
	const isAdmin = useAuth((s) => s.user?.role === "admin");
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const t = setInterval(() => setNow(Date.now()), 30_000);
		return () => clearInterval(t);
	}, []);
	if (!data && !isError) return null;

	// An outage of the status endpoint itself must not read as "all fine": say it is unknown.
	const { tone, label, detail, inline } = isError
		? {
				tone: "warning" as const,
				label: "Status unavailable",
				detail: errorMessage(error),
			}
		: computeFreshness(data!, now);
	const className = `inline-flex max-w-72 items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium whitespace-nowrap ${TONE[tone]}`;
	const body = (
		<>
			<span className="truncate">{label}</span>
			{(tone === "error" || inline) && detail && (
				<span className="truncate font-normal">&middot; {detail}</span>
			)}
		</>
	);
	// Admins can act on a problem, so the badge leads to Settings; everyone else just reads it.
	return isAdmin ? (
		<Link to="/settings" className={className} title={detail ?? label} data-tone={tone}>
			{body}
		</Link>
	) : (
		<span className={className} title={detail ?? label} data-tone={tone}>
			{body}
		</span>
	);
}
