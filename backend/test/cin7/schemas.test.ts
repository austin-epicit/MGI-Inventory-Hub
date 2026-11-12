import { describe, expect, it } from "vitest";
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
	Cin7Webhook,
} from "../../src/cin7/schemas.js";
import { Cin7ParseError } from "../../src/cin7/source.js";

describe("Cin7 schemas", () => {
	it("keeps unknown fields (passthrough)", () => {
		const me = Cin7Me.parse({
			Company: "A",
			Currency: "USD",
			TimeZone: "UTC",
			LockDate: null,
		});
		expect(me).toHaveProperty("LockDate", null);
	});

	it("requires only the mapped fields", () => {
		expect(
			Cin7PriceTiers.parse({ PriceTiers: [{ Code: 1, Name: "Retail" }] })
		).toBeTruthy();
		expect(() => Cin7PriceTiers.parse({ PriceTiers: [{ Code: 1 }] })).toThrow();
		expect(() => Cin7LocationPage.parse({ Total: 1, Page: 1 })).toThrow();
		expect(() =>
			Cin7SaleListPage.parse({ Total: 1, Page: 1, SaleList: [{ SaleID: "x" }] })
		).toThrow();
	});

	it("accepts the documented minimal shapes", () => {
		expect(
			Cin7Webhook.parse({
				ID: "1",
				Type: "Sale/OrderAuthorised",
				IsActive: true,
				ExternalURL: "https://x.example/hook",
				ExternalAuthorizationType: "noauth",
			})
		).toBeTruthy();
		expect(
			Cin7SupplierPage.parse({ Total: 0, Page: 1, SupplierList: [] })
		).toBeTruthy();
		expect(
			Cin7CustomerPage.parse({ Total: 0, Page: 1, CustomerList: [] })
		).toBeTruthy();
		expect(Cin7ProductPage.parse({ Total: 0, Page: 1, Products: [] })).toBeTruthy();
		expect(
			Cin7AvailabilityPage.parse({
				Total: 0,
				Page: 1,
				ProductAvailabilityList: [],
			})
		).toBeTruthy();
		expect(
			Cin7PurchaseListPage.parse({ Total: 0, Page: 1, PurchaseList: [] })
		).toBeTruthy();
	});

	it("rejects a sale and purchases missing their order block", () => {
		expect(() => Cin7Sale.parse({ ID: "x" })).toThrow();
		expect(() => Cin7Purchase.parse({ ID: "x" })).toThrow();
		expect(() => Cin7AdvancedPurchase.parse({ ID: "x" })).toThrow();
	});

	it("Cin7ParseError keeps at most a 2 KB body excerpt", () => {
		const err = new Cin7ParseError("bad", "x".repeat(5000));
		expect(err.bodyExcerpt).toHaveLength(2048);
	});
});

describe("Cin7AdvancedPurchase Type", () => {
	const base = {
		ID: "x",
		Supplier: "S",
		BaseCurrency: "USD",
		SupplierCurrency: "USD",
		OrderNumber: "PO-1",
		Status: "COMPLETED",
		LastUpdatedDate: "2026-03-01T00:00:00",
	};
	it.each(["Simple Purchase", "Advanced Purchase", "Service Purchase"])(
		"accepts %s",
		(Type) => {
			expect(Cin7AdvancedPurchase.safeParse({ ...base, Type }).success).toBe(
				true
			);
		}
	);
	it("rejects an unknown type, and accepts a blind receipt with no Order/OrderDate/rate", () => {
		expect(Cin7AdvancedPurchase.safeParse({ ...base, Type: "Mystery" }).success).toBe(
			false
		);
		expect(
			Cin7AdvancedPurchase.safeParse({
				...base,
				Type: "Advanced Purchase",
				CurrencyRate: null,
			}).success
		).toBe(true);
	});
});
