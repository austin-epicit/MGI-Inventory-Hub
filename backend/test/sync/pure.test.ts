import { describe, expect, it } from "vitest";
import { netUnit, round4, toBase } from "../../src/sync/money.js";
import { parseCin7Date, parseCin7Timestamp, ymdToDbDate } from "../../src/sync/dates.js";
import { mapPurchase } from "../../src/sync/purchases.js";
import { mapSale } from "../../src/sync/sales.js";
import type {
	Cin7AdvancedPurchase,
	Cin7Purchase,
	Cin7PurchaseListItem,
	Cin7Sale,
	Cin7SaleListItem,
} from "../../src/cin7/schemas.js";

const ID = "11111111-1111-4111-8111-111111111111";
const PID = "22222222-2222-4222-8222-222222222222";

const saleItem = (o: Partial<Cin7SaleListItem> = {}): Cin7SaleListItem => ({
	SaleID: ID,
	OrderNumber: "SO-1",
	Status: "COMPLETED",
	OrderDate: "2026-03-01T00:00:00",
	InvoiceDate: "2026-03-02T00:00:00",
	Customer: "Acme",
	CustomerID: PID,
	BaseCurrency: "USD",
	CustomerCurrency: "CAD",
	Updated: "2026-03-05T10:00:00.5Z",
	OrderStatus: "CLOSED",
	Type: "Simple Sale",
	CombinedInvoiceStatus: "PAID",
	...o,
});

const saleRaw = (o: Partial<Cin7Sale> = {}, orderStatus = "AUTHORISED"): Cin7Sale => ({
	ID,
	Customer: "Acme",
	CustomerID: PID,
	BaseCurrency: "USD",
	CustomerCurrency: "CAD",
	PriceTier: "Retail",
	SaleOrderDate: "2026-03-01T00:00:00",
	LastModifiedOn: "2026-03-06T10:00:00",
	Status: "COMPLETED",
	CurrencyRate: 0.73,
	COGSAmount: 500.5,
	Type: "Simple Sale",
	Order: {
		SaleOrderNumber: "SO-1",
		Status: orderStatus,
		Lines: [
			{
				ProductID: PID,
				SKU: "A",
				Name: "Thing",
				Quantity: 2,
				Price: 1000,
				Discount: 10,
				Tax: 0,
				AverageCost: 400.1234,
				Total: 1800,
			},
		],
		TotalBeforeTax: 1800,
		Tax: 0,
		Total: 1800,
	},
	...o,
});

const purchaseItem = (o: Partial<Cin7PurchaseListItem> = {}): Cin7PurchaseListItem => ({
	ID,
	OrderNumber: "PO-1",
	Status: "COMPLETED",
	OrderDate: "2026-03-01T00:00:00",
	InvoiceDate: null,
	Supplier: "Evergreen",
	SupplierID: PID,
	BaseCurrency: "USD",
	SupplierCurrency: "EUR",
	LastUpdatedDate: "2026-03-05T10:00:00.342",
	OrderStatus: "AUTHORISED",
	Type: "Simple Purchase",
	CombinedReceivingStatus: "FULLY RECEIVED",
	CombinedInvoiceStatus: "INVOICED",
	...o,
});

const purchaseRaw = (o: Partial<Cin7Purchase> = {}): Cin7Purchase => ({
	ID,
	SupplierID: PID,
	Supplier: "Evergreen",
	BaseCurrency: "USD",
	SupplierCurrency: "EUR",
	OrderNumber: "PO-1",
	OrderDate: "2026-03-01T00:00:00",
	Status: "COMPLETED",
	CurrencyRate: 1.1,
	LastUpdatedDate: "2026-03-04T00:00:00",
	Order: {
		Status: "AUTHORISED",
		Lines: [
			{
				ProductID: PID,
				SKU: "A",
				Name: "Thing",
				Quantity: 3,
				Price: 100,
				Discount: 0,
				Tax: 0,
				Total: 300,
			},
			{
				ProductID: PID,
				SKU: "B",
				Name: "Other",
				Quantity: 1,
				Price: 50,
				Discount: 20,
				Tax: 0,
				Total: 40,
			},
		],
		TotalBeforeTax: 340,
		Tax: 0,
		Total: 340,
	},
	StockReceived: { Status: "AUTHORISED" },
	Invoice: { Status: "AUTHORISED" },
	...o,
});

