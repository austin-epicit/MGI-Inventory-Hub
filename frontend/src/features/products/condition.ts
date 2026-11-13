// Mirrors backend/src/products/condition.ts.
export const CONDITION_GRADES = ["A", "B", "C", "open_box", "for_parts"] as const;
export type ConditionGrade = (typeof CONDITION_GRADES)[number];

export const GRADE_LABELS: Record<ConditionGrade, string> = {
	A: "Grade A",
	B: "Grade B",
	C: "Grade C",
	open_box: "Open box",
	for_parts: "For parts",
};
export const NOT_GRADED = "Not graded";

export const gradeLabel = (g: ConditionGrade | null): string => (g ? GRADE_LABELS[g] : NOT_GRADED);
