import { beforeEach, describe, expect, it } from "vitest";
import { demoDataset } from "../helpers/dataset.js";
import { resetDb, testDb } from "../helpers/db.js";
import { upsertProducts } from "../../src/sync/products.js";
import { mapSale, rewriteSale, upsertSale } from "../../src/sync/sales.js";
import { remapFromRaw } from "../../src/sync/remap.js";
import { Cin7DataError } from "../../src/sync/money.js";
import { Cin7Sale, type Cin7Sale as Sale } from "../../src/cin7/schemas.js";

const now = new Date("2026-11-01T12:00:00Z");
const ds = demoDataset();
const base = ds.sales.find(
	(s) => s.CustomerCurrency === s.BaseCurrency && s.Order.Lines.length > 1
)!;
const item = ds.saleList.find((l) => l.SaleID === base.ID)!;
const NOTE_ID = "11111111-1111-4111-8111-111111111111";

type CnLine = { ProductID: string; Quantity: number; Price: number; Discount: number };
const note = (over: Record<string, unknown> = {}, lines?: CnLine[]) => {
	const l0 = base.Order.Lines[0]!;
	const l1 = base.Order.Lines[1]!;
	const mk = (l: typeof l0, q: number, price = l.Price, discount = 0) => ({
		ProductID: l.ProductID,
		SKU: l.SKU,
		Name: l.Name,
		Quantity: q,
		Price: price,
		Discount: discount,
		Tax: 0,
		Total: q * price,
	});
	return {
		TaskID: NOTE_ID,
		CreditNoteNumber: "CN-1",
		CreditNoteDate: "2026-02-10T00:00:00",
		Status: "AUTHORISED",
		CreditNoteConversionRate: 0,
		Lines: lines ?? [mk(l0, 2, 10, 10), mk(l1, 1, 4)],
		AdditionalCharges: [],
		Restock: [],
		TotalBeforeTax: 0,
		Total: 0,
		...over,
	};
};
const withNotes = (notes: unknown[], patch: Partial<Sale> = {}): Sale => ({
	...structuredClone(base),
	CreditNotes: notes as Sale["CreditNotes"],
	...patch,
});

beforeEach(resetDb);

