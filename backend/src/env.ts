import { z } from "zod";

const base64Key = z
	.string()
	.refine(
		(v) => Buffer.from(v, "base64").length === 32,
		"must be base64 for exactly 32 bytes"
	);

const DEMO_IN_PRODUCTION =
	'"fixture" serves demo data; in production set CIN7_SOURCE=http, ' +
	"or ALLOW_DEMO_DATA=true for a deliberate demo";

const schema = z
	.object({
		NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
		PORT: z.coerce.number().int().positive().default(3100),
		DATABASE_URL: z.string().min(1),
		TEST_DATABASE_URL: z.string().min(1).optional(),
		JWT_SECRET: z.string().min(16),
		SESSION_TTL_HOURS: z.coerce.number().positive().default(12),
		ENCRYPTION_KEY: base64Key,
		SETUP_TOKEN: z.string().min(8),
		APP_TIMEZONE: z.string().min(1).default("America/Los_Angeles"),
		CIN7_SOURCE: z.enum(["fixture", "http"]).default("fixture"),
		CIN7_BASE_URL: z
			.string()
			.url()
			.default("https://inventory.dearsystems.com/ExternalApi/v2/"),
		UPLOADS_DIR: z.string().min(1).default("/data/uploads"),
		TRUST_PROXY: z.coerce.number().int().min(0).default(0),
		PUBLIC_BASE_URL: z.string().url(),
		BACKFILL_MONTHS: z.coerce.number().int().positive().default(24),
		// Literal strings only: a typo must not decide whether demo data may run.
		ALLOW_DEMO_DATA: z
			.enum(["true", "false"])
			.default("false")
			.transform((v) => v === "true"),
	})
	// The Application Key rides in a header on every call: never over plain http in production.
	.superRefine((env, ctx) => {
		if (env.NODE_ENV === "production" && !env.CIN7_BASE_URL.startsWith("https://"))
			ctx.addIssue({
				code: "custom",
				path: ["CIN7_BASE_URL"],
				message: "must be an https URL in production",
			});
	})
	// CIN7_SOURCE defaults to fixture: without this, a production deploy that forgot to set it
	// would quietly serve demo data. A deliberate hosted demo opts in.
	.superRefine((env, ctx) => {
		if (
			env.NODE_ENV === "production" &&
			env.CIN7_SOURCE === "fixture" &&
			!env.ALLOW_DEMO_DATA
		)
			ctx.addIssue({
				code: "custom",
				path: ["CIN7_SOURCE"],
				message: DEMO_IN_PRODUCTION,
			});
	});

export type Env = z.infer<typeof schema>;

export const parseEnv = (source: NodeJS.ProcessEnv): Env => {
	const parsed = schema.safeParse(source);
	if (!parsed.success) {
		const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
		throw new Error(`Invalid environment: ${issues.join("; ")}`);
	}
	return parsed.data;
};
