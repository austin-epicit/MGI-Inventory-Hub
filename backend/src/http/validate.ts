import type { RequestHandler } from "express";
import { z, type ZodType } from "zod";
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
				const issues = parsed.error.issues.map(
					(i) => `${[part, ...i.path].join(".")}: ${i.message}`
				);
				return next(httpError(400, "VALIDATION_ERROR", issues.join("; ")));
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
