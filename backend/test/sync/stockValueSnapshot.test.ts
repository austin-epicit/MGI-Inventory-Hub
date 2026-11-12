import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { seedDemo } from "../../prisma/seed.js";
import type { Cin7Dataset } from "../../fixtures/generate.js";
import { createFixtureSource } from "../../src/cin7/fixtureSource.js";
import { Cin7ParseError, type Cin7Source } from "../../src/cin7/source.js";
import { log } from "../../src/log.js";
import { getOverview } from "../../src/overview/queries.js";
import { runSync, type SyncDeps } from "../../src/sync/engine.js";
import { demoDataset } from "../helpers/dataset.js";
import { resetDb, testDb } from "../helpers/db.js";

const HOUR = 3_600_000;
// 12:00 UTC is 04:00 in Los Angeles (the fixture's Cin7 zone): the same calendar day.
const T0 = new Date("2026-11-20T12:00:00.000Z");
const TODAY = "2026-11-20";
const at = (ms: number) => new Date(T0.getTime() + ms);
const day = (d: Date) => d.toISOString().slice(0, 10);

const deps = (source: Cin7Source, over: Partial<SyncDeps> = {}): SyncDeps => ({
	db: testDb,
	source,
	clock: () => T0,
	log,
	...over,
});

// Stock and reference data in full; only a few orders, so a sync stays quick.
function stockDataset(): Cin7Dataset {
	const ds = structuredClone(demoDataset());
	ds.saleList = ds.saleList.slice(0, 5);
	ds.sales = ds.sales.filter((s) => ds.saleList.some((l) => l.SaleID === s.ID));
	ds.purchaseList = ds.purchaseList.slice(0, 5);
	ds.purchases = ds.purchases.filter((p) => ds.purchaseList.some((l) => l.ID === p.ID));
	return ds;
}

const overviewStock = async () =>
	(await getOverview(testDb, { from: null, to: TODAY })).kpis.stockValue;

beforeEach(resetDb);
afterAll(() => testDb.$disconnect());

describe("stock value snapshots", () => {
	it("a full sync writes one row for today with the Overview stock value", async () => {
		const r = await runSync(deps(createFixtureSource(stockDataset())), "backfill");
		expect(r.status).toBe("ok");
		const rows = await testDb.stock_value_snapshot.findMany();
		expect(rows).toHaveLength(1);
		const value = await overviewStock();
		expect(value).toBeGreaterThan(0);
		expect(day(rows[0]!.day)).toBe(TODAY);
		expect(Number(rows[0]!.value)).toBe(value);
		expect(rows[0]).toMatchObject({ source: "sync", recorded_at: T0 });
	});

	it("a second sync the same day with different stock overwrites the row", async () => {
		const ds = stockDataset();
		await runSync(deps(createFixtureSource(ds)), "backfill");
		const first = await overviewStock();

		const changed = structuredClone(ds);
		changed.availability[0]!.OnHand += 1000;
		await runSync(
			deps(createFixtureSource(changed), { clock: () => at(HOUR) }),
			"incremental"
		);
		const rows = await testDb.stock_value_snapshot.findMany();
		expect(rows).toHaveLength(1);
		const second = await overviewStock();
		expect(second).not.toBe(first);
		expect(Number(rows[0]!.value)).toBe(second);
		expect(rows[0]!.recorded_at).toEqual(at(HOUR));
	});

	it("an incomplete stock read writes no row and leaves today's row alone", async () => {
		const ds = stockDataset();
		const fresh = createFixtureSource(ds);
		const unreadable: Cin7Source = {
			...fresh,
			availability: async (q) => {
				if (q.page === 2) throw new Cin7ParseError("not JSON", "<html>");
				return fresh.availability(q);
			},
		};
		const r1 = await runSync(deps(unreadable, { pageSize: 100 }), "backfill");
		expect(r1.status).toBe("partial");
		expect(await testDb.stock_value_snapshot.count()).toBe(0);

		await runSync(
			deps(createFixtureSource(ds), { clock: () => at(HOUR) }),
			"incremental"
		);
		const before = await testDb.stock_value_snapshot.findMany();
		expect(before).toHaveLength(1);
		await runSync(
			deps(unreadable, { pageSize: 100, clock: () => at(2 * HOUR) }),
			"incremental"
		);
		expect(await testDb.stock_value_snapshot.findMany()).toEqual(before);
	});

	it("seedDemo writes 180 seed rows ending yesterday; a reseed leaves 180, not 360", async () => {
		await seedDemo(testDb, { clock: () => T0, log });
		const where = { source: "seed" as const };
		const seeded = await testDb.stock_value_snapshot.findMany({
			where,
			orderBy: { day: "asc" },
		});
		expect(seeded).toHaveLength(180);
		expect(day(seeded[179]!.day)).toBe("2026-11-19");
		expect(day(seeded[0]!.day)).toBe("2026-05-24");
		// The real sync wrote today.
		expect(await testDb.stock_value_snapshot.count({ where: { source: "sync" } })).toBe(
			1
		);

		// Each day is within ±2% of the next one.
		for (let i = 1; i < seeded.length; i++) {
			const ratio = Number(seeded[i - 1]!.value) / Number(seeded[i]!.value);
			expect(Math.abs(ratio - 1)).toBeLessThanOrEqual(0.0205);
		}

		await seedDemo(testDb, { clock: () => at(HOUR), log });
		const again = await testDb.stock_value_snapshot.findMany({
			where,
			orderBy: { day: "asc" },
		});
		expect(again).toHaveLength(180);
		expect(again.map((r) => [day(r.day), r.value.toString()])).toEqual(
			seeded.map((r) => [day(r.day), r.value.toString()])
		);
	});
});
