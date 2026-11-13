import type { Cin7Sale } from "../src/cin7/schemas.js";
import { DAY, bizDate, num5, r2, type GenContext } from "./context.js";

const CREDIT_RATE = 0.04;
const DRAFT_RATE = 0.1;
const MIN_LAG = 3;
const MAX_LAG = 30;

// Attaches at most one credit note to ~4% of normal sales. Runs after every other section so
// its draws never shift the existing fixture values; it mutates the sales in place.
export function addCreditNotes({ rng, asOfMs }: GenContext, sales: Cin7Sale[]): void {
	let seq = 0;
	for (const sale of sales) {
		if (sale.Status === "DRAFT" || sale.Status === "VOIDED") continue;
		const orderMs = Date.parse(`${sale.SaleOrderDate!.slice(0, 10)}T00:00:00Z`);
		if (orderMs > asOfMs - MIN_LAG * DAY) continue;
		if (!rng.chance(CREDIT_RATE)) continue;
		const noteMs = Math.min(asOfMs, orderMs + rng.int(MIN_LAG, MAX_LAG) * DAY);
		const line = rng.pick(sale.Order.Lines);
		const quantity = rng.int(1, line.Quantity);
		const status = rng.chance(DRAFT_RATE) ? "DRAFT" : "AUTHORISED";
		const total = r2(quantity * line.Price * (1 - line.Discount / 100));
		sale.CreditNotes = [
			{
				TaskID: rng.guid(),
				CreditNoteNumber: num5(++seq, "CN"),
				CreditNoteDate: bizDate(noteMs),
				Status: status,
				CreditNoteConversionRate: sale.CurrencyRate ?? 1,
				Lines: [
					{
						ProductID: line.ProductID,
						SKU: line.SKU,
						Name: line.Name,
						Quantity: quantity,
						Price: line.Price,
						Discount: line.Discount,
						Tax: 0,
						Total: total,
					},
				],
				AdditionalCharges: [],
				TotalBeforeTax: total,
				Tax: 0,
				Total: total,
			},
		];
	}
}
