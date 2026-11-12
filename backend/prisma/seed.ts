import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Logger } from "pino";
import { Rng } from "../fixtures/rng.js";
import { DEMO_DATASET, loadDemo } from "../src/cin7/sourceFactory.js";
import { createDb, type Db } from "../src/db.js";
import { processPendingImages } from "../src/images/store.js";
import { log } from "../src/log.js";
import { runSync, type SyncRunSummary } from "../src/sync/engine.js";
import { addDays, resolveToday, ymdToDbDate } from "../src/sync/dates.js";
import { dec4 } from "../src/sync/money.js";
import { currentStockValue } from "../src/sync/snapshots.js";
import { withSyncLock } from "../src/sync/scheduler.js";

// The demo window is fixed in time, so the backfill reaches past BACKFILL_MONTHS to its start.
function monthsToCover(now: Date): number {
	const asOf = new Date(`${DEMO_DATASET.asOf}T00:00:00.000Z`);
	const elapsed =
		(now.getUTCFullYear() - asOf.getUTCFullYear()) * 12 +
		now.getUTCMonth() -
		asOf.getUTCMonth();
	return DEMO_DATASET.months + Math.max(0, elapsed) + 1;
}

// Dev only: mirrors the demo dataset through the real sync engine, then backdates monthly price
// history, which Cin7 cannot supply (a live mirror accrues it from its first sync).
export async function seedDemo(
	db: Db,
	opts: { clock?: () => Date; log?: Logger; uploadsDir?: string } = {}
): Promise<{ run: SyncRunSummary; seedSnapshots: number }> {
	const clock = opts.clock ?? (() => new Date());
	const { dataset, source } = await loadDemo();
	const deps = { db, source, clock, log: opts.log ?? log };
	const { uploadsDir } = opts;
	const run = await runSync(
		{
			...deps,
			backfillMonths: monthsToCover(clock()),
			// Without a folder (tests) the pictures stay pending.
			...(uploadsDir
				? {
						onImages: () =>
							processPendingImages(
								{
									...deps,
									uploadsDir,
								},
								undefined,
								{ maxPerRun: 100_000 }
							).then(() => {}),
					}
				: {}),
		},
		"backfill",
		{ trigger: "seed" }
	);
	if (run.status !== "ok") throw new Error(`demo backfill ended ${run.status}`);

	// One snapshot per change, as the live sync records them.
	const rows = dataset.seedHistory.flatMap((h) => {
		let prev = "";
		return h.points.flatMap((pt) => {
			const average_cost = dec4(pt.averageCost);
			const tier_prices = pt.tierPrices.map(dec4);
			const key = [average_cost, ...tier_prices].join("|");
			if (key === prev) return [];
			prev = key;
			return [
				{
					product_id: h.productId,
					// Noon UTC on the 1st: the same month in every zone.
					observed_at: new Date(`${pt.month}-01T12:00:00.000Z`),
					average_cost,
					tier_prices,
					source: "seed" as const,
				},
			];
		});
	});
	await db.$transaction([
		db.product_price_snapshot.deleteMany({ where: { source: "seed" } }),
		db.product_price_snapshot.createMany({ data: rows }),
	]);
	await seedStockValueHistory(db, clock);
	return { run, seedSnapshots: rows.length };
}

export const STOCK_HISTORY_DAYS = 180;

// Walks back from today's value, ±2% a day, so the demo chart has a believable past to show.
async function seedStockValueHistory(db: Db, clock: () => Date): Promise<void> {
	const today = await resolveToday({ db, clock });
	const now = clock();
	const rng = new Rng(DEMO_DATASET.seed + 1);
	let { value, units } = await currentStockValue(db);
	const rows = Array.from({ length: STOCK_HISTORY_DAYS }, (_, i) => {
		value *= 1 + rng.float(-0.02, 0.02);
		units *= 1 + rng.float(-0.02, 0.02);
		return {
			day: ymdToDbDate(addDays(today, -(i + 1))),
			value: dec4(value),
			units: dec4(units),
			source: "seed" as const,
			recorded_at: now,
		};
	});
	await db.$transaction([
		db.stock_value_snapshot.deleteMany({ where: { source: "seed" } }),
		// A live sync row on one of these days wins over the invented one.
		db.stock_value_snapshot.createMany({ data: rows, skipDuplicates: true }),
	]);
}

const TABLES = [
	"price_tier",
	"location",
	"supplier",
	"customer",
	"product",
	"product_image",
	"product_price_snapshot",
	"stock_value_snapshot",
	"purchase",
	"purchase_line",
	"sale",
	"sale_line",
	"stock_level",
	"sync_cursor",
	"sync_run",
] as const;

async function main(): Promise<void> {
	await import("dotenv/config");
	if (process.env.NODE_ENV === "production")
		throw new Error(
			"prisma/seed.ts is dev-only; refusing to run with NODE_ENV=production"
		);
	if (process.env.CIN7_SOURCE === "http")
		throw new Error(
			"CIN7_SOURCE=http: refusing to mix demo data into a live Cin7 mirror"
		);
	const url = process.env.DATABASE_URL;
	if (!url) throw new Error("DATABASE_URL is not set");
	const db = createDb(url);
	try {
		const locked = await withSyncLock({ db, clock: () => new Date() }, () =>
			seedDemo(db, {
				uploadsDir: path.resolve(
					process.cwd(),
					process.env.UPLOADS_DIR ?? "./uploads"
				),
			})
		);
		if (!locked.acquired)
			throw new Error("a sync is running (the dev server?); try again");
		const { run, seedSnapshots } = locked.result;
		const { dataset: ds } = await loadDemo();
		const lines = (orders: { Order?: { Lines: unknown[] } | null }[]) =>
			orders.reduce((n, o) => n + (o.Order?.Lines.length ?? 0), 0);
		const expected: Partial<Record<(typeof TABLES)[number], number>> = {
			price_tier: ds.priceTiers.length,
			location: ds.locations.length,
			supplier: ds.suppliers.length,
			customer: ds.customers.length,
			product: ds.products.length,
			product_image: ds.products.reduce(
				(n, p) => n + (p.Attachments?.length ?? 0),
				0
			),
			product_price_snapshot: seedSnapshots + ds.products.length,
			purchase: ds.purchases.length,
			purchase_line: lines(ds.purchases),
			sale: ds.sales.length,
			sale_line: lines(ds.sales),
			stock_level: ds.availability.length,
		};
		const counts = [];
		for (const table of TABLES) {
			const [{ n }] = await db.$queryRawUnsafe<{ n: bigint }[]>(
				`SELECT count(*) AS n FROM "${table}"`
			);
			counts.push({ table, rows: Number(n), dataset: expected[table] ?? "" });
		}
		console.log(`Demo backfill run ${run.runId}: ${run.status}`);
		console.table(counts);
	} finally {
		await db.$disconnect();
	}
}

// Runs only as a script (npm run seed / prisma db seed), not when a test imports seedDemo.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	main().catch((err) => {
		console.error(err);
		process.exitCode = 1;
	});
}
