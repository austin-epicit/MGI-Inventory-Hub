import { describe, expect, it } from "vitest";
import type { PriceHistory, SoldBucket } from "../../types/priceHistory";
import {
	assignTierSlots,
	canShow,
	defaultVisible,
	hasActivity,
	listKey,
	niceDomain,
	soldKey,
	tiersOf,
	toChartRows,
	tsToYmd,
	ymdToTs,
	type SeriesKey,
} from "./costPriceSeries";

const history = (over: Partial<PriceHistory> = {}): PriceHistory => ({
	range: { from: "2026-01-01", to: "2026-03-31" },
	bucket: "week",
	purchaseCost: [],
	averageCost: [],
	listPrices: [],
	soldPrices: [],
	listTrackingStartedAt: null,
	stats: {
		lastPurchaseCost: null,
		purchaseCostChangePct: null,
		averageCost: null,
		avgSoldPrice: null,
		marginPct: null,
	},
	...over,
});

const bucket = (start: string, avg: number, units = 1, min = avg, max = avg): SoldBucket => ({
	start,
	avg,
	min,
	max,
	units,
});

const po = (date: string, unitCost: number, n = 1) => ({
	date,
	unitCost,
	qty: 2,
	purchaseId: `po-${n}`,
	orderNumber: `PO-${n}`,
	supplier: "Acme",
});

const keys = (s: Set<SeriesKey>) => [...s].sort();
const rowAt = (rows: ReturnType<typeof toChartRows>, date: string) =>
	rows.filter((r) => r.date === date);

describe("tiersOf", () => {
	it("pairs a tier's list and sold series by name; sold-only tiers and No tier come last", () => {
		const h = history({
			listPrices: [
				{
					code: 2,
					name: "Wholesale",
					points: [{ date: "2026-01-01", value: 80 }],
				},
				{
					code: 1,
					name: "Retail",
					points: [{ date: "2026-01-01", value: 100 }],
				},
			],
			soldPrices: [
				{ tierName: "Retail", buckets: [bucket("2026-01-05", 99, 3)] },
				{ tierName: "No tier", buckets: [bucket("2026-01-05", 90, 1)] },
				{ tierName: "Export", buckets: [bucket("2026-01-05", 70, 2)] },
			],
		});
		expect(
			tiersOf(h).map((t) => [t.name, t.code, t.listKey, t.soldKey, t.units])
		).toEqual([
			["Retail", 1, "list:1", "sold:Retail", 3],
			["Wholesale", 2, "list:2", null, 0],
			["Export", null, null, "sold:Export", 2],
			["No tier", null, null, "sold:No tier", 1],
		]);
	});
});

describe("defaultVisible", () => {
	it("picks the list + sold pair of the 4 best-selling tiers out of 5, plus both cost series", () => {
		const names = ["A", "B", "C", "D", "E"];
		const units = [5, 1, 9, 7, 3]; // B sells least
		const h = history({
			listPrices: names.map((name, i) => ({
				code: i + 1,
				name,
				points: [{ date: "2026-01-01", value: 100 + i }],
			})),
			soldPrices: names.map((name, i) => ({
				tierName: name,
				buckets: [bucket("2026-01-05", 90 + i, units[i])],
			})),
		});
		expect(keys(defaultVisible(h))).toEqual(
			[
				"purchaseCost",
				"averageCost",
				"list:1",
				"sold:A",
				"list:3",
				"sold:C",
				"list:4",
				"sold:D",
				"list:5",
				"sold:E",
			].sort()
		);
	});

	it("without sales, tiers fill the 4 slots in tier order", () => {
		const h = history({
			listPrices: [1, 2, 3, 4, 5].map((code) => ({
				code,
				name: `T${code}`,
				points: [{ date: "2026-01-01", value: code * 10 }],
			})),
		});
		expect(keys(defaultVisible(h))).toEqual(
			[
				"purchaseCost",
				"averageCost",
				"list:1",
				"list:2",
				"list:3",
				"list:4",
			].sort()
		);
	});

	it("a product with every tier at 0 shows the cost series only", () => {
		const h = history({ averageCost: [{ date: "2026-01-01", value: 50 }] });
		expect(keys(defaultVisible(h))).toEqual(["averageCost", "purchaseCost"]);
	});
});

