import { describe, expect, it } from "vitest";
import { generateDataset } from "../../fixtures/generate.js";
import {
	Cin7AdvancedPurchase,
	Cin7AvailabilityPage,
	Cin7CustomerPage,
	Cin7LocationPage,
	Cin7Me,
	Cin7PriceTiers,
	Cin7ProductPage,
	Cin7Purchase,
	Cin7PurchaseListPage,
	Cin7Sale,
	Cin7SaleListPage,
	Cin7SupplierPage,
} from "../../src/cin7/schemas.js";
import { parseCin7Stamp } from "../../src/cin7/timestamps.js";
import { mapSale } from "../../src/sync/sales.js";
import { demoDataset } from "../helpers/dataset.js";

const gen = (seed: number) => generateDataset({ seed, asOf: "2026-11-01", months: 24 });
const TIERS = ["Retail", "Wholesale", "Broker"];

describe("demo dataset", () => {
	const ds = demoDataset();

	it("is deterministic", () => {
		expect(gen(42)).toEqual(gen(42));
		expect(gen(43)).not.toEqual(gen(42));
	});

	it("generates inside the test time budget", () => {
		const t0 = performance.now();
		gen(7);
		expect(performance.now() - t0).toBeLessThan(2000);
	});

	it("every record parses with the Cin7 schemas", () => {
		const page = (key: string, items: unknown[]) => ({
			Total: items.length,
			Page: 1,
			[key]: items,
		});
		Cin7Me.parse(ds.me);
		Cin7PriceTiers.parse({ PriceTiers: ds.priceTiers });
		Cin7LocationPage.parse(page("LocationList", ds.locations));
		Cin7SupplierPage.parse(page("SupplierList", ds.suppliers));
		Cin7CustomerPage.parse(page("CustomerList", ds.customers));
		Cin7ProductPage.parse(page("Products", ds.products));
		Cin7AvailabilityPage.parse(page("ProductAvailabilityList", ds.availability));
		Cin7SaleListPage.parse(page("SaleList", ds.saleList));
		Cin7PurchaseListPage.parse(page("PurchaseList", ds.purchaseList));
		for (const s of ds.sales) Cin7Sale.parse(s);
		for (const p of ds.purchases) {
			if (Array.isArray(p.StockReceived)) Cin7AdvancedPurchase.parse(p);
			else Cin7Purchase.parse(p);
		}
	});

	it("survives a JSON round trip (valid JSON, no undefined holes)", () => {
		expect(JSON.parse(JSON.stringify(ds))).toEqual(ds);
	});

	it("covers the pinned reference data", () => {
		expect(ds.me).toMatchObject({ Currency: "USD" });
		expect(ds.priceTiers).toHaveLength(10);
		expect(ds.priceTiers.slice(0, 3)).toEqual([
			{ Code: 1, Name: "Retail" },
			{ Code: 2, Name: "Wholesale" },
			{ Code: 3, Name: "Broker" },
		]);
		expect(ds.priceTiers[9]).toEqual({ Code: 10, Name: "Tier 10" });
		expect(ds.locations.map((l) => l.Name)).toEqual([
			"Main Warehouse",
			"Refurb Bay",
			"Overflow",
		]);
		expect(ds.suppliers).toHaveLength(12);
		expect(ds.suppliers.filter((s) => s.Currency === "CAD")).toHaveLength(1);
		expect(ds.customers).toHaveLength(25);
		expect(ds.customers.filter((c) => c.Currency === "CAD")).toHaveLength(2);
		expect(ds.customers.filter((c) => c.Currency === "EUR")).toHaveLength(1);
	});

	it("covers the pinned product edge cases", () => {
		const ps = ds.products;
		expect(ps.length).toBeGreaterThanOrEqual(140);
		expect(ps.length).toBeLessThanOrEqual(160);
		expect(new Set(ps.map((p) => p.Category))).toEqual(
			new Set(["Servers", "Storage", "Networking", "Components"])
		);
		expect(new Set(ps.map((p) => p.Brand))).toEqual(
			new Set([
				"Dell",
				"HPE",
				"Cisco",
				"Juniper",
				"NetApp",
				"Supermicro",
				"Lenovo",
				"Seagate",
				"Samsung",
				"Intel",
			])
		);
		expect(ps.filter((p) => p.Status === "Deprecated").length).toBeGreaterThanOrEqual(
			1
		);
		const imgs = (p: (typeof ps)[number]) =>
			(p.Attachments ?? []).filter((a) => a.ContentType.startsWith("image/"))
				.length;
		expect(ps.filter((p) => imgs(p) === 0).length).toBeGreaterThanOrEqual(5);
		expect(ps.filter((p) => imgs(p) === 3).length).toBeGreaterThanOrEqual(3);
		const tierSum = (p: (typeof ps)[number]) =>
			Array.from(
				{ length: 10 },
				(_, i) => p[`PriceTier${i + 1}` as "PriceTier1"]
			).reduce((a, b) => a + b, 0);
		const unset = ps.filter((p) => p.Status === "Setup required" && tierSum(p) === 0);
		expect(unset.length).toBeGreaterThanOrEqual(10);
		const pdf = ps.filter((p) =>
			p.Attachments?.some((a) => a.ContentType === "application/pdf")
		);
		expect(pdf.length).toBeGreaterThanOrEqual(1);
		const hosts = ps
			.flatMap((p) => p.Attachments ?? [])
			.map((a) => new URL(a.DownloadUrl).host);
		expect(new Set(hosts).size).toBeGreaterThanOrEqual(2);
		for (const h of hosts) expect(h.endsWith(".invalid")).toBe(true);
	});

	it("tiers 4-10 are unused and PriceTiers is keyed by tier name", () => {
		for (const p of ds.products) {
			for (let i = 4; i <= 10; i++)
				expect(p[`PriceTier${i}` as "PriceTier4"]).toBe(0);
			expect(p.PriceTiers).toMatchObject({
				Retail: p.PriceTier1,
				Wholesale: p.PriceTier2,
			});
		}
	});

	it("covers the pinned purchase edge cases", () => {
		const ps = ds.purchaseList;
		expect(ps.length).toBeGreaterThanOrEqual(550);
		expect(ps.length).toBeLessThanOrEqual(650);
		const adv = ps.filter((p) => p.Type === "Advanced Purchase").length / ps.length;
		expect(adv).toBeGreaterThan(0.1);
		expect(adv).toBeLessThan(0.2);
		expect(ps.filter((p) => p.Status === "VOIDED").length).toBeGreaterThanOrEqual(2);
		expect(
			ps.filter((p) => p.SupplierCurrency === "CAD").length
		).toBeGreaterThanOrEqual(1);
		const dates = ps.map((p) => p.OrderDate!).sort();
		expect(dates[0] >= "2024-11-01").toBe(true);
		expect(dates[dates.length - 1] < "2026-11-01").toBe(true);
		expect(ps.every((p) => /^\d{4}-\d\d-\d\dT00:00:00$/.test(p.OrderDate!))).toBe(true);
		expect(ps.every((p) => parseCin7Stamp(p.LastUpdatedDate) instanceof Date)).toBe(
			true
		);
		expect(ds.purchases).toHaveLength(ps.length);
		const service = ds.purchases.filter(
			(p) => ps.find((l) => l.ID === p.ID)?.Type === "Service Purchase"
		);
		expect(service.length).toBeGreaterThanOrEqual(1);
		for (const p of service) {
			expect(p.Order!.Lines).toEqual([]);
			expect(p.Order!.AdditionalCharges!.length).toBeGreaterThan(0);
			expect(p.Order!.Total).toBeGreaterThan(0);
			expect(p.Order!.Status).toBe("AUTHORISED");
		}
	});

	it("covers the pinned sale edge cases", () => {
		const ss = ds.saleList;
		expect(ss.length).toBeGreaterThanOrEqual(1900);
		expect(ss.length).toBeLessThanOrEqual(2100);
		const voided = ss.filter((s) => s.Status === "VOIDED").length / ss.length;
		const draft = ss.filter((s) => s.Status === "DRAFT").length / ss.length;
		expect(voided).toBeGreaterThan(0.015);
		expect(voided).toBeLessThan(0.05);
		expect(draft).toBeGreaterThan(0.03);
		expect(draft).toBeLessThan(0.08);
		expect(new Set(ds.sales.map((s) => s.ID)).size).toBe(ss.length);
		const live = ds.sales.filter((s) => s.Status !== "VOIDED" && s.Status !== "DRAFT");
		const share = (tier: string) =>
			live.filter((s) => s.PriceTier === tier).length / live.length;
		expect(share("Wholesale")).toBeGreaterThan(0.5);
		expect(share("Wholesale")).toBeLessThan(0.7);
		expect(share("Retail")).toBeGreaterThan(0.22);
		expect(share("Retail")).toBeLessThan(0.38);
		expect(share("Broker")).toBeGreaterThan(0.05);
		expect(share("Broker")).toBeLessThan(0.16);
		const discounts = live.flatMap((s) => s.Order.Lines.map((l) => l.Discount));
		expect(Math.min(...discounts)).toBe(0);
		expect(Math.max(...discounts)).toBeGreaterThan(0);
		expect(Math.max(...discounts)).toBeLessThanOrEqual(12);
		const cad = ds.sales.filter((s) => s.CustomerCurrency === "CAD");
		expect(cad.length).toBeGreaterThanOrEqual(1);
		expect(cad.every((s) => s.CurrencyRate === 0.73)).toBe(true);
		for (const s of ds.sales) expect(TIERS).toContain(s.PriceTier);
	});

	it("sale lines reference real products and totals add up", () => {
		const ids = new Set(ds.products.map((p) => p.ID));
		for (const s of ds.sales.slice(0, 300)) {
			const sum = s.Order.Lines.reduce((a, l) => a + l.Total, 0);
			expect(Math.abs(sum - s.Order.TotalBeforeTax)).toBeLessThan(0.011);
			for (const l of s.Order.Lines) expect(ids.has(l.ProductID)).toBe(true);
		}
	});

	it("purchase unit costs random-walk per product with occasional steps", () => {
		const bySku = new Map<string, number[]>();
		for (const p of ds.purchases) {
			if (p.SupplierCurrency !== "USD" || p.Status === "VOIDED") continue;
			for (const l of p.Order!.Lines)
				bySku.set(l.SKU, [...(bySku.get(l.SKU) ?? []), l.Price]);
		}
		const busiest = [...bySku.values()].sort((a, b) => b.length - a.length)[0];
		expect(busiest.length).toBeGreaterThan(10);
		expect(new Set(busiest).size).toBeGreaterThan(3);
	});

	it("seeds monthly price history per product, ending at the current values", () => {
		expect(ds.seedHistory).toHaveLength(ds.products.length);
		const h = ds.seedHistory[0];
		expect(h.points).toHaveLength(24);
		expect(h.points[0].month).toBe("2024-11");
		expect(h.points[23].month).toBe("2026-10");
		const p = ds.products.find((x) => x.ID === h.productId)!;
		expect(h.points[23].averageCost).toBe(p.AverageCost);
		expect(h.points[23].tierPrices).toHaveLength(10);
		expect(h.points[23].tierPrices[0]).toBe(p.PriceTier1);
	});

	it("availability rows tie to stocked products and locations", () => {
		const names = new Set(ds.locations.map((l) => l.Name));
		const ids = new Set(ds.products.map((p) => p.ID));
		expect(ds.availability.length).toBeGreaterThan(100);
		for (const a of ds.availability) {
			expect(names.has(a.Location)).toBe(true);
			expect(ids.has(a.ID)).toBe(true);
			expect(a.OnHand).toBeGreaterThanOrEqual(0);
		}
	});

	it("modification stamps vary in format like the real API", () => {
		const zoneless = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,3})?$/;
		const withZ = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,3})?Z$/;
		const purchaseStamps = ds.purchaseList.map((p) => p.LastUpdatedDate);
		expect(purchaseStamps.filter((s) => zoneless.test(s)).length).toBeGreaterThan(50);
		expect(purchaseStamps.filter((s) => withZ.test(s)).length).toBeGreaterThan(50);
		const saleStamps = ds.saleList.map((s) => s.Updated);
		expect(saleStamps.every((s) => withZ.test(s))).toBe(true);
		const fractionDigits = new Set(
			saleStamps.map((s) => (/\.(\d+)Z$/.exec(s)?.[1] ?? "").length)
		);
		expect(fractionDigits.has(2)).toBe(true);
		expect(fractionDigits.has(3)).toBe(true);
		expect(ds.products.every((p) => withZ.test(p.LastModifiedOn ?? "x"))).toBe(true);
		// Every form parses back inside the data window, whatever the host time zone.
		for (const s of [...purchaseStamps, ...saleStamps]) {
			const t = parseCin7Stamp(s).getTime();
			expect(t).toBeGreaterThanOrEqual(Date.UTC(2024, 10, 1));
			expect(t).toBeLessThan(Date.UTC(2026, 10, 1));
		}
	});
});

