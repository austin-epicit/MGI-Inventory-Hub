import type { Db } from "../db.js";
import { STATE_KEY as WEBHOOK_STATE_KEY } from "../webhooks/register.js";
import { WALK_KEY_PREFIX } from "./cursors.js";
import { CIN7_ME_KEY } from "./engine.js";

// Runs that started before this belong to the replaced account; the header ignores them.
export const MIRROR_CLEARED_KEY = "sync.mirror_cleared_at";

export async function mirrorIsEmpty(db: Db): Promise<boolean> {
	const counts = await Promise.all([
		db.product.count(),
		db.sale.count(),
		db.purchase.count(),
		db.stock_level.count(),
	]);
	return counts.every((n) => n === 0);
}

// Everything derived from one Cin7 account, so a different account starts from a clean slate.
// sync_run stays (it is the audit log); uploaded picture files are left on disk (their IDs are
// Cin7's, so they can never be served for the new account's rows).
export async function clearMirror(db: Db, now: Date): Promise<void> {
	await db.$transaction([
		db.alert_dismissal.deleteMany(), // keys embed Cin7 product ids; thresholds in app_setting stay
		db.product_condition.deleteMany(), // hub-only data, wiped with the account it described
		db.sale_credit_note.deleteMany(), // lines cascade; no FK to sale, so it is not swept by sale
		db.sale_line.deleteMany(),
		db.sale.deleteMany(),
		db.purchase_line.deleteMany(),
		db.purchase.deleteMany(),
		db.stock_level.deleteMany(),
		db.product_price_snapshot.deleteMany(),
		db.product_image.deleteMany(),
		db.product.deleteMany(),
		db.price_tier.deleteMany(),
		db.location.deleteMany(),
		db.supplier.deleteMany(),
		db.customer.deleteMany(),
		db.sync_record_failure.deleteMany(),
		db.sync_cursor.deleteMany(),
		db.webhook_event.deleteMany(),
		db.app_setting.deleteMany({
			where: {
				OR: [
					{ key: { in: [CIN7_ME_KEY, WEBHOOK_STATE_KEY] } },
					{ key: { startsWith: WALK_KEY_PREFIX } },
				],
			},
		}),
		// Same transaction, so a wipe and its marker commit or fail together.
		db.app_setting.upsert({
			where: { key: MIRROR_CLEARED_KEY },
			create: { key: MIRROR_CLEARED_KEY, value: now.toISOString() },
			update: { value: now.toISOString() },
		}),
	]);
}
