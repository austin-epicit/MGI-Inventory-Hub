import type { ConditionGrade } from "./condition";
import { gradeLabel } from "./condition";

export default function GradeBadge({ grade }: { grade: ConditionGrade | null }) {
	return (
		<span
			className={`inline-flex h-5 items-center rounded-full border px-2 text-xs font-medium ${
				grade
					? "border-border bg-surface-raised text-text-primary"
					: "border-border-subtle bg-surface text-text-muted"
			}`}
		>
			{gradeLabel(grade)}
		</span>
	);
}
