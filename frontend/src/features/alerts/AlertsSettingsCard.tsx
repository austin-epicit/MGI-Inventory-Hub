import { useState } from "react";
import Card from "../../components/ui/Card";
import { HEADER_BTN_PRIMARY, HEADER_BTN_SECONDARY } from "../../components/ui/headerActions";
import { ApiError, errorMessage, isTransportError } from "../../lib/api";
import { inputClass } from "../settings/ui";
import type { AlertThresholds } from "./api";
import { useAlertThresholds, useSaveAlertThresholds } from "./hooks";

const ANCHOR = "alerts-settings";

type Field = {
	key: keyof AlertThresholds;
	label: string;
	unit: string;
	min: number;
	max: number;
	integer: boolean;
};

// Bounds mirror thresholdsSchema in backend/src/alerts/thresholds.ts.
const FIELDS: Field[] = [
	{
		key: "costChangePct",
		label: "Cost change at least",
		unit: "%",
		min: 1,
		max: 1000,
		integer: true,
	},
	{
		key: "costChangeDays",
		label: "Cost change look-back",
		unit: "days",
		min: 1,
		max: 3650,
		integer: true,
	},
	{
		key: "slowMoverDays",
		label: "Slow mover: no sale for",
		unit: "days",
		min: 1,
		max: 3650,
		integer: true,
	},
	{
		key: "slowMoverMinValue",
		label: "Slow mover: stock value at least",
		unit: "base currency",
		min: 0,
		max: 100_000_000,
		integer: false,
	},
];

const validate = (f: Field, raw: string): string | null => {
	const v = raw.trim();
	if (v === "") return "Enter a number.";
	if (!(f.integer ? /^\d+$/ : /^\d+(\.\d+)?$/).test(v))
		return f.integer ? "Use a whole number." : "Use a number, like 1000 or 250.50.";
	const n = Number(v);
	if (n < f.min || n > f.max)
		return `Enter ${f.min.toLocaleString("en-US")} to ${f.max.toLocaleString("en-US")}.`;
	return null;
};

function Form({ initial }: { initial: AlertThresholds }) {
	const save = useSaveAlertThresholds();
	const [draft, setDraft] = useState<Record<keyof AlertThresholds, string>>({
		costChangePct: String(initial.costChangePct),
		costChangeDays: String(initial.costChangeDays),
		slowMoverDays: String(initial.slowMoverDays),
		slowMoverMinValue: String(initial.slowMoverMinValue),
	});
	const [errors, setErrors] = useState<Partial<Record<keyof AlertThresholds, string>>>({});

	const submit = () => {
		const next: typeof errors = {};
		for (const f of FIELDS) {
			const msg = validate(f, draft[f.key]);
			if (msg) next[f.key] = msg;
		}
		setErrors(next);
		if (Object.keys(next).length > 0) return;
		save.mutate({
			costChangePct: Number(draft.costChangePct),
			costChangeDays: Number(draft.costChangeDays),
			slowMoverDays: Number(draft.slowMoverDays),
			slowMoverMinValue: Number(draft.slowMoverMinValue),
		});
	};

	// The server's validator text names schema fields, so show a plain sentence instead.
	const serverError = !save.isError
		? null
		: isTransportError(save.error)
			? errorMessage(save.error)
			: save.error instanceof ApiError && save.error.status === 400
				? "Those values were not accepted. Check the limits and try again."
				: "Couldn't save the thresholds. Try again.";

	return (
		<form
			className="space-y-3"
			noValidate
			onSubmit={(e) => {
				e.preventDefault();
				submit();
			}}
		>
			<div className="grid gap-3 sm:grid-cols-2">
				{FIELDS.map((f) => (
					<label
						key={f.key}
						className="text-xs font-medium text-text-secondary"
					>
						{f.label} ({f.unit})
						{/* Text, not type=number: native spinners render light in dark mode. */}
						<input
							type="text"
							inputMode={
								f.integer ? "numeric" : "decimal"
							}
							className={`${inputClass} mt-1`}
							value={draft[f.key]}
							aria-invalid={
								errors[f.key] ? true : undefined
							}
							onChange={(e) => {
								save.reset();
								setErrors({
									...errors,
									[f.key]: undefined,
								});
								setDraft({
									...draft,
									[f.key]: e.target.value,
								});
							}}
						/>
						{errors[f.key] && (
							<span className="mt-1 block text-xs font-normal text-error-text">
								{errors[f.key]}
							</span>
						)}
					</label>
				))}
			</div>
			{serverError && (
				<p role="alert" className="text-sm text-error-text">
					{serverError}
				</p>
			)}
			{save.isSuccess && <p className="text-xs text-success-text">Saved.</p>}
			<button
				type="submit"
				className={HEADER_BTN_PRIMARY}
				disabled={save.isPending}
			>
				{save.isPending ? "Saving…" : "Save"}
			</button>
		</form>
	);
}

export default function AlertsSettingsCard() {
	const { data, isLoading, isError, refetch } = useAlertThresholds();
	return (
		<div id={ANCHOR} className="scroll-mt-4">
			<Card title="Alerts">
				<div className="space-y-3">
					<p className="text-sm text-text-muted">
						When a cost change or a slow mover shows up on the
						Alerts page.
					</p>
					{isLoading ? (
						<p className="text-sm text-text-muted">Loading…</p>
					) : isError || !data ? (
						<div className="flex items-center gap-3 text-sm text-error-text">
							<span role="alert">
								Couldn't load the alert thresholds.
							</span>
							<button
								type="button"
								className={HEADER_BTN_SECONDARY}
								onClick={() => void refetch()}
							>
								Try again
							</button>
						</div>
					) : (
						<Form initial={data} />
					)}
				</div>
			</Card>
		</div>
	);
}