describe("mapSale credit notes", () => {
	it("(a) maps an AUTHORISED note with 2 lines to base money and counted", async () => {
		const m = mapSale(withNotes([note()]), item);
		expect(m.creditNotes).toHaveLength(1);
		const cn = m.creditNotes[0]!;
		expect(cn.note).toMatchObject({
			id: NOTE_ID,
			number: "CN-1",
			status: "AUTHORISED",
			counted: true,
			currency_rate: "1.000000",
			total_base: "22.0000",
		});
		expect(
			cn.lines.map((l) => [
				l.line_no,
				l.quantity,
				l.unit_price_base,
				l.total_base,
			])
		).toEqual([
			[1, "2.0000", "9.0000", "18.0000"],
			[2, "1.0000", "4.0000", "4.0000"],
		]);
		await upsertSale(testDb, m, now);
		expect(await testDb.sale_credit_note.count()).toBe(1);
		expect(await testDb.sale_credit_line.count()).toBe(2);
		const row = await testDb.sale_credit_note.findUniqueOrThrow({
			where: { id: NOTE_ID },
		});
		expect(row.credit_date!.toISOString().slice(0, 10)).toBe("2026-02-10");
	});

	it("(b) DRAFT is not counted; AUTHORISED on a VOIDED sale is not counted", () => {
		expect(
			mapSale(withNotes([note({ Status: "DRAFT" })]), item).creditNotes[0]!.note
				.counted
		).toBe(false);
		const voided = mapSale(withNotes([note()], { Status: "VOIDED" }), item);
		expect(voided.creditNotes[0]!.note.counted).toBe(false);
	});

	it("(b2) an authorised note counts even when the order status is no longer counted", () => {
		const raw = withNotes([note()]);
		raw.Order.Status = "DRAFT";
		const m = mapSale(raw, item);
		expect(m.sale.counted).toBe(false);
		expect(m.creditNotes[0]!.note.counted).toBe(true);
	});

	it("(c) CreditNoteConversionRate wins when > 0, else the sale's CurrencyRate", () => {
		const cad = (rate: number) => {
			const raw = withNotes([note({ CreditNoteConversionRate: rate })]);
			raw.CustomerCurrency = "CAD";
			raw.BaseCurrency = "USD";
			raw.CurrencyRate = 0.73;
			return mapSale(raw, item).creditNotes[0]!;
		};
		const own = cad(0.75);
		expect(own.note.currency_rate).toBe("0.750000");
		expect(own.lines[1]!.unit_price_base).toBe("3.0000");
		const fallback = cad(0);
		expect(fallback.note.currency_rate).toBe("0.730000");
		expect(fallback.lines[1]!.unit_price_base).toBe("2.9200");
		expect(fallback.note.total_base).toBe("16.0600");
	});

	const foreign = (n: Record<string, unknown>) => {
		const raw = withNotes([note(n)]);
		raw.CustomerCurrency = "CAD";
		raw.BaseCurrency = "USD";
		raw.CurrencyRate = 0;
		raw.Order.Status = "DRAFT"; // the sale itself is uncounted, so only the note can throw
		return raw;
	};

	it("a counted foreign note with no usable rate throws Cin7DataError naming the sale", () => {
		const raw = foreign({});
		expect(() => mapSale(raw, item)).toThrow(Cin7DataError);
		try {
			mapSale(raw, item);
		} catch (e) {
			expect((e as Cin7DataError).recordId).toBe(raw.ID);
		}
	});

	it("an uncounted foreign note with no rate stores rate 0 and 0 money", () => {
		const cn = mapSale(foreign({ Status: "DRAFT" }), item).creditNotes[0]!;
		expect(cn.note).toMatchObject({
			counted: false,
			currency_rate: "0.000000",
			total_base: "0.0000",
		});
		expect(
			cn.lines.every(
				(l) => l.unit_price_base === "0.0000" && l.total_base === "0.0000"
			)
		).toBe(true);
	});

	it("a null Discount maps to 0", () => {
		const l = base.Order.Lines[0]!;
		const raw = withNotes([
			note({}, [
				{
					ProductID: l.ProductID,
					Quantity: 2,
					Price: 10,
					Discount: null as unknown as number,
				},
			]),
		]);
		expect(mapSale(raw, item).creditNotes[0]!.lines[0]!.unit_price_base).toBe(
			"10.0000"
		);
	});

	it("tolerates a sale with no CreditNotes and notes without optional fields", () => {
		expect(
			mapSale({ ...structuredClone(base), CreditNotes: undefined }, item)
				.creditNotes
		).toEqual([]);
		const bare = Cin7Sale.parse(
			withNotes([{ TaskID: NOTE_ID, Status: "AUTHORISED", Lines: [] }])
		);
		const cn = mapSale(bare, item).creditNotes[0]!;
		expect(cn.note).toMatchObject({
			number: null,
			credit_date: null,
			total_base: "0.0000",
		});
	});
});

describe("stub and invalid credit notes never fail the sale", () => {
	const writes = async (notes: unknown[]) => {
		const parsed = Cin7Sale.parse(withNotes(notes));
		await upsertSale(testDb, mapSale(parsed, item), now);
		expect(await testDb.sale.count()).toBe(1);
		expect(await testDb.sale_line.count()).toBe(base.Order.Lines.length);
	};

	it("a NOT AVAILABLE stub with the zero GUID writes the sale and stores no note", async () => {
		await writes([
			note({
				TaskID: "00000000-0000-0000-0000-000000000000",
				Status: "NOT AVAILABLE",
			}),
		]);
		expect(await testDb.sale_credit_note.count()).toBe(0);
	});

	it("a non-UUID, empty, or missing TaskID and a missing Status store no note", async () => {
		await writes([
			note({ TaskID: "not-a-uuid" }),
			note({ TaskID: "" }),
			note({ TaskID: null }),
			note({ Status: null }),
		]);
		expect(await testDb.sale_credit_note.count()).toBe(0);
	});

	it("a counted note with null Price/Quantity lines stores 0 money without throwing", async () => {
		const l = base.Order.Lines[0]!;
		const bad = { ProductID: l.ProductID, Quantity: null, Price: null, Discount: null };
		const ok = { ProductID: l.ProductID, Quantity: 2, Price: 5, Discount: 0 };
		await writes([note({}, [bad, ok] as unknown as CnLine[])]);
		const lines = await testDb.sale_credit_line.findMany({
			orderBy: { line_no: "asc" },
		});
		expect(lines.map((r) => [r.quantity.toFixed(4), r.total_base.toFixed(4)])).toEqual([
			["0.0000", "0.0000"],
			["2.0000", "10.0000"],
		]);
		const n = await testDb.sale_credit_note.findUniqueOrThrow({
			where: { id: NOTE_ID },
		});
		expect(n.total_base.toFixed(4)).toBe("10.0000");
	});
});

