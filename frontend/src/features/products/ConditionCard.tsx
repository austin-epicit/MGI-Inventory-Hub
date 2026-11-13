import { useId, useState } from "react";
import Card from "../../components/ui/Card";
import Dropdown from "../../components/ui/Dropdown";
import { HEADER_BTN_PRIMARY, HEADER_BTN_SECONDARY } from "../../components/ui/headerActions";
import { useAuth } from "../../auth/store";
import { errorMessage } from "../../lib/api";
import { formatCount, formatDateTime } from "../../lib/format";
import type { ProductCondition } from "./api";
import { CONDITION_GRADES, GRADE_LABELS, NOT_GRADED, type ConditionGrade } from "./condition";
import GradeBadge from "./GradeBadge";
import { useSaveProductCondition } from "./hooks";

const NOTES_MAX = 2000;
const FIELD_LABEL = "mb-1 block text-xs font-medium text-text-secondary";
const TEXTAREA =
	"w-full resize-y rounded-md border border-border-input bg-input-bg px-3 py-1.5 text-sm text-text-primary placeholder:text-text-faint focus:outline-none focus:ring-1 focus:ring-primary transition-colors";

function ConditionForm({
	productId,
	condition,
	onDone,
}: {
	productId: string;
	condition: ProductCondition | null;
	onDone: () => void;
}) {
	const [grade, setGrade] = useState<string>(condition?.grade ?? "");
	const [notes, setNotes] = useState(condition?.notes ?? "");
	const save = useSaveProductCondition(productId);
	const gradeId = useId();
	const notesId = useId();

	const submit = (e: React.FormEvent) => {
		e.preventDefault();
		save.mutate(
			{
				grade: (grade || null) as ConditionGrade | null,
				notes: notes.trim() || null,
			},
			{ onSuccess: onDone }
		);
	};

	return (
		<form onSubmit={submit} className="flex flex-col gap-3">
			<div>
				<label htmlFor={gradeId} className={FIELD_LABEL}>
					Grade
				</label>
				<Dropdown
					id={gradeId}
					value={grade}
					onChange={setGrade}
					entries={[
						<option key="none" value="">
							{NOT_GRADED}
						</option>,
						...CONDITION_GRADES.map((g) => (
							<option key={g} value={g}>
								{GRADE_LABELS[g]}
							</option>
						)),
					]}
				/>
			</div>
			<div>
				<label htmlFor={notesId} className={FIELD_LABEL}>
					Notes
				</label>
				<textarea
					id={notesId}
					className={TEXTAREA}
					rows={4}
					maxLength={NOTES_MAX}
					value={notes}
					onChange={(e) => setNotes(e.target.value)}
				/>
				<p className="mt-1 text-right text-xs tabular-nums text-text-muted">
					{formatCount(notes.length)} / {formatCount(NOTES_MAX)}
				</p>
			</div>
			{save.error && (
				<p role="alert" className="text-sm text-error-text">
					{errorMessage(save.error, {
						403: "Only an admin can change the condition.",
					})}
				</p>
			)}
			<div className="flex justify-end gap-2">
				<button
					type="button"
					className={HEADER_BTN_SECONDARY}
					onClick={onDone}
					disabled={save.isPending}
				>
					Cancel
				</button>
				<button
					type="submit"
					className={HEADER_BTN_PRIMARY}
					disabled={save.isPending}
				>
					{save.isPending ? "Saving…" : "Save"}
				</button>
			</div>
		</form>
	);
}

export default function ConditionCard({
	productId,
	condition,
}: {
	productId: string;
	condition: ProductCondition | null;
}) {
	const isAdmin = useAuth((s) => s.user)?.role === "admin";
	const [editing, setEditing] = useState(false);

	return (
		<Card
			title="Condition"
			headerAction={
				isAdmin && !editing ? (
					<button
						type="button"
						className={HEADER_BTN_SECONDARY}
						onClick={() => setEditing(true)}
					>
						Edit
					</button>
				) : undefined
			}
		>
			{editing ? (
				<ConditionForm
					productId={productId}
					condition={condition}
					onDone={() => setEditing(false)}
				/>
			) : (
				<div className="flex flex-col gap-2">
					<div>
						<GradeBadge grade={condition?.grade ?? null} />
					</div>
					{condition?.notes && (
						<p className="whitespace-pre-line break-words text-sm text-text-secondary">
							{condition.notes}
						</p>
					)}
					{condition && (
						<p className="text-xs text-text-muted">
							{condition.updatedBy
								? `Edited by ${condition.updatedBy} · `
								: "Edited "}
							{formatDateTime(condition.updatedAt)}
						</p>
					)}
				</div>
			)}
		</Card>
	);
}
