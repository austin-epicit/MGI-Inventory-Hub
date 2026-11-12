import { addDays, validTimeZone, zonedParts } from "./dates.js";
import { getCachedMe, runSync, type SyncDeps, type SyncRunSummary } from "./engine.js";

export type SchedulerOptions = {
	intervalMs: number;
	nightlyAt: string;
	timezone: string;
	// Runs after each nightly reconcile has released the lock (it may take the lock itself).
	onNightly?: (deps: SyncDeps) => Promise<void>;
};
export type LockResult<T> = { acquired: false } | { acquired: true; result: T };

export const SYNC_LOCK_KEY = 727001;
// Prisma rolls an interactive transaction back after its timeout, which would drop the lock early.
const LOCK_HOLD_MS = 24 * 3_600_000;
const FIRST_TICK_DELAY_MS = 5_000;
// A failed reconcile is retried at most this often, so it does not repeat every tick.
const RECONCILE_RETRY_MS = 3_600_000;

// Every sync run (tick, manual, webhook, seed) goes through here so two never overlap. The lock is
// transaction-scoped on a dedicated connection: a session lock taken through the pool could be
// "released" on a different connection and stay held. Ending the transaction always releases it.
export async function withSyncLock<T>(
	deps: Pick<SyncDeps, "db" | "clock">,
	fn: () => Promise<T>
): Promise<LockResult<T>> {
	const { db } = deps;
	return db.$transaction(
		async (tx): Promise<LockResult<T>> => {
			const [row] = await tx.$queryRaw<{ locked: boolean }[]>`
				SELECT pg_try_advisory_xact_lock(${SYNC_LOCK_KEY}::bigint)
				AS locked`;
			if (!row?.locked) return { acquired: false };
			// Lock held, so no run is live: any "running" row is a dead process's.
			await db.sync_run.updateMany({
				where: { status: "running" },
				data: {
					status: "failed",
					error_code: "INTERRUPTED",
					finished_at: deps.clock(),
				},
			});
			return { acquired: true, result: await fn() };
		},
		{ timeout: LOCK_HOLD_MS, maxWait: 10_000 }
	);
}

// The calendar day whose nightly slot `at` falls after; it changes at `nightlyAt` local time.
export function nightlyPeriod(at: Date, timeZone: string, nightlyAt: string): string {
	const { ymd, minutes } = zonedParts(at, timeZone);
	const [h = 0, m = 0] = nightlyAt.split(":").map(Number);
	return minutes >= h * 60 + m ? ymd : addDays(ymd, -1);
}

async function reconcileDue(deps: SyncDeps, opts: SchedulerOptions): Promise<boolean> {
	const { db } = deps;
	const tz =
		validTimeZone((await getCachedMe(db))?.timeZone) ??
		validTimeZone(opts.timezone) ??
		"UTC";
	const select = { started_at: true } as const;
	// Before any reconcile the first run stands in, so a fresh install waits for 02:00.
	const ref =
		(await db.sync_run.findFirst({
			where: { kind: "reconcile", status: "ok" },
			orderBy: { started_at: "desc" },
			select,
		})) ?? (await db.sync_run.findFirst({ orderBy: { started_at: "asc" }, select }));
	if (!ref) return false;
	const period = (at: Date) => nightlyPeriod(at, tz, opts.nightlyAt);
	if (period(deps.clock()) <= period(ref.started_at)) return false;
	const last = await db.sync_run.findFirst({
		where: { kind: "reconcile" },
		orderBy: { started_at: "desc" },
		select: { status: true, started_at: true },
	});
	const retryTooSoon =
		last !== null &&
		last.status !== "ok" &&
		deps.clock().getTime() - last.started_at.getTime() < RECONCILE_RETRY_MS;
	return !retryTooSoon;
}

export function createSyncTick(
	deps: SyncDeps,
	opts: SchedulerOptions
): () => Promise<LockResult<SyncRunSummary>> {
	return async () => {
		let nightly = false;
		const locked = await withSyncLock(deps, async () => {
			nightly = await reconcileDue(deps, opts);
			return runSync(deps, nightly ? "reconcile" : "incremental", {
				trigger: "schedule",
			});
		});
		// A failing hook must not mark the sync tick itself as failed.
		if (locked.acquired && nightly && opts.onNightly)
			await opts
				.onNightly(deps)
				.catch((err) => deps.log.error({ err }, "nightly hook failed"));
		return locked;
	};
}

// `deps` may be a resolver: it runs on every tick, and null (not connected) makes that tick idle.
export function startScheduler(
	deps: SyncDeps | (() => Promise<SyncDeps | null>),
	opts: SchedulerOptions,
	log: SyncDeps["log"] = (deps as SyncDeps).log
): { stop(): void } {
	// Tests drive runSync themselves; background ticks would race them for the database.
	if (process.env.NODE_ENV === "test") return { stop() {} };
	const resolve = typeof deps === "function" ? deps : async () => deps;
	let busy = false;
	const fire = () => {
		if (busy) return; // a backfill outlasts many intervals
		busy = true;
		const skipped = "sync tick skipped: another sync holds the lock";
		resolve()
			.then(async (d) => {
				if (!d) return; // not connected yet
				const r = await createSyncTick(d, opts)();
				if (!r.acquired) log.info(skipped);
			})
			.catch((err) => log.error({ err }, "sync tick failed"))
			.finally(() => {
				busy = false;
			});
	};
	const first = setTimeout(fire, FIRST_TICK_DELAY_MS);
	const timer = setInterval(fire, opts.intervalMs);
	first.unref();
	timer.unref();
	log.info({ intervalMs: opts.intervalMs }, "sync scheduler started");
	return {
		stop() {
			clearTimeout(first);
			clearInterval(timer);
		},
	};
}
