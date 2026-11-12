import type {
	Cin7AdvancedPurchase,
	Cin7Purchase,
	Cin7PurchaseLine,
	Cin7PurchaseListItem,
} from "../src/cin7/schemas.js";
import type { Category } from "./catalog.js";
import { DAY, bizDate, bump, cin7Stamp, num5, r2, r4, type GenContext } from "./context.js";
import { parseCin7Stamp } from "../src/cin7/timestamps.js";
import type { Products } from "./products.js";
import type { Reference } from "./reference.js";

const QTY_PURCHASE: Record<Category, [number, number]> = {
	Servers: [2, 10],
	Storage: [2, 12],
	Networking: [2, 8],
	Components: [8, 60],
};
const RECEIVED = new Set(["RECEIVED", "INVOICED", "COMPLETED"]);
const ON_ORDER = new Set(["ORDERING", "ORDERED", "RECEIVING"]);

export type Purchases = {
	purchases: (Cin7Purchase | Cin7AdvancedPurchase)[];
	purchaseList: Cin7PurchaseListItem[];
	lastPurchaseStamp: Map<string, string>;
	onOrder: Map<string, number>;
	received: Map<string, number>;
};

export function buildPurchases(
	{ rng, asOfMs, randomDay, monthOf, stamp }: GenContext,
	{ me, suppliers, locations }: Reference,
	{ pickSlots }: Products
): Purchases {
	// --- Purchases ----------------------------------------------------------------------------
	const lastPurchaseStamp = new Map<string, string>();
	const onOrder = new Map<string, number>();
	const received = new Map<string, number>();

	const PURCHASE_COUNT = 600;
	const purchaseDays = Array.from({ length: PURCHASE_COUNT }, randomDay).sort(
		(a, b) => a - b
	);
	const voidAt = new Set([0.1, 0.35, 0.6, 0.85].map((f) => Math.floor(PURCHASE_COUNT * f)));
	const purchases: (Cin7Purchase | Cin7AdvancedPurchase)[] = [];
	const purchaseList: Cin7PurchaseListItem[] = [];
	let invoiceSeq = 0;

	for (const [i, day] of purchaseDays.entries()) {
		const m = monthOf(day);
		const supplier = rng.weighted(
			suppliers,
			[3, 3, 3, 2, 2, 2, 2, 1.5, 1.5, 1, 1, 1.5]
		);
		const advanced = rng.chance(0.15);
		const age = Math.round((asOfMs - day) / DAY);
		const rate = supplier.Currency === "CAD" ? r4(rng.float(0.71, 0.75)) : 1;
		const lines: Cin7PurchaseLine[] = pickSlots(rng.int(1, 5), m).map((s) => {
			const [lo, hi] = QTY_PURCHASE[s.category];
			const quantity = rng.int(lo, hi);
			const discount = rng.chance(0.15) ? rng.pick([2, 3, 5]) : 0;
			const price = r2((s.points[m].averageCost * rng.float(0.99, 1.01)) / rate);
			return {
				ProductID: s.rec.ID,
				SKU: s.rec.SKU,
				Name: s.rec.Name,
				Quantity: quantity,
				Price: price,
				Discount: discount,
				Tax: 0,
				TaxRule: "Tax Exempt",
				SupplierSKU: "",
				Comment: "",
				Total: r2(quantity * price * (1 - discount / 100)),
			};
		});
		const charges = rng.chance(0.3)
			? [
					{
						Description: "Freight",
						Reference: "",
						Price: r2(rng.float(50, 250)),
						Quantity: 1,
						Discount: 0,
						Tax: 0,
						Total: 0,
						TaxRule: "Tax Exempt",
					},
				]
			: [];
		for (const c of charges) c.Total = c.Price;
		const total = r2(
			lines.reduce((a, l) => a + l.Total, 0) +
				charges.reduce((a, c) => a + c.Total, 0)
		);

		const status = voidAt.has(i)
			? "VOIDED"
			: age > 40
				? rng.weighted(["COMPLETED", "INVOICED", "RECEIVED"], [70, 20, 10])
				: age < 10 && rng.chance(0.25)
					? "ORDERING"
					: rng.weighted(
							[
								"ORDERED",
								"RECEIVING",
								"RECEIVED",
								"INVOICED",
							],
							[25, 15, 30, 30]
						);
		const orderStatus =
			status === "VOIDED"
				? "VOIDED"
				: status === "ORDERING"
					? "DRAFT"
					: "AUTHORISED";
		const receivedStatus = RECEIVED.has(status)
			? "AUTHORISED"
			: status === "RECEIVING"
				? "DRAFT"
				: "NOT AVAILABLE";
		const invoiced = status === "INVOICED" || status === "COMPLETED";
		const invoiceStatus = invoiced ? "AUTHORISED" : "NOT AVAILABLE";
		const combReceiving =
			status === "VOIDED"
				? "VOIDED"
				: RECEIVED.has(status)
					? "FULLY RECEIVED"
					: status === "RECEIVING"
						? "PARTIALLY RECEIVED"
						: "NOT RECEIVED";
		const combInvoice =
			status === "VOIDED" ? "VOIDED" : invoiced ? "INVOICED" : "NOT INVOICED";
		const combPayment =
			status === "VOIDED" ? "VOIDED" : status === "COMPLETED" ? "PAID" : "UNPAID";
		const updated = stamp(
			day,
			status === "ORDERING" ? 0 : rng.int(1, Math.min(30, Math.max(1, age))),
			true
		);
		const id = rng.guid();
		const orderNumber = num5(i + 1, "PO");
		const type = advanced ? "Advanced Purchase" : "Simple Purchase";

		if (status !== "VOIDED") {
			for (const l of lines) {
				if (RECEIVED.has(status)) bump(received, l.ProductID, l.Quantity);
				else if (ON_ORDER.has(status))
					bump(onOrder, l.ProductID, l.Quantity);
				lastPurchaseStamp.set(
					l.ProductID,
					cin7Stamp(parseCin7Stamp(updated).getTime())
				);
			}
		}

		const stockLines = lines.map((l) => {
			const loc = rng.weighted(locations, [7, 2, 1]);
			return {
				Date: bizDate(day + rng.int(2, 10) * DAY),
				Quantity: l.Quantity,
				ProductID: l.ProductID,
				SKU: l.SKU,
				Name: l.Name,
				Location: loc.Name,
				LocationID: loc.ID,
				Received: true,
				BatchSN: null,
				SupplierSKU: "",
				ExpiryDate: null,
			};
		});
		const stockBlock = {
			Status: receivedStatus,
			Lines: RECEIVED.has(status) ? stockLines : [],
		};
		const invoiceBlock = {
			InvoiceDate: bizDate(day + 3 * DAY),
			InvoiceDueDate: bizDate(day + 33 * DAY),
			InvoiceNumber: invoiced ? `SUP-${5000 + ++invoiceSeq}` : null,
			Status: invoiceStatus,
			Lines: invoiced ? lines : [],
			AdditionalCharges: invoiced ? charges : [],
			Total: invoiced ? total : 0,
			Paid: status === "COMPLETED" ? total : 0,
		};
		const header = {
			ID: id,
			SupplierID: supplier.ID,
			Supplier: supplier.Name,
			Contact: "No Name",
			Phone: "",
			BlindReceipt: false,
			Approach: "INVOICE",
			BaseCurrency: me.Currency,
			SupplierCurrency: supplier.Currency!,
			TaxRule: "Tax Exempt",
			TaxCalculation: "Exclusive",
			Terms: "30 days",
			RequiredBy: null,
			Location: "Main Warehouse",
			Note: "",
			OrderNumber: orderNumber,
			OrderDate: bizDate(day),
			Status: status,
			RelatedDropShipSaleTask: null,
			CurrencyRate: rate,
			LastUpdatedDate: updated,
			Order: {
				Memo: "",
				Status: orderStatus,
				Lines: lines,
				AdditionalCharges: charges,
				Prepayments: [],
				TotalBeforeTax: total,
				Tax: 0,
				Total: total,
			},
		};
		purchases.push(
			advanced
				? {
						...header,
						Type: "Advanced Purchase",
						CombinedInvoiceStatus: combInvoice,
						CombinedReceivingStatus: combReceiving,
						CombinedPaymentStatus: combPayment,
						IsServiceOnly: false,
						StockReceived: RECEIVED.has(status)
							? [stockBlock]
							: [],
						PutAway: [],
						Invoice: invoiced ? [invoiceBlock] : [],
						CreditNote: [],
					}
				: {
						...header,
						StockReceived: stockBlock,
						Invoice: invoiceBlock,
						CreditNote: null,
					}
		);
		purchaseList.push({
			ID: id,
			BlindReceipt: false,
			OrderNumber: orderNumber,
			Status: status,
			OrderDate: bizDate(day),
			InvoiceDate: invoiced ? invoiceBlock.InvoiceDate : null,
			Supplier: supplier.Name,
			SupplierID: supplier.ID,
			InvoiceNumber: invoiceBlock.InvoiceNumber,
			InvoiceAmount: invoiced ? total : 0,
			PaidAmount: status === "COMPLETED" ? total : 0,
			InvoiceDueDate: invoiced ? invoiceBlock.InvoiceDueDate : null,
			RequiredBy: null,
			BaseCurrency: me.Currency,
			SupplierCurrency: supplier.Currency!,
			CreditNoteNumber: null,
			OrderStatus: orderStatus,
			StockReceivedStatus: receivedStatus,
			UnstockStatus: "NOT AVAILABLE",
			InvoiceStatus: invoiceStatus,
			CreditNoteStatus: "NOT AVAILABLE",
			LastUpdatedDate: updated,
			Type: type,
			CombinedInvoiceStatus: combInvoice,
			CombinedPaymentStatus: combPayment,
			CombinedReceivingStatus: combReceiving,
			IsServiceOnly: false,
			DropShipTaskID: null,
		});
	}

	addServicePurchases();

	return { purchases, purchaseList, lastPurchaseStamp, onOrder, received };

	// Service purchases (freight, customs): no lines, only additional charges. Built without the
	// PRNG so adding them leaves every other generated record unchanged.
	function addServicePurchases() {
		const usd = suppliers.filter((s) => s.Currency === "USD");
		const picks = [100, 300, 500].map((di, k) => ({
			day: purchaseDays[di]!,
			supplier: usd[k]!,
		}));
		for (const [k, { day, supplier }] of picks.entries()) {
			const id = `00000000-0000-4000-8000-5e57000000${String(k + 1).padStart(2, "0")}`;
			const orderNumber = num5(PURCHASE_COUNT + k + 1, "PO");
			const price = 180 + k * 95;
			const charge = {
				Description: ["Freight", "Customs brokerage", "Handling"][k]!,
				Reference: "",
				Price: price,
				Quantity: 1,
				Discount: 0,
				Tax: 0,
				Total: price,
				TaxRule: "Tax Exempt",
			};
			const updated = cin7Stamp(day + 9 * 3_600_000, false);
			const invoiceDate = bizDate(day + DAY);
			purchases.push({
				ID: id,
				SupplierID: supplier.ID,
				Supplier: supplier.Name,
				Contact: "No Name",
				Phone: "",
				BlindReceipt: false,
				Approach: "INVOICE",
				BaseCurrency: me.Currency,
				SupplierCurrency: supplier.Currency!,
				TaxRule: "Tax Exempt",
				TaxCalculation: "Exclusive",
				Terms: "30 days",
				RequiredBy: null,
				Location: "Main Warehouse",
				Note: "",
				OrderNumber: orderNumber,
				OrderDate: bizDate(day),
				Status: "COMPLETED",
				RelatedDropShipSaleTask: null,
				CurrencyRate: 1,
				LastUpdatedDate: updated,
				Order: {
					Memo: "",
					Status: "AUTHORISED",
					Lines: [],
					AdditionalCharges: [charge],
					Prepayments: [],
					TotalBeforeTax: price,
					Tax: 0,
					Total: price,
				},
				Type: "Service Purchase",
				CombinedInvoiceStatus: "INVOICED",
				CombinedReceivingStatus: "NOT RECEIVED",
				CombinedPaymentStatus: "PAID",
				IsServiceOnly: true,
				StockReceived: [],
				PutAway: [],
				Invoice: [
					{
						InvoiceDate: invoiceDate,
						InvoiceDueDate: bizDate(day + 31 * DAY),
						InvoiceNumber: `SUP-${9000 + k}`,
						Status: "AUTHORISED",
						Lines: [],
						AdditionalCharges: [charge],
						Total: price,
						Paid: price,
					},
				],
				CreditNote: [],
			});
			purchaseList.push({
				ID: id,
				BlindReceipt: false,
				OrderNumber: orderNumber,
				Status: "COMPLETED",
				OrderDate: bizDate(day),
				InvoiceDate: invoiceDate,
				Supplier: supplier.Name,
				SupplierID: supplier.ID,
				InvoiceNumber: `SUP-${9000 + k}`,
				InvoiceAmount: price,
				PaidAmount: price,
				InvoiceDueDate: bizDate(day + 31 * DAY),
				RequiredBy: null,
				BaseCurrency: me.Currency,
				SupplierCurrency: supplier.Currency!,
				CreditNoteNumber: null,
				OrderStatus: "AUTHORISED",
				StockReceivedStatus: "NOT AVAILABLE",
				UnstockStatus: "NOT AVAILABLE",
				InvoiceStatus: "AUTHORISED",
				CreditNoteStatus: "NOT AVAILABLE",
				LastUpdatedDate: updated,
				Type: "Service Purchase",
				CombinedInvoiceStatus: "INVOICED",
				CombinedPaymentStatus: "PAID",
				CombinedReceivingStatus: "NOT RECEIVED",
				IsServiceOnly: true,
				DropShipTaskID: null,
			});
		}
	}
}
