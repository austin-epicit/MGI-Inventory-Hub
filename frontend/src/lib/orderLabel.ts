// Cin7 sends enum strings in capitals ("FULLY RECEIVED"); the UI shows sentence case.
// The API and the filter params keep the raw value.
export function orderLabel(raw: string | null | undefined): string {
	const t = (raw ?? "").trim().replace(/_/g, " ").toLowerCase();
	return t ? t[0]!.toUpperCase() + t.slice(1) : "";
}
