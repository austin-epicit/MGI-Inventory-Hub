// One mapping for every order table and header: Cin7 status -> tone.
export const TONES = {
	green: "border-success-border bg-success-bg text-success-text",
	blue: "border-primary-border bg-primary-bg text-primary-text",
	neutral: "border-border-subtle bg-surface text-text-muted",
	red: "border-error-border bg-error-bg text-error-text opacity-80",
} as const;

export type OrderStatusTone = keyof typeof TONES;

export function orderStatusTone(status: string): OrderStatusTone {
	switch (status.trim().toUpperCase()) {
		case "VOIDED":
			return "red";
		case "DRAFT":
			return "neutral";
		case "COMPLETED":
		case "INVOICED":
		case "RECEIVED":
			return "green";
		default:
			return "blue";
	}
}
