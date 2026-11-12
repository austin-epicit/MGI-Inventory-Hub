import { beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "../../generated/prisma/client.js";
import { toAdvancedShape } from "../../fixtures/advancedShape.js";
import { demoDataset } from "../helpers/dataset.js";
import { resetDb, testDb } from "../helpers/db.js";
import { Cin7DataError } from "../../src/sync/money.js";
import { upsertProducts } from "../../src/sync/products.js";
import { mapPurchase, upsertPurchase } from "../../src/sync/purchases.js";
import { mapSale, upsertSale } from "../../src/sync/sales.js";
import { replaceStock } from "../../src/sync/stock.js";
import { upsertReference } from "../../src/sync/reference.js";
import { recordSnapshotIfChanged } from "../../src/sync/snapshots.js";
import { remapFromRaw } from "../../src/sync/remap.js";
import type { Cin7Product } from "../../src/cin7/schemas.js";

const now = new Date("2026-11-01T12:00:00Z");
const ds = demoDataset();
const product = (): Cin7Product => structuredClone(ds.products[0]!);

beforeEach(resetDb);

describe("upsertReference", () => {
	it("writes tiers, locations, suppliers, customers idempotently", async () => {
		const input = {
			tiers: ds.priceTiers,
			locations: ds.locations,
			suppliers: ds.suppliers,
			customers: ds.customers,
		};
		await upsertReference(testDb, input, now);
		await upsertReference(testDb, input, now);
		expect(await testDb.price_tier.count()).toBe(ds.priceTiers.length);
		expect(await testDb.location.count()).toBe(ds.locations.length);
		expect(await testDb.supplier.count()).toBe(ds.suppliers.length);
		expect(await testDb.customer.count()).toBe(ds.customers.length);
	});
});

describe("upsertProducts + snapshots", () => {
	it("same payload twice → 1 snapshot; PriceTier2 change → 2; AverageCost change → 3", async () => {
		const p = product();
		const first = await upsertProducts(testDb, [p], now);
		expect(first).toMatchObject({ upserted: 1, snapshots: 1 });
		const again = await upsertProducts(testDb, [p], now);
		expect(again.snapshots).toBe(0);
		expect(await testDb.product_price_snapshot.count()).toBe(1);
		p.PriceTier2 = p.PriceTier2 + 1;
		await upsertProducts(testDb, [p], now);
		expect(await testDb.product_price_snapshot.count()).toBe(2);
		p.AverageCost = p.AverageCost + 0.01;
		await upsertProducts(testDb, [p], now);
		expect(await testDb.product_price_snapshot.count()).toBe(3);
		const row = await testDb.product.findUniqueOrThrow({ where: { id: p.ID } });
		expect(row.tier_prices).toHaveLength(10);
		expect(row.tier_prices[1]!.toFixed(4)).toBe(
			new Prisma.Decimal(p.PriceTier2).toFixed(4)
		);
	});

	it("sub-4dp noise is not a change; snapshot source defaults to sync", async () => {
		const p = product();
		await upsertProducts(testDb, [p], now);
		p.AverageCost = p.AverageCost + 0.00001;
		expect((await upsertProducts(testDb, [p], now)).snapshots).toBe(0);
		expect((await testDb.product_price_snapshot.findFirstOrThrow()).source).toBe(
			"sync"
		);
	});

	it("recordSnapshotIfChanged reports whether it wrote", async () => {
		await upsertProducts(testDb, [product()], now);
		const id = ds.products[0]!.ID;
		const tiers = Array.from({ length: 10 }, () => 0);
		const snap = { averageCost: 5, tierPrices: tiers };
		expect(await recordSnapshotIfChanged(testDb, id, snap, now)).toBe(true);
		expect(await recordSnapshotIfChanged(testDb, id, snap, now)).toBe(false);
	});

	it("syncs product_image rows: new → pending, removed → deleted, position = index", async () => {
		const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
		const b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
		const att = (ID: string, ContentType = "image/png") => ({
			ID,
			ContentType,
			FileName: `${ID}.x`,
			DownloadUrl: `https://x/${ID}`,
		});
		const p = product();
		p.Attachments = [att(a), att(b, "application/pdf")];
		const r1 = await upsertProducts(testDb, [p], now);
		expect([...r1.imageIds].sort()).toEqual([a, b]);
		await testDb.product_image.update({
			where: { id: a },
			data: { status: "stored", is_primary: true },
		});
		p.Attachments = [att(b, "application/pdf")];
		const r2 = await upsertProducts(testDb, [p], now);
		expect(r2.imageIds).toEqual([]);
		const rows = await testDb.product_image.findMany({ where: { product_id: p.ID } });
		expect(rows.map((r) => [r.id, r.position, r.status])).toEqual([[b, 0, "pending"]]);
		// a re-added attachment starts over and leaves is_primary to Task 9
		p.Attachments = [att(b, "application/pdf"), att(a)];
		await upsertProducts(testDb, [p], now);
		const again = await testDb.product_image.findUniqueOrThrow({ where: { id: a } });
		expect([again.position, again.status, again.is_primary]).toEqual([
			1,
			"pending",
			false,
		]);
	});

	it("a stored image keeps its status when re-synced", async () => {
		const p = product();
		p.Attachments = [
			{
				ID: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
				ContentType: "image/png",
				FileName: "c.png",
				DownloadUrl: "u",
			},
		];
		await upsertProducts(testDb, [p], now);
		await testDb.product_image.updateMany({ data: { status: "stored" } });
		const r = await upsertProducts(testDb, [p], now);
		expect(r.imageIds).toEqual([]);
		expect((await testDb.product_image.findFirstOrThrow()).status).toBe("stored");
	});

	it("missing Attachments leaves image rows; explicit [] deletes them", async () => {
		const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
		const p = product();
		p.Attachments = [
			{ ID: A, ContentType: "image/png", FileName: "f.png", DownloadUrl: "u" },
		];
		await upsertProducts(testDb, [p], now);
		await testDb.product_image.update({ where: { id: A }, data: { status: "stored" } });
		p.Attachments = undefined;
		await upsertProducts(testDb, [p], now);
		p.Attachments = null;
		await upsertProducts(testDb, [p], now);
		const kept = await testDb.product_image.findUniqueOrThrow({ where: { id: A } });
		expect(kept.status).toBe("stored");
		p.Attachments = [];
		await upsertProducts(testDb, [p], now);
		expect(await testDb.product_image.count()).toBe(0);
	});
});

describe("purchases and sales writers", () => {
	const pi = ds.purchaseList[0]!;
	const pd = ds.purchases.find((p) => p.ID === pi.ID)!;
	const si = ds.saleList[0]!;
	const sd = ds.sales.find((s) => s.ID === si.SaleID)!;

	it("upsertSale twice → same lines; fewer lines on re-sync → stale lines removed", async () => {
		const multi = ds.sales.find((s) => s.Order.Lines.length > 1)!;
		const item = ds.saleList.find((l) => l.SaleID === multi.ID)!;
		const m = mapSale(structuredClone(multi), item);
		await upsertSale(testDb, m, now);
		await upsertSale(testDb, m, now);
		expect(await testDb.sale.count()).toBe(1);
		expect(await testDb.sale_line.count()).toBe(multi.Order.Lines.length);
		const fewer = structuredClone(multi);
		fewer.Order.Lines = fewer.Order.Lines.slice(0, 1);
		await upsertSale(testDb, mapSale(fewer, item), now);
		expect(await testDb.sale_line.count()).toBe(1);
		const row = await testDb.sale.findUniqueOrThrow({ where: { id: multi.ID } });
		expect(row.order_date!.toISOString().slice(0, 10)).toBe(
			item.OrderDate.slice(0, 10)
		);
	});

	it("upsertPurchase twice → same lines; fewer lines → stale removed", async () => {
		const multi = ds.purchases.find((p) => p.Order!.Lines.length > 1)!;
		const item = ds.purchaseList.find((l) => l.ID === multi.ID)!;
		const m = mapPurchase(structuredClone(multi), item);
		await upsertPurchase(testDb, m, now);
		await upsertPurchase(testDb, m, now);
		expect(await testDb.purchase.count()).toBe(1);
		expect(await testDb.purchase_line.count()).toBe(multi.Order!.Lines.length);
		const fewer = structuredClone(multi);
		fewer.Order!.Lines = fewer.Order!.Lines.slice(0, 1);
		await upsertPurchase(testDb, mapPurchase(fewer, item), now);
		expect(await testDb.purchase_line.count()).toBe(1);
	});

	it("remapFromRaw skips a bad row, finishes the run and counts it", async () => {
		const ps = [ds.products[0]!, ds.products[1]!];
		await upsertProducts(
			testDb,
			ps.map((p) => structuredClone(p)),
			now
		);
		await testDb.product.update({
			where: { id: ps[0]!.ID },
			data: { raw: { nonsense: true } },
		});
		await testDb.product.update({ where: { id: ps[1]!.ID }, data: { name: "wrong" } });
		expect(await remapFromRaw(testDb, "product")).toEqual({ remapped: 1, skipped: 1 });
		const good = await testDb.product.findUniqueOrThrow({ where: { id: ps[1]!.ID } });
		expect(good.name).toBe(ps[1]!.Name);
	});

	it("remapFromRaw rethrows a database error instead of counting it as skipped", async () => {
		await upsertProducts(testDb, [product()], now);
		const broken = {
			...testDb,
			product: {
				findMany: testDb.product.findMany.bind(testDb.product),
				update: async () => {
					throw new Error("connection lost");
				},
			},
		} as unknown as typeof testDb;
		await expect(remapFromRaw(broken, "product")).rejects.toThrow("connection lost");
	});

	it("remapFromRaw restores a corrupted mapped column from raw", async () => {
		const p0 = ds.products[0]!;
		await upsertProducts(testDb, [product()], now);
		await upsertSale(testDb, mapSale(structuredClone(sd), si), now);
		// The engine stores what /advanced-purchase serves; remap parses only that shape.
		await upsertPurchase(
			testDb,
			mapPurchase(toAdvancedShape(structuredClone(pd)), pi),
			now
		);
		const before = await testDb.sale.findUniqueOrThrow({ where: { id: sd.ID } });
		const linesBefore = await testDb.sale_line.findMany({
			where: { sale_id: sd.ID },
			orderBy: { line_no: "asc" },
		});
		await testDb.sale.update({
			where: { id: sd.ID },
			data: { total_base: 1, counted: !before.counted },
		});
		await testDb.sale_line.updateMany({
			where: { sale_id: sd.ID },
			data: { unit_price_base: 0 },
		});
		await testDb.purchase.update({
			where: { id: pd.ID },
			data: { total_base: 1, order_date: null },
		});
		await testDb.product.update({
			where: { id: p0.ID },
			data: { name: "wrong", average_cost: 1 },
		});
		expect(await remapFromRaw(testDb, "sale")).toEqual({ remapped: 1, skipped: 0 });
		expect(await remapFromRaw(testDb, "purchase")).toEqual({ remapped: 1, skipped: 0 });
		expect(await remapFromRaw(testDb, "product")).toEqual({ remapped: 1, skipped: 0 });
		const after = await testDb.sale.findUniqueOrThrow({ where: { id: sd.ID } });
		expect(after).toEqual(before); // synced_at included: remap must not touch it
		expect(
			await testDb.sale_line.findMany({
				where: { sale_id: sd.ID },
				orderBy: { line_no: "asc" },
			})
		).toEqual(linesBefore);
		const p = await testDb.purchase.findUniqueOrThrow({ where: { id: pd.ID } });
		expect(p.total_base.toFixed(4)).not.toBe("1.0000");
		expect(p.order_date).not.toBeNull();
		const prod = await testDb.product.findUniqueOrThrow({ where: { id: p0.ID } });
		expect(prod.name).toBe(p0.Name);
	});
});

describe("bad CurrencyRate handling", () => {
	const base = ds.sales.find((s) => s.CustomerCurrency === s.BaseCurrency)!;
	const item = ds.saleList.find((l) => l.SaleID === base.ID)!;
	const foreignSale = (orderStatus: string) => {
		const raw = structuredClone(base);
		raw.CustomerCurrency = "CAD";
		raw.BaseCurrency = "USD";
		raw.CurrencyRate = 0;
		raw.Order.Status = orderStatus;
		return raw;
	};

	it("same currency → rate 1", () => {
		const m = mapSale({ ...structuredClone(base), CurrencyRate: 0 }, item);
		expect(m.sale.currency_rate).toBe("1.000000");
		expect(m.sale.total_base).toBe(m.sale.total);
	});

	it("uncounted foreign document stores 0 base amounts", () => {
		const m = mapSale(foreignSale("DRAFT"), item);
		expect(m.sale.counted).toBe(false);
		expect(m.sale.total_base).toBe("0.0000");
		expect(
			m.lines.every(
				(l) => l.unit_price_base === "0.0000" && l.total_base === "0.0000"
			)
		).toBe(true);
		const pb = ds.purchases[0]!;
		const pItem = ds.purchaseList.find((l) => l.ID === pb.ID)!;
		const pf = structuredClone(pb);
		pf.SupplierCurrency = "EUR";
		pf.BaseCurrency = "USD";
		pf.CurrencyRate = 0;
		pf.Status = "VOIDED";
		expect(mapPurchase(pf, pItem).purchase.total_base).toBe("0.0000");
	});

	it("counted foreign document throws Cin7DataError", () => {
		expect(() => mapSale(foreignSale("AUTHORISED"), item)).toThrow(Cin7DataError);
		const pb = ds.purchases[0]!;
		const pItem = ds.purchaseList.find((l) => l.ID === pb.ID)!;
		const pf = structuredClone(pb);
		pf.SupplierCurrency = "EUR";
		pf.BaseCurrency = "USD";
		pf.CurrencyRate = 0;
		pf.Order!.Status = "AUTHORISED";
		pf.Status = "COMPLETED";
		expect(() => mapPurchase(pf, pItem)).toThrow(Cin7DataError);
	});
});

describe("replaceStock", () => {
	const row = (n: number) => ({ ...ds.availability[0]!, OnHand: n });

	it("replaceStock(rows, complete=false) leaves existing stock untouched", async () => {
		await replaceStock(testDb, [row(5)], true, now);
		const r = await replaceStock(testDb, [row(99)], false, now);
		expect(r.replaced).toBe(false);
		const all = await testDb.stock_level.findMany();
		expect(all).toHaveLength(1);
		expect(all[0]!.on_hand.toFixed(4)).toBe("5.0000");
	});

	it("an empty complete sweep does not wipe existing stock", async () => {
		await replaceStock(testDb, [row(5)], true, now);
		const r = await replaceStock(testDb, [], true, now);
		expect(r).toEqual({ replaced: false, reason: "EMPTY_SWEEP", count: 0 });
		expect(await testDb.stock_level.count()).toBe(1);
	});

	it("complete replaces everything, maps null bin/batch to empty strings", async () => {
		await replaceStock(testDb, ds.availability, true, now);
		const first = ds.availability[0]!;
		expect(await testDb.stock_level.count()).toBeGreaterThan(0);
		const r = await replaceStock(
			testDb,
			[{ ...first, Bin: null, Batch: null, OnHand: 7 }],
			true,
			now
		);
		expect(r).toEqual({ replaced: true, count: 1 });
		const rows = await testDb.stock_level.findMany();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			product_id: first.ID,
			location_name: first.Location,
			bin: "",
			batch: "",
		});
		expect(rows[0]!.on_hand.toFixed(4)).toBe("7.0000");
	});
});
