import type { Db } from "../db.js";
import { QUARANTINE_AFTER } from "./cursors.js";
import { getWebhookState } from "../webhooks/register.js";
import { validTimeZone } from "./dates.js";
import { getSetting } from "../settings/appSettings.js";
import { getCachedMe } from "./engine.js";
import { MIRROR_CLEARED_KEY } from "./reset.js";

const ENTITIES = ["suppliers", "customers", "products", "purchases", "sales"] as const;
const QUARANTINE_LIST_MAX = 20;

export type SyncStatus = {
	source: "fixture" | "http";
	connected: boolean;
	running: boolean;
	lastSuccessAt: string | null;
	lastRun: {
		kind: string;
		status: "ok" | "partial" | "failed";
		errorCode: string | null;
		errorMessage: string | null;
		finishedAt: string | null;
	} | null;
	perEntity: { entity: string; lastSuccessAt: string | null; backfillDone: boolean }[];
	backfill: { done: boolean; progressPct: number };
	quarantined: {
		count: number;
		items: {
			entity: string;
			recordId: string;
			attempts: number;
			lastCode: string;
			lastMessage: string;
			lastFailedAt: string;
		}[];
	};
	// Cached from Cin7 GET /me; every signed-in user needs them to format money and dates.
	baseCurrency: string | null;
	// The zone every page formats in: Cin7's when Intl knows it, else the app's.
	timeZone: string;
	// Cin7 webhooks (Advanced Automations add-on); all-empty until an admin registers them.
	webhooks: {
		registered: boolean;
		inactiveTypes: string[];
		reactivatedTypes: string[];
		lastCheckAt: string | null;
		lastEventAt: string | null;
	};
};

const iso = (d: Date | null) => d?.toISOString() ?? null;

export async function getSyncStatus(
	db: Db,
	ctx: { source: "fixture" | "http"; connected: boolean; timeZone?: string }
): Promise<SyncStatus> {
	const clearedAt = await getSetting<string>(db, MIRROR_CLEARED_KEY);
	const [running, lastOk, lastRun, cursors, quarantine, me, hooks, lastEvent] =
		await Promise.all([
			db.sync_run.findFirst({
				where: { status: "running" },
				select: { id: true },
			}),
			db.sync_run.findFirst({
				where: {
					status: "ok",
					...(clearedAt
						? { started_at: { gte: new Date(clearedAt) } }
						: {}),
				},
				orderBy: { started_at: "desc" },
				select: { finished_at: true },
			}),
			db.sync_run.findFirst({
				where: {
					status: { not: "running" },
					...(clearedAt
						? { started_at: { gte: new Date(clearedAt) } }
						: {}),
				},
				orderBy: { started_at: "desc" },
			}),
			db.sync_cursor.findMany(),
			db.sync_record_failure.findMany({
				where: { attempts: { gte: QUARANTINE_AFTER } },
				orderBy: { last_failed_at: "desc" },
			}),
			getCachedMe(db),
			getWebhookState(db),
			db.webhook_event.findFirst({
				orderBy: { received_at: "desc" },
				select: { received_at: true },
			}),
		]);
	const byEntity = new Map(cursors.map((c) => [c.entity, c]));
	const perEntity = ENTITIES.map((entity) => ({
		entity,
		lastSuccessAt: iso(byEntity.get(entity)?.last_success_at ?? null),
		backfillDone: byEntity.get(entity)?.backfill_done ?? false,
	}));
	const doneCount = perEntity.filter((e) => e.backfillDone).length;
	const firstError = Array.isArray(lastRun?.errors)
		? (lastRun.errors[0] as { message?: string } | undefined)
		: undefined;
	return {
		source: ctx.source,
		connected: ctx.connected,
		running: running !== null,
		lastSuccessAt: iso(lastOk?.finished_at ?? null),
		lastRun: lastRun
			? {
					kind: lastRun.kind,
					status: lastRun.status as "ok" | "partial" | "failed",
					errorCode: lastRun.error_code,
					errorMessage: firstError?.message ?? null,
					finishedAt: iso(lastRun.finished_at),
				}
			: null,
		perEntity,
		backfill: {
			done: doneCount === ENTITIES.length,
			progressPct: Math.round((doneCount / ENTITIES.length) * 100),
		},
		quarantined: {
			count: quarantine.length,
			items: quarantine.slice(0, QUARANTINE_LIST_MAX).map((q) => ({
				entity: q.entity,
				recordId: q.record_id,
				attempts: q.attempts,
				lastCode: q.last_code,
				lastMessage: q.last_message,
				lastFailedAt: q.last_failed_at.toISOString(),
			})),
		},
		baseCurrency: me?.currency ?? null,
		timeZone: validTimeZone(me?.timeZone) ?? validTimeZone(ctx.timeZone) ?? "UTC",
		webhooks: {
			registered: hooks !== null,
			inactiveTypes:
				hooks?.types.filter((t) => !t.active).map((t) => t.type) ?? [],
			reactivatedTypes: hooks?.reactivatedTypes ?? [],
			lastCheckAt: hooks?.lastCheckAt ?? null,
			lastEventAt: iso(lastEvent?.received_at ?? null),
		},
	};
}
