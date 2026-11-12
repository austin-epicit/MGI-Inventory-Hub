import type { Db } from "../db.js";
import { getSetting, setSetting } from "../settings/appSettings.js";

export type CursorEntity = "suppliers" | "customers" | "products" | "purchases" | "sales";

export type Cursor = { lastSuccessAt: Date | null; backfillPage: number; backfillDone: boolean };

// Incremental reads reach this far behind the cursor: it absorbs clock skew between us and Cin7,
// and reading a record twice is harmless because every write is an upsert.
export const OVERLAP_MS = 10 * 60_000;

export async function getCursor(db: Db, entity: CursorEntity): Promise<Cursor> {
	const row = await db.sync_cursor.findUnique({ where: { entity } });
	return {
		lastSuccessAt: row?.last_success_at ?? null,
		backfillPage: row?.backfill_page ?? 0,
		backfillDone: row?.backfill_done ?? false,
	};
}

export async function saveBackfillPage(db: Db, entity: CursorEntity, page: number): Promise<void> {
	await db.sync_cursor.upsert({
		where: { entity },
		create: { entity, backfill_page: page },
		update: { backfill_page: page },
	});
}

// Marks the entity complete up to `at`. Never moves the cursor back; an older time only re-reads.
export async function completeCursor(db: Db, entity: CursorEntity, at: Date): Promise<void> {
	const prev = (await getCursor(db, entity)).lastSuccessAt;
	const data = {
		last_success_at: prev && prev > at ? prev : at,
		backfill_page: 0,
		backfill_done: true,
	};
	await db.sync_cursor.upsert({
		where: { entity },
		create: { entity, ...data },
		update: data,
	});
}

// From this many failed attempts a record is quarantined: it is still retried whenever it
// reappears in a list window, but it no longer holds back its entity's cursor or backfill.
export const QUARANTINE_AFTER = 3;

export const failureKey = (entity: string, id: string) => `${entity}:${id}`;

// Attempts per failing record, keyed by failureKey.
export async function loadRecordFailures(db: Db): Promise<Map<string, number>> {
	const rows = await db.sync_record_failure.findMany({
		select: { entity: true, record_id: true, attempts: true },
	});
	return new Map(rows.map((r) => [failureKey(r.entity, r.record_id), r.attempts]));
}

// Returns the attempts so far, this one included.
export async function noteRecordFailure(
	db: Db,
	f: { entity: string; id: string; code: string; message: string; at: Date }
): Promise<number> {
	const last = { last_code: f.code, last_message: f.message, last_failed_at: f.at };
	const row = await db.sync_record_failure.upsert({
		where: { entity_record_id: { entity: f.entity, record_id: f.id } },
		create: {
			entity: f.entity,
			record_id: f.id,
			attempts: 1,
			first_failed_at: f.at,
			...last,
		},
		update: { attempts: { increment: 1 }, ...last },
		select: { attempts: true },
	});
	return row.attempts;
}

export async function clearRecordFailure(db: Db, entity: string, id: string): Promise<void> {
	await db.sync_record_failure.deleteMany({ where: { entity, record_id: id } });
}

export const WALK_KEY_PREFIX = "sync.backfill_started_at.";
const walkKey = (entity: CursorEntity) => `${WALK_KEY_PREFIX}${entity}`;

// When page 1 of a backfill walk was read. A walk finished by a later run re-read only the later
// pages, so its cursor must date from here or edits made meanwhile to earlier pages are missed.
export async function markWalkStart(db: Db, entity: CursorEntity, at: Date): Promise<void> {
	await setSetting(db, walkKey(entity), at.toISOString());
}

export async function takeWalkStart(db: Db, entity: CursorEntity): Promise<Date | null> {
	const iso = await getSetting<string>(db, walkKey(entity));
	if (iso === null) return null;
	await db.app_setting.delete({ where: { key: walkKey(entity) } });
	return new Date(iso);
}