describe("demo credit notes", () => {
	const ds = demoDataset();
	const DAY = 86_400_000;
	const asOf = Date.parse("2026-11-01T00:00:00Z");
	const day = (s: string | null | undefined) => Date.parse(`${s!.slice(0, 10)}T00:00:00Z`);
	const normal = ds.sales.filter((s) => s.Status !== "DRAFT" && s.Status !== "VOIDED");
	const eligible = normal.filter((s) => day(s.SaleOrderDate) <= asOf - 3 * DAY);
	const withNote = ds.sales.filter((s) => (s.CreditNotes ?? []).length > 0);
	const notes = withNote.flatMap((s) => s.CreditNotes ?? []);

	it("about 4% of eligible normal sales carry exactly one credit note", () => {
		expect(withNote.every((s) => s.CreditNotes!.length === 1)).toBe(true);
		expect(withNote.every((s) => eligible.includes(s))).toBe(true);
		const pct = (withNote.length / eligible.length) * 100;
		expect(pct).toBeGreaterThanOrEqual(3);
		expect(pct).toBeLessThanOrEqual(5);
	});

	it("dates run from order + 3 days to the as-of day", () => {
		for (const s of withNote) {
			const d = day(s.CreditNotes![0]!.CreditNoteDate);
			expect(d).toBeGreaterThanOrEqual(day(s.SaleOrderDate) + 3 * DAY);
			expect(d).toBeLessThanOrEqual(asOf);
		}
	});

	it("about 10% are DRAFT, the rest AUTHORISED", () => {
		expect(new Set(notes.map((n) => n.Status))).toEqual(
			new Set(["DRAFT", "AUTHORISED"])
		);
		const pct = (notes.filter((n) => n.Status === "DRAFT").length / notes.length) * 100;
		expect(pct).toBeGreaterThanOrEqual(4);
		expect(pct).toBeLessThanOrEqual(18);
	});

	it("credits one line, never more than the sale line quantity, at the sale price", () => {
		for (const s of withNote) {
			const [cl, ...rest] = s.CreditNotes![0]!.Lines!;
			expect(rest).toHaveLength(0);
			const sl = s.Order.Lines.find((l) => l.ProductID === cl!.ProductID)!;
			expect(cl!.Quantity).toBeGreaterThanOrEqual(1);
			expect(cl!.Quantity).toBeLessThanOrEqual(sl.Quantity);
			expect(cl!.Price).toBe(sl.Price);
			expect(cl!.Discount).toBe(sl.Discount);
		}
		expect(withNote.some((s) => s.CreditNotes![0]!.Lines![0]!.Quantity! > 1)).toBe(
			true
		);
	});

	it("every sale still parses and maps through mapSale", () => {
		for (const s of withNote) {
			Cin7Sale.parse(s);
			const item = ds.saleList.find((l) => l.SaleID === s.ID)!;
			const m = mapSale(s, item);
			expect(m.creditNotes).toHaveLength(1);
			expect(m.creditNotes[0]!.note.counted).toBe(
				s.CreditNotes![0]!.Status === "AUTHORISED"
			);
		}
	});

	it("leaves the existing sections' values unchanged", () => {
		expect(
			ds.sales
				.slice(0, 3)
				.map((s) => [
					s.ID,
					s.SaleOrderDate,
					s.Order.Total,
					s.LastModifiedOn,
				])
		).toEqual([
			[
				"0d38992f-8746-473f-a798-f10834099d91",
				"2024-11-01T00:00:00",
				837.9,
				"2024-11-09T16:43:06.183Z",
			],
			[
				"5ed23249-3df8-4024-95ea-693d29bab085",
				"2024-11-01T00:00:00",
				4894.1,
				"2024-11-07T14:34:28.54Z",
			],
			[
				"18e095db-8c64-4d0a-978e-1f1237a3a652",
				"2024-11-02T00:00:00",
				161.5,
				"2024-11-04T13:39:53.672Z",
			],
		]);
		expect(ds.products.slice(0, 3).map((p) => [p.ID, p.SKU, p.PriceTier1])).toEqual([
			["80cbb7ab-e2c6-48fc-a372-ef9f42b81282", "DEL-POWEREDGE-R640-A", 2065],
			["84774441-f271-42e6-aaf6-b87041ecc844", "DEL-POWEREDGE-R640-B", 0],
			["2fe05d83-0cfc-4245-84f1-52333f45b3e8", "DEL-POWEREDGE-R640-OB", 1480],
		]);
		expect(ds.purchases.slice(0, 2).map((p) => [p.ID, p.Order?.Total])).toEqual([
			["939d32f8-ff35-4d61-a3d9-8bcbad84a856", 9558.16],
			["124ed687-5c84-4e60-a15e-5b79c5a64ec2", 29845.52],
		]);
		expect(ds.availability[0]).toMatchObject({
			OnHand: 70,
			Allocated: 3,
			StockOnHand: 104255.63,
		});
	});
});
