import type { Cin7Dataset } from "../../fixtures/generate.js";
import type { Db } from "../db.js";
import type { Env } from "../env.js";
import { loadCredentials, parseKey, type Cin7Credentials } from "./credentials.js";
import { createHttpSource } from "./httpSource.js";
import { createRateLimiter, type RateLimiter } from "./rateLimiter.js";
import type { Cin7Source } from "./source.js";

// The same demo dataset the tests use (test/helpers/dataset.ts).
export const DEMO_DATASET = { seed: 42, asOf: "2026-11-01", months: 24 } as const;

export type Demo = { dataset: Cin7Dataset; source: Cin7Source };
let demo: Promise<Demo> | undefined;

// Imported lazily so the live path never loads the generator, the fixtures or sharp.
export function loadDemo(): Promise<Demo> {
	demo ??= Promise.all([
		import("../../fixtures/generate.js"),
		import("./fixtureSource.js"),
	]).then(([gen, fixture]) => {
		const dataset = gen.generateDataset({ ...DEMO_DATASET });
		return { dataset, source: fixture.createFixtureSource(dataset) };
	});
	return demo;
}

export type SourceHandle = { source: Cin7Source; apiCalls?: () => number };
export type SourceEnv = Pick<Env, "CIN7_SOURCE" | "CIN7_BASE_URL" | "ENCRYPTION_KEY">;
export type SourceOpts = { limiter?: RateLimiter; fetchImpl?: typeof fetch };

export const CIN7_CALLS_PER_MINUTE = 55;
// One limiter and one counter per process: the scheduler, manual runs and picture downloads all
// draw from the same 55/min budget even though each tick builds a fresh source.
let sharedLimiter: RateLimiter | undefined;
let callCount = 0;
const processLimiter = () =>
	(sharedLimiter ??= createRateLimiter({
		perMinute: CIN7_CALLS_PER_MINUTE,
		clock: () => Date.now(),
		sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
	}));

export function buildHttpSource(
	env: Pick<Env, "CIN7_BASE_URL">,
	creds: Cin7Credentials,
	opts: SourceOpts & { sleep?: (ms: number) => Promise<void>; countCalls?: boolean } = {}
): Cin7Source {
	return createHttpSource({
		baseUrl: env.CIN7_BASE_URL,
		...creds,
		limiter: opts.limiter ?? processLimiter(),
		...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
		...(opts.sleep ? { sleep: opts.sleep } : {}),
		...(opts.countCalls ? { onCall: () => void callCount++ } : {}),
	});
}

// null = not connected: the scheduler idles.
export async function getCin7Source(
	db: Db,
	env: SourceEnv,
	opts: SourceOpts = {}
): Promise<SourceHandle | null> {
	if (env.CIN7_SOURCE === "fixture") return { source: (await loadDemo()).source };
	const creds = await loadCredentials(db, parseKey(env.ENCRYPTION_KEY));
	if (!creds) return null;
	return {
		source: buildHttpSource(env, creds, { ...opts, countCalls: true }),
		apiCalls: () => callCount,
	};
}
