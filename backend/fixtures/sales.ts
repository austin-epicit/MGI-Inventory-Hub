import type { Cin7Sale, Cin7SaleLine, Cin7SaleListItem } from "../src/cin7/schemas.js";
import { TIER_NAMES, type Category } from "./catalog.js";
import { DAY, bizDate, bump, num5, r2, type GenContext } from "./context.js";
import type { Products } from "./products.js";
import type { Reference } from "./reference.js";

const QTY_SALE: Record<Category, [number, number]> = {
	Servers: [1, 3],
	Storage: [1, 4],
	Networking: [1, 3],
	Components: [1, 10],
};
const SALE_DISCOUNTS = [0, 0, 0, 0, 2, 3, 5, 7.5, 10, 12];
const SHIPPED = new Set(["INVOICING", "INVOICED", "COMPLETED"]);
const ALLOCATED = new Set(["ORDERED", "PICKING", "PACKED", "SHIPPING"]);

export type Sales = {
	sales: Cin7Sale[];
	saleList: Cin7SaleListItem[];
	sold: Map<string, number>;
	allocated: Map<string, number>;
};

export function buildSales(
	{ rng, asOfMs, randomDay, monthOf, stamp }: GenContext,
	{ me, locations, customers }: Reference,
	{ pickSlots }: Products
): Sales {
	// --- Sales --------------------------------------------------------------------------------
	const SALE_COUNT = 2000;
	const DRAFTS = Math.round(SALE_COUNT * 0.05);
	const VOIDS = Math.round(SALE_COUNT * 0.03);
	const saleSpecs = Array.from({ length: SALE_COUNT }, (_, k) => ({
		kind: k < DRAFTS ? "DRAFT" : k < DRAFTS + VOIDS ? "VOIDED" : "NORMAL",
		// Drafts are only plausible on recent days.
		day: k < DRAFTS ? asOfMs - rng.int(1, 45) * DAY : randomDay(),
	})).sort((a, b) => a.day - b.day);
	const customersByTier = (tier: string) => customers.filter((c) => c.PriceTier === tier);
	const sales: Cin7Sale[] = [];
	const saleList: Cin7SaleListItem[] = [];
	const sold = new Map<string, number>();
	const allocated = new Map<string, number>();
	const NORMAL_NEW = [
		"ORDERED",
		"PICKING",
		"PACKED",
		"SHIPPING",
		"INVOICING",
		"INVOICED",
		"COMPLETED",
	];
	let saleInvoiceSeq = 0;

	for (const [i, spec] of saleSpecs.entries()) {
		const day = spec.day;
		const m = monthOf(day);
		const age = Math.round((asOfMs - day) / DAY);
		const tier = rng.weighted([...TIER_NAMES], [30, 60, 10]); // Retail, Wholesale, Broker;
		const customer = rng.pick(customersByTier(tier));
		const cur = customer.Currency!;
		const rate = cur === "CAD" ? 0.73 : cur === "EUR" ? 1.08 : 1;
		const tierIdx = TIER_NAMES.indexOf(tier as (typeof TIER_NAMES)[number]);
		const status =
			spec.kind === "NORMAL"
				? age > 30
					? rng.weighted(["COMPLETED", "INVOICED"], [88, 12])
					: rng.weighted(NORMAL_NEW, [15, 10, 10, 10, 10, 15, 30])
				: spec.kind;
		const hasLines = status !== "DRAFT";
		const lines: Cin7SaleLine[] = hasLines
			? pickSlots(rng.weighted([1, 2, 3, 4], [35, 35, 20, 10]), m).map((s) => {
					const [lo, hi] = QTY_SALE[s.category];
					const quantity = rng.int(lo, hi);
					const discount = rng.pick(SALE_DISCOUNTS);
					const vec = s.points[m].tierPrices;
					const base = vec[tierIdx] || vec[0];
					const price = r2(base / rate);
					return {
						ProductID: s.rec.ID,
						SKU: s.rec.SKU,
						Name: s.rec.Name,
						Quantity: quantity,
						Price: price,
						Discount: discount,
						Tax: 0,
						AverageCost: s.points[m].averageCost,
						TaxRule: "Tax Exempt",
						Comment: "",
						DropShip: false,
						Backorder: false,
						BackorderQuantity: 0,
						Total: r2(quantity * price * (1 - discount / 100)),
					};
				})
			: [];
		const total = r2(lines.reduce((a, l) => a + l.Total, 0));
		const shipped = SHIPPED.has(status);
		const cogs = shipped
			? r2(lines.reduce((a, l) => a + l.Quantity * (l.AverageCost ?? 0), 0))
			: 0;
		if (status !== "VOIDED" && status !== "DRAFT") {
			for (const l of lines) {
				if (shipped) bump(sold, l.ProductID, l.Quantity);
				else if (ALLOCATED.has(status))
					bump(allocated, l.ProductID, l.Quantity);
			}
		}

		const orderStatus =
			status === "DRAFT"
				? "NOT AVAILABLE"
				: status === "VOIDED"
					? "VOIDED"
					: status === "COMPLETED"
						? "CLOSED"
						: "AUTHORISED";
		const quoteStatus =
			status === "DRAFT"
				? "DRAFT"
				: status === "VOIDED"
					? "VOIDED"
					: "AUTHORISED";
		const stage = (() => {
			const na = "NOT AVAILABLE";
			if (status === "VOIDED")
				return ["VOIDED", "VOIDED", "VOIDED", "VOIDED", "VOIDED", "VOIDED"];
			switch (status) {
				case "PICKING":
					return ["PICKING", na, na, na, "UNPAID", "NOT FULFILLED"];
				case "PACKED":
					return [
						"PICKED",
						"PACKED",
						na,
						na,
						"UNPAID",
						"NOT FULFILLED",
					];
				case "SHIPPING":
					return [
						"PICKED",
						"PACKED",
						"SHIPPING",
						na,
						"UNPAID",
						"NOT FULFILLED",
					];
				case "INVOICING":
					return [
						"PICKED",
						"PACKED",
						"SHIPPED",
						"DRAFT",
						"UNPAID",
						"FULFILLED",
					];
				case "INVOICED":
					return [
						"PICKED",
						"PACKED",
						"SHIPPED",
						"AUTHORISED",
						"UNPAID",
						"FULFILLED",
					];
				case "COMPLETED":
					return [
						"PICKED",
						"PACKED",
						"SHIPPED",
						"PAID",
						"PAID",
						"FULFILLED",
					];
				default:
					return [na, na, na, na, "UNPAID", "NOT FULFILLED"];
			}
		})();
		const [pick, pack, ship, invStatus, payStatus, fulfil] = stage;
		const invoiced = status === "INVOICED" || status === "COMPLETED";
		const invoiceDay = Math.min(asOfMs - DAY, day + rng.int(0, 3) * DAY);
		const invoiceNumber = invoiced ? num5(++saleInvoiceSeq, "INV") : null;
		const updated = stamp(day, status === "DRAFT" ? 0 : rng.int(0, Math.min(20, age)));
		const id = rng.guid();
		const orderNumber = num5(i + 1, "SO");
		const type = rng.chance(0.2) ? "Advanced Sale" : "Simple Sale";
		const invoiceLines = lines.map((l) => ({ ...l, Account: "200" }));

		sales.push({
			ID: id,
			Customer: customer.Name,
			CustomerID: customer.ID,
			Contact: "No Name",
			Phone: "",
			BaseCurrency: me.Currency,
			CustomerCurrency: cur,
			TaxRule: "Tax Exempt",
			TaxCalculation: "Exclusive",
			Terms: "30 days",
			PriceTier: tier,
			ShipBy: bizDate(day + 7 * DAY),
			Location: "Main Warehouse",
			SaleOrderDate: bizDate(day),
			LastModifiedOn: updated,
			Note: "",
			CustomerReference: "",
			COGSAmount: cogs,
			Status: status,
			CombinedPickingStatus: pick,
			CombinedPackingStatus: pack,
			CombinedShippingStatus: ship,
			FulFilmentStatus: fulfil,
			CombinedInvoiceStatus: invStatus,
			CombinedPaymentStatus: payStatus,
			CurrencyRate: rate,
			SalesRepresentative: "MGI Sales",
			ServiceOnly: false,
			Type: type,
			Order: {
				SaleOrderNumber: orderNumber,
				Memo: "",
				Status: orderStatus === "CLOSED" ? "AUTHORISED" : orderStatus,
				Lines: lines,
				AdditionalCharges: [],
				TotalBeforeTax: total,
				Tax: 0,
				Total: total,
			},
			Invoices: invoiced
				? [
						{
							TaskID: rng.guid(),
							InvoiceNumber: invoiceNumber,
							Memo: "",
							Status:
								status === "COMPLETED"
									? "PAID"
									: "AUTHORISED",
							InvoiceDate: bizDate(invoiceDay),
							InvoiceDueDate: bizDate(
								invoiceDay + 30 * DAY
							),
							CurrencyConversionRate: rate,
							Lines: invoiceLines,
							AdditionalCharges: [],
							TotalBeforeTax: total,
							Tax: 0,
							Total: total,
						},
					]
				: [],
			CreditNotes: [],
			InventoryMovements: shipped
				? lines.map((l) => ({
						TaskID: rng.guid(),
						ProductID: l.ProductID,
						Date: bizDate(invoiceDay),
						COGS: r2(l.Quantity * (l.AverageCost ?? 0)),
					}))
				: [],
			ExternalID: null,
		});
		saleList.push({
			SaleID: id,
			OrderNumber: orderNumber,
			Status: status,
			OrderDate: bizDate(day),
			InvoiceDate: invoiced ? bizDate(invoiceDay) : null,
			Customer: customer.Name,
			CustomerID: customer.ID,
			InvoiceNumber: invoiceNumber,
			CustomerReference: "",
			InvoiceAmount: invoiced ? total : 0,
			PaidAmount: status === "COMPLETED" ? total : 0,
			SaleInvoicesTotalAmount: invoiced ? total : 0,
			InvoiceDueDate: invoiced ? bizDate(invoiceDay + 30 * DAY) : null,
			ShipBy: bizDate(day + 7 * DAY),
			BaseCurrency: me.Currency,
			CustomerCurrency: cur,
			CreditNoteNumber: null,
			Updated: updated,
			QuoteStatus: quoteStatus,
			OrderStatus: orderStatus,
			CombinedPickingStatus: pick,
			CombinedPackingStatus: pack,
			CombinedShippingStatus: ship,
			FulFilmentStatus: fulfil,
			CombinedInvoiceStatus: invStatus,
			CombinedPaymentTotal: status === "COMPLETED" ? total : 0,
			CreditNoteStatus: "NOT AVAILABLE",
			CombinedPaymentStatus: payStatus,
			Type: type,
			CombinedTrackingNumbers: "",
			SourceChannel: null,
			ExternalID: null,
			OrderLocationID: locations[0].ID,
		});
	}

	return { sales, saleList, sold, allocated };
}
