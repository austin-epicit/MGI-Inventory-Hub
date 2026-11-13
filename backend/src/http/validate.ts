import type { RequestHandler } from "express";
import { z, type ZodIssue, type ZodType } from "zod";
import { fieldLabel } from "./fieldLabels.js";
import { httpError } from "./responses.js";

declare global {
	// eslint-disable-next-line @typescript-eslint/no-namespace
	namespace Express {
		interface Request {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			valid: { body: any; query: any; params: any };
		}
	}
}

type Schemas = { body?: ZodType; query?: ZodType; params?: ZodType };

const lowerFirst = (s: string): string => (s ? s[0].toLowerCase() + s.slice(1) : s);

// Zod's own texts are developer-facing, so common codes get fixed wording; custom refinements
// already carry a human message and keep it.
const reasonFor = (issue: ZodIssue): string => {
	switch (issue.code) {
		case "invalid_format":
			if (issue.format === "email") return "enter a valid email address";
			// Zod's default texts start with "Invalid"; anything else is a custom regex message.
			return issue.message.startsWith("Invalid")
				? "isn't in the right format"
				: lowerFirst(issue.message);
		case "too_small":
			if (issue.origin === "string") {
				return Number(issue.minimum) <= 1
					? "required"
					: `must be at least ${issue.minimum} characters`;
			}
			return `must be at least ${issue.minimum}`;
		case "too_big":
			return issue.origin === "string"
				? `must be at most ${issue.maximum} characters`
				: `must be at most ${issue.maximum}`;
		case "invalid_type":
			return issue.message.endsWith("undefined")
				? "required"
				: "isn't the right kind of value";
		case "invalid_value":
			return "isn't one of the allowed options";
		default:
			return lowerFirst(issue.message);
	}
};

const labelOf = (issue: ZodIssue): string => {
	const key = [...issue.path].reverse().find((p) => typeof p === "string");
	return typeof key === "string" ? fieldLabel(key) : "Request";
};

const validationMessage = (issues: ZodIssue[]): string => {
	const labels = [...new Set(issues.map(labelOf))];
	if (labels.length === 1) return `${labels[0]}: ${reasonFor(issues[0]).replace(/\.$/, "")}.`;
	return `Check these fields: ${labels.join(", ")}.`;
};

// A bad value is a 400 naming the field, never silently dropped or reset to defaults.
export const validate =
	(schemas: Schemas): RequestHandler =>
	(req, _res, next) => {
		req.valid = { body: undefined, query: undefined, params: undefined };
		for (const part of ["params", "query", "body"] as const) {
			const schema = schemas[part];
			if (!schema) continue;
			const parsed = schema.safeParse(req[part]);
			if (!parsed.success) {
				const issues = parsed.error.issues;
				const err = httpError(
					400,
					"VALIDATION_ERROR",
					validationMessage(issues)
				);
				err.details = issues;
				err.field = issues[0]?.path.length
					? issues[0].path.join(".")
					: null;
				return next(err);
			}
			req.valid[part] = parsed.data;
		}
		next();
	};

// A real calendar date as "YYYY-MM-DD"; 2026-02-31 is rejected, not rolled forward.
export const ymdParam = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
	.refine((s) => {
		const t = Date.parse(`${s}T00:00:00.000Z`);
		return !Number.isNaN(t) && new Date(t).toISOString().startsWith(s);
	}, "not a real date");