describe("canShow / assignTierSlots", () => {
	const h = history({
		listPrices: [1, 2, 3, 4, 5].map((code) => ({
			code,
			name: `T${code}`,
			points: [{ date: "2026-01-01", value: code * 10 }],
		})),
	});
	const tiers = tiersOf(h);

	it("refuses a fifth tier while four are shown; a series of a shown tier is always allowed", () => {
		const visible = defaultVisible(h);
		expect(canShow(tiers, visible, listKey(5))).toBe(false);
		expect(canShow(tiers, visible, "purchaseCost")).toBe(true);
		const fewer = new Set(visible);
		fewer.delete(listKey(2));
		expect(canShow(tiers, fewer, listKey(5))).toBe(true);
	});

	it("keeps survivors' hues when a tier is hidden; a newly shown tier takes the lowest free slot", () => {
		const visible = defaultVisible(h);
		const first = assignTierSlots(tiers, visible, new Map());
		expect([...first]).toEqual([
			["T1", 1],
			["T2", 2],
			["T3", 3],
			["T4", 4],
		]);
		const without2 = new Set(visible);
		without2.delete(listKey(2));
		const second = assignTierSlots(tiers, without2, first);
		expect([...second]).toEqual([
			["T1", 1],
			["T3", 3],
			["T4", 4],
		]);
		const with5 = new Set(without2).add(listKey(5));
		expect(assignTierSlots(tiers, with5, second).get("T5")).toBe(2);
	});
});

describe("calendar dates", () => {
	it("round-trips a YYYY-MM-DD through the numeric axis without a zone shift", () => {
		// Tests run in America/Los_Angeles: a local-midnight parse would come back as Feb 28.
		expect(tsToYmd(ymdToTs("2026-03-01"))).toBe("2026-03-01");
		expect(tsToYmd(ymdToTs("2026-03-01") + 20 * 3600_000)).toBe("2026-03-01");
	});
});

