import type { Prisma } from "../../generated/prisma/client.js";
import type { Db } from "../db.js";
import type { Cin7AdvancedPurchase, Cin7Purchase, Cin7PurchaseListItem } from "../cin7/schemas.js";
import { cin7DateToDb, laterOf, parseCin7Timestamp } from "./dates.js";
import { baseConverter, dec2, dec4, dec6, netUnit } from "./money.js";

type PurchaseRaw = Cin7Purchase | Cin7AdvancedPurchase;

export type MappedPurchase = {
	purchase: Omit<
		Prisma.purchaseUncheckedCreateInput,
		"synced_at" | "lines" | "cin7_updated_at"
	> & {
		cin7_updated_at: Date;
	};
	lines: Omit<Prisma.purchase_lineCreateManyInput, "purchase_id">[];
};

const optStr = (v: unknown): string | null => (typeof v === "string" ? v : null);

export function mapPurchase(raw: PurchaseRaw, item: Cin7PurchaseListItem): MappedPurchase {
	const order = raw.Order;
	const counted = order?.Status === "AUTHORISED" && raw.Status !== "VOIDED";
	const conv = baseConverter(
		raw.CurrencyRate,
		raw.SupplierCurrency,
		raw.BaseCurrency,
		counted,
		raw.ID
	);
	const total = order?.Total ?? 0;
	return {
		purchase: {
			id: raw.ID,
			order_number: raw.OrderNumber,
			type: item.Type,
			status: raw.Status,
			order_status: item.OrderStatus,
			counted,
			supplier_id: raw.SupplierID ?? null,
			supplier_name: raw.Supplier,
			// The simple-purchase detail has no order date, so the list item is the source for both kinds.
			order_date: cin7DateToDb(item.OrderDate),
			currency: raw.SupplierCurrency,
			base_currency: raw.BaseCurrency,
			currency_rate: dec6(conv.rate),
			total: dec4(total),
			total_base: dec4(conv.toBase(total)),
			receiving_status: optStr(item.CombinedReceivingStatus),
			invoice_status: optStr(item.CombinedInvoiceStatus),
			cin7_updated_at: laterOf(
				parseCin7Timestamp(item.LastUpdatedDate),
				parseCin7Timestamp(raw.LastUpdatedDate)
			),
			raw: { list: item, detail: raw } as unknown as Prisma.InputJsonValue,
		},
		lines: (order?.Lines ?? []).map((l, i) => ({
			line_no: i + 1,
			product_id: l.ProductID,
			sku: l.SKU,
			name: l.Name,
			quantity: dec4(l.Quantity),
			unit_price: dec4(l.Price),
			discount_pct: dec2(l.Discount),
			unit_cost_base: dec4(conv.toBase(netUnit(l.Price, l.Discount))),
			total_base: dec4(conv.toBase(l.Total)),
		})),
	};
}

// remap path: mapped columns only, so synced_at stays as the real sync left it.
export async function rewritePurchase(db: Db, m: MappedPurchase): Promise<void> {
	const { id, ...data } = m.purchase;
	await db.$transaction(async (tx) => {
		await tx.purchase.update({ where: { id }, data });
		await tx.purchase_line.deleteMany({ where: { purchase_id: id } });
		await tx.purchase_line.createMany({
			data: m.lines.map((l) => ({ ...l, purchase_id: id })),
		});
	});
}

export async function upsertPurchase(
	db: Db,
	m: MappedPurchase,
	now: Date = new Date()
): Promise<void> {
	const { id, ...data } = m.purchase;
	await db.$transaction(async (tx) => {
		await tx.purchase.upsert({
			where: { id },
			create: { id, ...data, synced_at: now },
			update: { ...data, synced_at: now },
		});
		await tx.purchase_line.deleteMany({ where: { purchase_id: id } });
		await tx.purchase_line.createMany({
			data: m.lines.map((l) => ({ ...l, purchase_id: id })),
		});
	});
}
