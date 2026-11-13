import type { Db } from "../db.js";

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

export type ProductCondition = {
	grade: ConditionGrade | null;
	notes: string | null;
	updatedAt: string;
	updatedBy: string | null;
};

const toCondition = (r: {
	grade: ConditionGrade | null;
	notes: string | null;
	updated_at: Date;
	editor: { name: string } | null;
}): ProductCondition => ({
	grade: r.grade,
	notes: r.notes,
	updatedAt: r.updated_at.toISOString(),
	updatedBy: r.editor?.name ?? null,
});

export async function getCondition(db: Db, productId: string): Promise<ProductCondition | null> {
	const row = await db.product_condition.findUnique({
		where: { product_id: productId },
		include: { editor: { select: { name: true } } },
	});
	return row ? toCondition(row) : null;
}

// Both fields empty means "no condition", so the row goes rather than lingering as a blank.
export async function saveCondition(
	db: Db,
	productId: string,
	input: { grade: ConditionGrade | null; notes: string | null },
	userId: string
): Promise<ProductCondition | null> {
	if (input.grade === null && input.notes === null) {
		await db.product_condition.deleteMany({ where: { product_id: productId } });
		return null;
	}
	const data = { grade: input.grade, notes: input.notes, updated_by: userId };
	const row = await db.product_condition.upsert({
		where: { product_id: productId },
		create: { product_id: productId, ...data },
		update: data,
		include: { editor: { select: { name: true } } },
	});
	return toCondition(row);
}

// Demo seeding only: the grade a product's name already advertises.
export function gradeFromName(name: string): ConditionGrade | null {
	const n = name.toLowerCase();
	if (n.includes("grade a")) return "A";
	if (n.includes("grade b")) return "B";
	if (n.includes("grade c")) return "C";
	if (n.includes("open box")) return "open_box";
	return null;
}