describe("money", () => {
	it("converts to base and nets discounts", () => {
		expect(toBase(100, 0.73)).toBe(73);
		expect(netUnit(200, 12.5)).toBe(175);
		expect(netUnit(285, 2)).toBe(279.3);
	});
	it("rounds half up at 4 dp without float drift", () => {
		expect(round4(1.00005)).toBe(1.0001);
		expect(round4(2.675)).toBe(2.675);
		expect(toBase(0.1, 3)).toBe(0.3);
	});
	it("rejects a non-positive rate rather than zeroing money", () => {
		expect(() => toBase(10, 0)).toThrow();
	});
});

describe("dates", () => {
	it("slices business dates, never shifts zones", () => {
		expect(parseCin7Date("2026-03-01T00:00:00")).toBe("2026-03-01");
		expect(parseCin7Date("2026-03-01T00:00:00Z")).toBe("2026-03-01");
		expect(parseCin7Date(null)).toBeNull();
		expect(parseCin7Date("")).toBeNull();
		expect(ymdToDbDate("2026-03-01").toISOString()).toBe("2026-03-01T00:00:00.000Z");
	});
	it("parses zone-less timestamps as UTC", () => {
		expect(parseCin7Timestamp("2026-03-01T08:00:00").toISOString()).toBe(
			"2026-03-01T08:00:00.000Z"
		);
	});
});

describe("mapSale", () => {
	it("CAD sale line: Price 1000, Discount 10, CurrencyRate 0.73 → unit_price_base 657", () => {
		const { sale, lines } = mapSale(saleRaw(), saleItem());
		expect(lines[0]!.unit_price_base).toBe("657.0000");
		expect(lines[0]!.total_base).toBe("1314.0000");
		expect(lines[0]!.unit_price).toBe("1000.0000");
		expect(lines[0]!.average_cost).toBe("400.1234");
		expect(lines[0]!.line_no).toBe(1);
		expect(sale.total).toBe("1800.0000");
		expect(sale.total_base).toBe("1314.0000");
		expect(sale.cogs_base).toBe("500.5000");
		expect(sale.currency).toBe("CAD");
		expect(sale.base_currency).toBe("USD");
		expect(sale.order_date).toEqual(new Date("2026-03-01T00:00:00.000Z"));
		expect(sale.invoice_date).toEqual(new Date("2026-03-02T00:00:00.000Z"));
		expect(sale.invoice_status).toBe("PAID");
		expect(sale.price_tier_name).toBe("Retail");
		expect(sale.counted).toBe(true);
		// later of list Updated (03-05) and detail LastModifiedOn (03-06)
		expect(sale.cin7_updated_at.toISOString()).toBe("2026-03-06T10:00:00.000Z");
	});

	it("voided sale and draft order → counted false; rows still stored", () => {
		const voided = mapSale(
			saleRaw({ Status: "VOIDED" }),
			saleItem({ Status: "VOIDED" })
		);
		expect(voided.sale.counted).toBe(false);
		expect(voided.lines).toHaveLength(1);
		const draft = mapSale(saleRaw({}, "DRAFT"), saleItem());
		expect(draft.sale.counted).toBe(false);
		expect(mapSale(saleRaw({}, "AUTH_NO_ALLOC"), saleItem()).sale.counted).toBe(true);
	});

	it("FULFILLED and CLOSED orders count; NOT AVAILABLE and VOIDED status do not", () => {
		for (const st of ["FULFILLED", "CLOSED"])
			expect(mapSale(saleRaw({}, st), saleItem()).sale.counted, st).toBe(true);
		expect(mapSale(saleRaw({}, "NOT AVAILABLE"), saleItem()).sale.counted).toBe(false);
		expect(
			mapSale(saleRaw({ Status: "VOIDED" }, "CLOSED"), saleItem()).sale.counted
		).toBe(false);
	});

	it("quote-stage sale (no SaleOrderNumber) takes the list OrderNumber, uncounted", () => {
		const raw = saleRaw({}, "DRAFT");
		raw.Order.SaleOrderNumber = null;
		const { sale } = mapSale(raw, saleItem({ OrderNumber: "SO-Q9" }));
		expect(sale.order_number).toBe("SO-Q9");
		expect(sale.counted).toBe(false);
	});

	it("null-rate voided foreign sale maps with zero base amounts instead of throwing", () => {
		const raw = saleRaw({ Status: "VOIDED", CurrencyRate: null });
		const { sale, lines } = mapSale(raw, saleItem({ Status: "VOIDED" }));
		expect(sale.counted).toBe(false);
		expect(sale.total_base).toBe("0.0000");
		expect(lines[0]!.total_base).toBe("0.0000");
	});

	it("keeps the later timestamp when the list item is newer", () => {
		const { sale } = mapSale(saleRaw(), saleItem({ Updated: "2026-04-01T00:00:00Z" }));
		expect(sale.cin7_updated_at.toISOString()).toBe("2026-04-01T00:00:00.000Z");
	});

	it("null COGS and null line average cost stay null", () => {
		const raw = saleRaw({ COGSAmount: null });
		raw.Order.Lines[0]!.AverageCost = null;
		const { sale, lines } = mapSale(raw, saleItem());
		expect(sale.cogs_base).toBeNull();
		expect(lines[0]!.average_cost).toBeNull();
	});
});