describe("toChartRows", () => {
	it("spans the range and carries step series to its end", () => {
		const h = history({
			averageCost: [
				{ date: "2026-01-01", value: 50 },
				{ date: "2026-02-10", value: 55 },
			],
			listPrices: [
				{
					code: 1,
					name: "Retail",
					points: [{ date: "2026-01-01", value: 99 }],
				},
			],
		});
		const rows = toChartRows(h, new Set<SeriesKey>(["averageCost", "list:1"]));
		expect(rows[0]!.date).toBe("2026-01-01");
		expect(rows[rows.length - 1]!.date).toBe("2026-03-31");
		expect(rows[rows.length - 1]!.values).toMatchObject({
			averageCost: 55,
			"list:1": 99,
		});
		expect(rowAt(rows, "2026-02-10")[0]!.values.averageCost).toBe(55);
	});

	it("set → unset → set: the list step closes at the unset day, then a gap, then a new segment", () => {
		const h = history({
			listPrices: [
				{
					code: 1,
					name: "Retail",
					points: [
						{ date: "2026-01-01", value: 100 },
						{ date: "2026-02-01", value: null },
						{ date: "2026-03-01", value: 120 },
					],
				},
			],
			averageCost: [{ date: "2026-02-15", value: 50 }],
		});
		const rows = toChartRows(h, new Set<SeriesKey>(["list:1", "averageCost"]));
		const at = (d: string) => rowAt(rows, d)[0]!;
		// The unset day ends the step at the old price (so it is drawn up to there), then a
		// null row on the same day breaks the line...
		expect(rowAt(rows, "2026-02-01").map((r) => r.values["list:1"])).toEqual([
			100,
			null,
		]);
		expect(at("2026-02-01").unset["list:1"]).toBe(true);
		// ...and nothing is plotted while unset.
		expect(at("2026-02-15").values["list:1"]).toBeNull();
		expect(at("2026-03-01").values["list:1"]).toBe(120);
		expect(at("2026-03-01").unset["list:1"]).toBeUndefined();
		expect(at("2026-03-31").values["list:1"]).toBe(120);
	});

	it("set → unset: the line ends at the unset day instead of running to the range end", () => {
		const h = history({
			listPrices: [
				{
					code: 1,
					name: "Retail",
					points: [
						{ date: "2026-01-01", value: 100 },
						{ date: "2026-02-01", value: null },
					],
				},
			],
		});
		const rows = toChartRows(h, new Set<SeriesKey>(["list:1"]));
		expect(rowAt(rows, "2026-02-01")[0]!.values["list:1"]).toBe(100);
		expect(rows[rows.length - 1]!.date).toBe("2026-03-31");
		expect(rows[rows.length - 1]!.values["list:1"]).toBeNull();
	});

	it("leaves hidden series out of the rows", () => {
		const h = history({
			averageCost: [{ date: "2026-01-01", value: 50 }],
			purchaseCost: [po("2026-01-20", 48)],
		});
		const rows = toChartRows(h, new Set<SeriesKey>(["averageCost"]));
		expect(rows.every((r) => r.purchaseCost === null)).toBe(true);
		expect(rows.some((r) => r.date === "2026-01-20")).toBe(false);
	});

	it("one dot per distinct cost on a day; the tooltip list holds every order of that day", () => {
		const h = history({
			purchaseCost: [
				po("2026-01-20", 48, 1),
				po("2026-01-20", 48, 2),
				po("2026-01-20", 51, 3),
			],
		});
		const rows = rowAt(
			toChartRows(h, new Set<SeriesKey>(["purchaseCost"])),
			"2026-01-20"
		);
		expect(rows.map((r) => r.purchaseCost)).toEqual([48, 51]);
		expect(rows[0]!.purchases.map((p) => p.orderNumber)).toEqual([
			"PO-1",
			"PO-2",
			"PO-3",
		]);
	});

	it("sold price: straight between adjacent buckets, a gap where a bucket is missing", () => {
		const h = history({
			purchaseCost: [po("2026-01-08", 40)], // a row between two adjacent weeks
			soldPrices: [
				{
					tierName: "Retail",
					buckets: [
						bucket("2026-01-05", 100),
						bucket("2026-01-12", 114),
						bucket("2026-01-26", 120), // week of Jan 19 had no sales
					],
				},
			],
		});
		const rows = toChartRows(h, new Set<SeriesKey>(["purchaseCost", "sold:Retail"]));
		const k = soldKey("Retail");
		expect(rowAt(rows, "2026-01-05")[0]!.values[k]).toBe(100);
		// Jan 8 is 3/7 of the way from Jan 5 to Jan 12: on the straight segment, not a real point.
		expect(rowAt(rows, "2026-01-08")[0]!.values[k]).toBeCloseTo(106, 6);
		expect(rowAt(rows, "2026-01-08")[0]!.buckets[k]).toBeUndefined();
		expect(rowAt(rows, "2026-01-12")[0]!.buckets[k]?.avg).toBe(114);
		expect(rowAt(rows, "2026-01-19")[0]!.values[k]).toBeNull();
		expect(rowAt(rows, "2026-01-26")[0]!.values[k]).toBe(120);
	});

	it("a bucket starting before the range is plotted at the range start", () => {
		const h = history({
			range: { from: "2026-01-07", to: "2026-02-05" },
			soldPrices: [{ tierName: "Retail", buckets: [bucket("2026-01-05", 100)] }],
		});
		const rows = toChartRows(h, new Set<SeriesKey>(["sold:Retail"]));
		expect(rows[0]!.date).toBe("2026-01-07");
		expect(rows[0]!.values["sold:Retail"]).toBe(100);
	});

	it("low–high band only while exactly one sold series is visible", () => {
		const h = history({
			soldPrices: [
				{
					tierName: "Retail",
					buckets: [bucket("2026-01-05", 100, 2, 90, 110)],
				},
				{
					tierName: "Trade",
					buckets: [bucket("2026-01-05", 80, 2, 70, 85)],
				},
			],
		});
		const one = toChartRows(h, new Set<SeriesKey>(["sold:Retail"]));
		expect(rowAt(one, "2026-01-05")[0]!.band).toEqual([90, 110]);
		const two = toChartRows(h, new Set<SeriesKey>(["sold:Retail", "sold:Trade"]));
		expect(two.every((r) => r.band === null)).toBe(true);
	});

	it("margin is sold price minus the average cost in effect at the bucket", () => {
		const h = history({
			averageCost: [
				{ date: "2026-01-01", value: 60 },
				{ date: "2026-01-10", value: 70 },
			],
			soldPrices: [
				{
					tierName: "Retail",
					buckets: [
						bucket("2026-01-05", 100),
						bucket("2026-01-12", 65),
					],
				},
			],
		});
		// Average cost hidden: margin still uses it.
		const rows = toChartRows(h, new Set<SeriesKey>(["sold:Retail"]));
		expect(rowAt(rows, "2026-01-05")[0]!.margin["sold:Retail"]).toBe(40);
		expect(rowAt(rows, "2026-01-12")[0]!.margin["sold:Retail"]).toBe(-5);
	});
});