describe("credit note writers", () => {
	it("(d) upserting twice leaves one note; removing it from the payload deletes it", async () => {
		const m = mapSale(withNotes([note()]), item);
		await upsertSale(testDb, m, now);
		await upsertSale(testDb, m, now);
		expect(await testDb.sale_credit_note.count()).toBe(1);
		expect(await testDb.sale_credit_line.count()).toBe(2);
		await upsertSale(testDb, mapSale(withNotes([]), item), now);
		expect(await testDb.sale_credit_note.count()).toBe(0);
		expect(await testDb.sale_credit_line.count()).toBe(0);
	});

	it("(e) remapFromRaw recreates credit notes whose rows were deleted", async () => {
		await upsertSale(testDb, mapSale(withNotes([note()]), item), now);
		await testDb.sale_credit_note.deleteMany(); // lines cascade
		expect(await testDb.sale_credit_line.count()).toBe(0);
		expect(await remapFromRaw(testDb, "sale")).toEqual({ remapped: 1, skipped: 0 });
		expect(await testDb.sale_credit_note.count()).toBe(1);
		expect(await testDb.sale_credit_line.count()).toBe(2);
	});

	it("rewriteSale replaces credit notes too", async () => {
		await upsertSale(testDb, mapSale(withNotes([note()]), item), now);
		await rewriteSale(
			testDb,
			mapSale(withNotes([note({ CreditNoteNumber: "CN-2" })]), item)
		);
		expect(
			(
				await testDb.sale_credit_note.findUniqueOrThrow({
					where: { id: NOTE_ID },
				})
			).number
		).toBe("CN-2");
	});
});

describe("(f) reversed cost", () => {
	it("uses the matching sale line's average cost, lowest line_no; else the product's", async () => {
		const raw = withNotes([]);
		const [a, b] = raw.Order.Lines;
		const other = ds.products.find(
			(p) => !raw.Order.Lines.some((l) => l.ProductID === p.ID)
		)!;
		await upsertProducts(testDb, [other], now);
		a!.AverageCost = 7.5;
		const dup = structuredClone(a!);
		dup.AverageCost = 99; // later line, same product: must lose to line 1
		raw.Order.Lines.push(dup);
		raw.CreditNotes = [
			note({}, [
				{ ProductID: a!.ProductID, Quantity: 1, Price: 5, Discount: 0 },
				{ ProductID: other.ID, Quantity: 1, Price: 5, Discount: 0 },
				{ ProductID: b!.ProductID, Quantity: 1, Price: 5, Discount: 0 },
			]),
		] as Sale["CreditNotes"];
		b!.AverageCost = null;
		await upsertSale(testDb, mapSale(raw, item), now);
		const lines = await testDb.sale_credit_line.findMany({
			orderBy: { line_no: "asc" },
		});
		expect(lines[0]!.average_cost!.toFixed(4)).toBe("7.5000");
		const prod = await testDb.product.findUniqueOrThrow({ where: { id: other.ID } });
		expect(lines[1]!.average_cost!.toFixed(4)).toBe(prod.average_cost.toFixed(4));
		// product b is not in the products table and its sale line has no cost → null
		expect(lines[2]!.average_cost).toBeNull();
	});

	it("a null sale-line average cost falls back to the product's cost when the product exists", async () => {
		const raw = withNotes([]);
		const a = raw.Order.Lines[0]!;
		const prod = ds.products.find((p) => p.ID === a.ProductID)!;
		await upsertProducts(testDb, [prod], now);
		a.AverageCost = null;
		raw.CreditNotes = [
			note({}, [{ ProductID: a.ProductID, Quantity: 1, Price: 5, Discount: 0 }]),
		] as Sale["CreditNotes"];
		await upsertSale(testDb, mapSale(raw, item), now);
		const line = await testDb.sale_credit_line.findFirstOrThrow();
		const row = await testDb.product.findUniqueOrThrow({ where: { id: a.ProductID } });
		expect(row.average_cost.toFixed(4)).not.toBe("0.0000");
		expect(line.average_cost!.toFixed(4)).toBe(row.average_cost.toFixed(4));
	});
});
