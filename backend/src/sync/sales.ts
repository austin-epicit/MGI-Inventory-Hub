import type { Prisma } from "../../generated/prisma/client.js";
import type { Db } from "../db.js";
import type { Cin7Sale, Cin7SaleListItem } from "../cin7/schemas.js";
import { cin7DateToDb, laterOf, parseCin7Timestamp } from "./dates.js";
import { baseConverter, dec2, dec4, dec6, netUnit } from "./money.js";

export type MappedSale = {
	sale: Omit<Prisma.saleUncheckedCreateInput, "synced_at" | "lines" | "cin7_updated_at"> & {
		cin7_updated_at: Date;
	};
	lines: Omit<Prisma.sale_lineCreateManyInput, "sale_id">[];
};

// FULFILLED and CLOSED are post-authorisation states of a sale that was real revenue.
const COUNTED_ORDER_STATUS = ["AUTHORISED", "AUTH_NO_ALLOC", "FULFILLED", "CLOSED"];
const optStr = (v: unknown): string | null => (typeof v === "string" ? v : null);

export function mapSale(raw: Cin7Sale, item: Cin7SaleListItem): MappedSale {
	const counted = COUNTED_ORDER_STATUS.includes(raw.Order.Status) && raw.Status !== "VOIDED";
	const conv = baseConverter(
		raw.CurrencyRate,
		raw.CustomerCurrency,
		raw.BaseCurrency,
		counted,
		raw.ID
	);
	const total = raw.Order.Total;
	return {
		sale: {
			id: raw.ID,
			order_number: raw.Order.SaleOrderNumber ?? item.OrderNumber,
			type: item.Type,
			status: raw.Status,
			order_status: item.OrderStatus,
			counted,
			customer_id: raw.CustomerID ?? null,
			customer_name: raw.Customer,
			price_tier_name: raw.PriceTier ?? null,
			order_date: cin7DateToDb(item.OrderDate),
			invoice_date: cin7DateToDb(item.InvoiceDate),
			currency: raw.CustomerCurrency,
			base_currency: raw.BaseCurrency,
			currency_rate: dec6(conv.rate),
			total: dec4(total),
			total_base: dec4(conv.toBase(total)),
			// COGSAmount is already in base currency per Cin7, so it is not converted.
			cogs_base: raw.COGSAmount == null ? null : dec4(raw.COGSAmount),
			invoice_status: optStr(item.CombinedInvoiceStatus),
			cin7_updated_at: laterOf(
				parseCin7Timestamp(item.Updated),
				parseCin7Timestamp(raw.LastModifiedOn)
			),
			raw: { list: item, detail: raw } as unknown as Prisma.InputJsonValue,
		},
		lines: raw.Order.Lines.map((l, i) => ({
			line_no: i + 1,
			product_id: l.ProductID,
			sku: l.SKU,
			name: l.Name,
			quantity: dec4(l.Quantity),
			unit_price: dec4(l.Price),
			discount_pct: dec2(l.Discount),
			unit_price_base: dec4(conv.toBase(netUnit(l.Price, l.Discount))),
			// Assumed base currency as given; Task 17 verifies against a live account.
			average_cost: l.AverageCost == null ? null : dec4(l.AverageCost),
			total_base: dec4(conv.toBase(l.Total)),
		})),
	};
}

// remap path: mapped columns only, so synced_at stays as the real sync left it.
export async function rewriteSale(db: Db, m: MappedSale): Promise<void> {
	const { id, ...data } = m.sale;
	await db.$transaction(async (tx) => {
		await tx.sale.update({ where: { id }, data });
		await tx.sale_line.deleteMany({ where: { sale_id: id } });
		await tx.sale_line.createMany({
			data: m.lines.map((l) => ({ ...l, sale_id: id })),
		});
	});
}

export async function upsertSale(db: Db, m: MappedSale, now: Date = new Date()): Promise<void> {
	const { id, ...data } = m.sale;
	await db.$transaction(async (tx) => {
		await tx.sale.upsert({
			where: { id },
			create: { id, ...data, synced_at: now },
			update: { ...data, synced_at: now },
		});
		await tx.sale_line.deleteMany({ where: { sale_id: id } });
		await tx.sale_line.createMany({
			data: m.lines.map((l) => ({ ...l, sale_id: id })),
		});
	});
}