describe("niceDomain", () => {
	it("fits prices far above zero instead of starting at $0, on round ticks", () => {
		const { domain, ticks } = niceDomain([1440, 1475, 1520], { includeZero: false });
		expect(domain[0]).toBeGreaterThan(1300);
		expect(domain[0]).toBeLessThanOrEqual(1440);
		expect(domain[1]).toBeGreaterThanOrEqual(1520);
		expect(domain[1]).toBeLessThan(1700);
		expect(ticks[0]).toBe(domain[0]);
		expect(ticks[ticks.length - 1]).toBe(domain[1]);
		const step = ticks[1]! - ticks[0]!;
		expect([10, 20, 25, 50]).toContain(step);
	});

	it("never pads a price domain below zero", () => {
		expect(niceDomain([2, 40], { includeZero: false }).domain[0]).toBe(0);
	});

	it("keeps zero in view when asked (margin break-even)", () => {
		const { domain } = niceDomain([120, 180], { includeZero: true });
		expect(domain[0]).toBe(0);
		const neg = niceDomain([-30, 45], { includeZero: true }).domain;
		expect(neg[0]).toBeLessThan(-30);
		expect(neg[1]).toBeGreaterThan(45);
	});

	it("gives a flat series some height, and an empty one a default", () => {
		const flat = niceDomain([500], { includeZero: false }).domain;
		expect(flat[0]).toBeLessThan(500);
		expect(flat[1]).toBeGreaterThan(500);
		expect(niceDomain([], { includeZero: false }).domain).toEqual([0, 1]);
	});
});

describe("hasActivity", () => {
	it("is false without purchases and sales, even with cost and list snapshots", () => {
		const quiet = history({
			averageCost: [{ date: "2026-01-01", value: 50 }],
			listPrices: [
				{
					code: 1,
					name: "Retail",
					points: [{ date: "2026-01-01", value: 99 }],
				},
			],
		});
		expect(hasActivity(quiet)).toBe(false);
		expect(hasActivity(history({ purchaseCost: [po("2026-01-20", 48)] }))).toBe(true);
		expect(
			hasActivity(
				history({
					soldPrices: [
						{
							tierName: "Retail",
							buckets: [bucket("2026-01-05", 1)],
						},
					],
				})
			)
		).toBe(true);
	});
});