describe("mapPurchase", () => {
	it("simple purchase maps, converting at the document rate", () => {
		const { purchase, lines } = mapPurchase(purchaseRaw(), purchaseItem());
		expect(purchase.counted).toBe(true);
		expect(purchase.currency).toBe("EUR");
		expect(purchase.total).toBe("340.0000");
		expect(purchase.total_base).toBe("374.0000");
		expect(purchase.receiving_status).toBe("FULLY RECEIVED");
		expect(purchase.invoice_status).toBe("INVOICED");
		expect(purchase.order_date).toEqual(new Date("2026-03-01T00:00:00.000Z"));
		expect(purchase.cin7_updated_at.toISOString()).toBe("2026-03-05T10:00:00.342Z");
		expect(lines.map((l) => l.line_no)).toEqual([1, 2]);
		expect(lines[0]!.unit_cost_base).toBe("110.0000");
		expect(lines[1]!.unit_cost_base).toBe("44.0000"); // 50 less 20% = 40, x1.1
		expect(lines[1]!.discount_pct).toBe("20.00");
		expect(lines[1]!.total_base).toBe("44.0000");
	});

	it("blind receipt (no Order block, no OrderDate) maps with no lines, uncounted", () => {
		const raw = purchaseRaw({ OrderDate: null, CurrencyRate: null });
		delete raw.Order;
		const m = mapPurchase(raw, purchaseItem({ OrderDate: null }));
		expect(m.lines).toEqual([]);
		expect(m.purchase.counted).toBe(false);
		expect(m.purchase.order_date).toBeNull();
		expect(m.purchase.total).toBe("0.0000");
		const listed = mapPurchase(raw, purchaseItem());
		expect(listed.purchase.order_date).toEqual(new Date("2026-03-01T00:00:00.000Z"));
	});

	it("null-rate voided foreign purchase maps with zero base amounts", () => {
		const m = mapPurchase(
			purchaseRaw({ Status: "VOIDED", CurrencyRate: null }),
			purchaseItem({ Status: "VOIDED" })
		);
		expect(m.purchase.counted).toBe(false);
		expect(m.purchase.total_base).toBe("0.0000");
	});

	it("advanced purchase (StockReceived array) maps too; voided/draft not counted", () => {
		const adv: Cin7AdvancedPurchase = {
			...purchaseRaw(),
			Type: "Advanced Purchase",
			StockReceived: [{ Status: "AUTHORISED" }],
			Invoice: [{ Status: "AUTHORISED" }],
		};
		const m = mapPurchase(adv, purchaseItem({ Type: "Advanced Purchase" }));
		expect(m.purchase.type).toBe("Advanced Purchase");
		expect(m.purchase.counted).toBe(true);
		expect(
			mapPurchase(purchaseRaw({ Status: "VOIDED" }), purchaseItem()).purchase
				.counted
		).toBe(false);
		const draft = purchaseRaw();
		draft.Order!.Status = "DRAFT";
		expect(mapPurchase(draft, purchaseItem()).purchase.counted).toBe(false);
	});
});
