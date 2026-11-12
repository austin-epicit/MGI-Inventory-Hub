import type { Logger } from "pino";
import type { SourceHandle } from "../cin7/sourceFactory.js";
import type { Db } from "../db.js";
import { processPendingImages } from "../images/store.js";
import type { SyncDeps } from "./engine.js";

export type SyncRuntime = {
	db: Db;
	clock: () => Date;
	log: Logger;
	uploadsDir: string;
	backfillMonths: number;
	timeZone?: string;
	resolveSource: () => Promise<SourceHandle | null>;
};

// Resolved on every use so credentials saved in the UI take effect without a restart.
export async function resolveSyncDeps(rt: SyncRuntime): Promise<SyncDeps | null> {
	const handle = await rt.resolveSource();
	if (!handle) return null;
	const deps: SyncDeps = {
		db: rt.db,
		source: handle.source,
		clock: rt.clock,
		log: rt.log,
		backfillMonths: rt.backfillMonths,
		...(rt.timeZone ? { timeZone: rt.timeZone } : {}),
		...(handle.apiCalls ? { apiCalls: handle.apiCalls } : {}),
	};
	// No ids: also retries failed pictures that are still under the attempt cap.
	return {
		...deps,
		onImages: () =>
			processPendingImages({ ...deps, uploadsDir: rt.uploadsDir }).then(() => {}),
	};
}
