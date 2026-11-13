import type { Prisma } from "../../generated/prisma/client.js";
import type { Db } from "../db.js";
import type { Cin7Sale, Cin7SaleListItem } from "../cin7/schemas.js";
import { cin7DateToDb, laterOf, parseCin7Timestamp } from "./dates.js";
import { baseConverter, dec2, dec4, dec6, netUnit, round4 } from "./money.js";

// Non-zero UUID: the id column is @db.Uuid, and Cin7 stubs use the all-zero GUID.
const REAL_UUID =
	/^(?!0{8}-0{4}-0{4}-0{4}-0{12}$)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type MappedSale = {
	sale: Omit<Prisma.saleUncheckedCreateInput, "synced_at" | "lines" | "cin7_updated_at"> & {
		cin7_updated_at: Date;
	};
	lines: Omit<Prisma.sale_lineCreateManyInput, "sale_id">[];
	creditNotes: {
		note: Omit<Prisma.sale_credit_noteCreateManyInput, "sale_id">;
		lines: Omit<Prisma.sale_credit_lineCreateManyInput, "credit_note_id">[];
	}[];
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
	// Reversed cost: the first sale line of the same product; the writer falls back to the product.
	const saleCost = new Map<string, number | null>();
	for (const l of raw.Order.Lines)
		if (!saleCost.has(l.ProductID)) saleCost.set(l.ProductID, l.AverageCost ?? null);
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
		creditNotes: (raw.CreditNotes ?? []).flatMap((cn) => {
			// A stub note (no usable id/status) is dropped so it can never fail the sale write.
			const noteId = cn.TaskID ?? "";
			if (!cn.Status || cn.Status === "NOT AVAILABLE" || !REAL_UUID.test(noteId))
				return [];
			// A draft/voided note is stored but never counted, so it must not fail on a bad rate.
			const counted = cn.Status === "AUTHORISED" && raw.Status !== "VOIDED";
			const rate = baseConverter(
				cn.CreditNoteConversionRate != null &&
					cn.CreditNoteConversionRate > 0
					? cn.CreditNoteConversionRate
					: raw.CurrencyRate,
				raw.CustomerCurrency,
				raw.BaseCurrency,
				counted,
				raw.ID
			);
			const lines = (cn.Lines ?? []).map((l, i) => {
				const qty = l.Quantity ?? 0;
				const unit = rate.toBase(netUnit(l.Price ?? 0, l.Discount ?? 0));
				return {
					line_no: i + 1,
					product_id: l.ProductID ?? null,
					sku: l.SKU ?? "",
					name: l.Name ?? "",
					quantity: dec4(qty),
					unit_price_base: dec4(unit),
					total_base: dec4(round4(qty * unit)),
					average_cost:
						l.ProductID != null &&
						saleCost.get(l.ProductID) != null
							? dec4(saleCost.get(l.ProductID)!)
							: null,
				};
			});
			const totalBase = lines.reduce((a, l) => a + Number(l.total_base), 0);
			return [
				{
					note: {
						id: noteId,
						number: cn.CreditNoteNumber ?? null,
						credit_date: cin7DateToDb(cn.CreditNoteDate),
						status: cn.Status,
						counted,
						currency_rate: dec6(rate.rate),
						total_base: dec4(round4(totalBase)),
					},
					lines,
				},
			];
		}),
	};
}

// Cost reversal falls back to the product's current average cost when the sale line has none.
async function replaceCreditNotes(tx: Prisma.TransactionClient, m: MappedSale): Promise<void> {
	const saleId = m.sale.id;
	await tx.sale_credit_note.deleteMany({ where: { sale_id: saleId } }); // lines cascade
	if (m.creditNotes.length === 0) return;
	const missing = [
		...new Set(
			m.creditNotes.flatMap((c) =>
				c.lines
					.filter((l) => l.average_cost == null && l.product_id)
					.map((l) => l.product_id!)
			)
		),
	];
	const costs = new Map(
		(
			await tx.product.findMany({
				where: { id: { in: missing } },
				select: { id: true, average_cost: true },
			})
		).map((p) => [p.id, p.average_cost.toFixed(4)])
	);
	// A note id could belong to another sale if Cin7 re-parents it; take it over.
	await tx.sale_credit_note.deleteMany({
		where: { id: { in: m.creditNotes.map((c) => c.note.id!) } },
	});
	await tx.sale_credit_note.createMany({
		data: m.creditNotes.map((c) => ({ ...c.note, sale_id: saleId })),
	});
	await tx.sale_credit_line.createMany({
		data: m.creditNotes.flatMap((c) =>
			c.lines.map((l) => ({
				...l,
				average_cost:
					l.average_cost ??
					(l.product_id ? (costs.get(l.product_id) ?? null) : null),
				credit_note_id: c.note.id!,
			}))
		),
	});
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
		await replaceCreditNotes(tx, m);
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
		await replaceCreditNotes(tx, m);
	});
}
