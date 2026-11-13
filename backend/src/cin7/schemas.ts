import { z } from "zod";

// Cin7 Core API v2 response contracts. Only the fields the sync maps are required; everything else
// passes through untouched so `raw` columns keep the full record. Cin7 returns nulls freely.
const str = z.string();
const strN = z.string().nullish();
const num = z.number();
const pageOf = <K extends string, T extends z.ZodType>(key: K, item: T) =>
	z
		.object({ Total: num, Page: num })
		.extend({ [key]: z.array(item) } as { [P in K]: z.ZodArray<T> });

export const Cin7Me = z.object({ Company: str, Currency: str, TimeZone: str }).passthrough();

export const Cin7PriceTier = z.object({ Code: z.number().int(), Name: str }).passthrough();
export const Cin7PriceTiers = z.object({ PriceTiers: z.array(Cin7PriceTier) }).passthrough();

export const Cin7Location = z
	.object({
		ID: str,
		Name: str,
		IsDefault: z.boolean().optional(),
		IsDeprecated: z.boolean().optional(),
	})
	.passthrough();
export const Cin7LocationPage = pageOf("LocationList", Cin7Location).passthrough();

export const Cin7Supplier = z
	.object({
		ID: str,
		Name: str,
		Currency: strN,
		Status: strN,
		LastModifiedOn: strN,
	})
	.passthrough();
export const Cin7SupplierPage = pageOf("SupplierList", Cin7Supplier).passthrough();

export const Cin7Customer = z
	.object({
		ID: str,
		Name: str,
		Currency: strN,
		PriceTier: strN,
		Status: strN,
		LastModifiedOn: strN,
	})
	.passthrough();
export const Cin7CustomerPage = pageOf("CustomerList", Cin7Customer).passthrough();

// GET /product/attachments returns IsDefault as the strings "true"/"false"; the embedded list omits it.
export const Cin7Attachment = z
	.object({
		ID: str,
		ContentType: str,
		FileName: str,
		DownloadUrl: str,
		IsDefault: z.union([z.boolean(), z.string()]).optional(),
	})
	.passthrough();

export const Cin7Product = z
	.object({
		ID: str,
		SKU: str,
		Name: str,
		Category: strN,
		Brand: strN,
		Type: str,
		Status: str,
		UOM: strN,
		Barcode: strN,
		PriceTier1: num,
		PriceTier2: num,
		PriceTier3: num,
		PriceTier4: num,
		PriceTier5: num,
		PriceTier6: num,
		PriceTier7: num,
		PriceTier8: num,
		PriceTier9: num,
		PriceTier10: num,
		PriceTiers: z.record(str, num).nullish(),
		AverageCost: num,
		LastModifiedOn: strN,
		Attachments: z.array(Cin7Attachment).nullish(),
	})
	.passthrough();
export const Cin7ProductPage = pageOf("Products", Cin7Product).passthrough();

export const Cin7Availability = z
	.object({
		ID: str,
		SKU: str,
		Name: str,
		Location: str,
		Bin: strN,
		Batch: strN,
		OnHand: num,
		Allocated: num,
		Available: num,
		OnOrder: num,
		InTransit: num,
		StockOnHand: num.nullish(),
	})
	.passthrough();
export const Cin7AvailabilityPage = pageOf(
	"ProductAvailabilityList",
	Cin7Availability
).passthrough();

export const Cin7SaleListItem = z
	.object({
		SaleID: str,
		OrderNumber: str,
		Status: str,
		OrderDate: str,
		InvoiceDate: strN,
		Customer: str,
		CustomerID: strN,
		BaseCurrency: str.optional(),
		CustomerCurrency: str.optional(),
		Updated: str,
		OrderStatus: str,
		Type: str,
	})
	.passthrough();
export const Cin7SaleListPage = pageOf("SaleList", Cin7SaleListItem).passthrough();

export const Cin7SaleLine = z
	.object({
		ProductID: str,
		SKU: str,
		Name: str,
		Quantity: num,
		Price: num,
		Discount: num,
		Tax: num,
		AverageCost: num.nullish(),
		Total: num,
	})
	.passthrough();

const saleBlock = z
	.object({
		Status: str,
		Lines: z.array(Cin7SaleLine),
		AdditionalCharges: z.array(z.object({ Total: num }).passthrough()).nullish(),
		TotalBeforeTax: num,
		Tax: num,
		Total: num,
	})
	.passthrough();

const Cin7SaleCreditLine = z
	.object({
		ProductID: strN,
		SKU: strN,
		Name: strN,
		Quantity: num.nullish(),
		Price: num.nullish(),
		Discount: num.nullish(),
		Tax: num.nullish(),
		Total: num.nullish(),
	})
	.passthrough();

// Money comes from the lines; header totals and AdditionalCharges are ignored, so they stay optional.
// TaskID/Status are nullish so a stub note can't fail the sale; mapSale drops the invalid ones.
const Cin7SaleCreditNote = z
	.object({
		TaskID: strN,
		CreditNoteNumber: strN,
		CreditNoteDate: strN,
		Status: strN,
		CreditNoteConversionRate: num.nullish(),
		Lines: z.array(Cin7SaleCreditLine).nullish(),
	})
	.passthrough();

export const Cin7Sale = z
	.object({
		ID: str,
		Customer: str,
		CustomerID: strN,
		BaseCurrency: str,
		CustomerCurrency: str,
		PriceTier: strN,
		SaleOrderDate: strN,
		LastModifiedOn: str,
		Status: str,
		CurrencyRate: num.nullish(),
		COGSAmount: num.nullish(),
		Type: str,
		// A quote-stage sale has no SaleOrderNumber yet; the list item's OrderNumber stands in.
		Order: saleBlock.extend({ SaleOrderNumber: strN }),
		Invoices: z
			.array(
				z
					.object({
						InvoiceNumber: strN,
						InvoiceDate: strN,
						Status: str,
						Lines: z.array(Cin7SaleLine),
					})
					.passthrough()
			)
			.nullish(),
		CreditNotes: z.array(Cin7SaleCreditNote).nullish(),
		InventoryMovements: z
			.array(z.object({ ProductID: str, Date: str, COGS: num }).passthrough())
			.nullish(),
	})
	.passthrough();

export const Cin7PurchaseListItem = z
	.object({
		ID: str,
		OrderNumber: str,
		Status: str,
		OrderDate: strN,
		InvoiceDate: strN,
		Supplier: str,
		SupplierID: strN,
		BaseCurrency: str.optional(),
		SupplierCurrency: str.optional(),
		LastUpdatedDate: str,
		OrderStatus: str,
		Type: str,
	})
	.passthrough();
export const Cin7PurchaseListPage = pageOf("PurchaseList", Cin7PurchaseListItem).passthrough();

export const Cin7PurchaseLine = z
	.object({
		ProductID: str,
		SKU: str,
		Name: str,
		Quantity: num,
		Price: num,
		Discount: num,
		Tax: num,
		Total: num,
	})
	.passthrough();

const purchaseOrder = z
	.object({
		Status: str,
		Lines: z.array(Cin7PurchaseLine),
		AdditionalCharges: z.array(z.object({ Total: num }).passthrough()).nullish(),
		TotalBeforeTax: num,
		Tax: num,
		Total: num,
	})
	.passthrough();

const purchaseHeader = {
	ID: str,
	SupplierID: strN,
	Supplier: str,
	BaseCurrency: str,
	SupplierCurrency: str,
	OrderNumber: str,
	OrderDate: strN,
	Status: str,
	CurrencyRate: num.nullish(),
	LastUpdatedDate: str,
	// Blind receipts (stock received with no order) carry no Order block.
	Order: purchaseOrder.nullish(),
};

// GET /purchase: StockReceived and Invoice are single objects, and the body carries no `Type`.
export const Cin7Purchase = z
	.object({
		...purchaseHeader,
		Type: str.optional(),
		StockReceived: z.object({ Status: str }).passthrough().nullish(),
		Invoice: z.object({ Status: str }).passthrough().nullish(),
	})
	.passthrough();

// GET /advanced-purchase: the same blocks become arrays.
export const Cin7AdvancedPurchase = z
	.object({
		...purchaseHeader,
		Type: z.enum(["Simple Purchase", "Advanced Purchase", "Service Purchase"]),
		StockReceived: z.array(z.object({ Status: str }).passthrough()).nullish(),
		Invoice: z.array(z.object({ Status: str }).passthrough()).nullish(),
	})
	.passthrough();

export const Cin7Webhook = z
	.object({
		ID: str,
		Type: str,
		Name: str.optional(),
		IsActive: z.boolean(),
		ExternalURL: str,
		ExternalAuthorizationType: str,
		ExternalUserName: strN,
		ExternalPassword: strN,
		ExternalBearerToken: strN,
		ExternalHeaders: z
			.array(z.object({ Key: str, Value: str }).passthrough())
			.nullish(),
	})
	.passthrough();

export const Cin7NewWebhook = Cin7Webhook.omit({ ID: true, Name: true });

export type Cin7Me = z.infer<typeof Cin7Me>;
export type Cin7PriceTier = z.infer<typeof Cin7PriceTier>;
export type Cin7Location = z.infer<typeof Cin7Location>;
export type Cin7Supplier = z.infer<typeof Cin7Supplier>;
export type Cin7Customer = z.infer<typeof Cin7Customer>;
export type Cin7Attachment = z.infer<typeof Cin7Attachment>;
export type Cin7Product = z.infer<typeof Cin7Product>;
export type Cin7Availability = z.infer<typeof Cin7Availability>;
export type Cin7SaleListItem = z.infer<typeof Cin7SaleListItem>;
export type Cin7SaleLine = z.infer<typeof Cin7SaleLine>;
export type Cin7Sale = z.infer<typeof Cin7Sale>;
export type Cin7PurchaseListItem = z.infer<typeof Cin7PurchaseListItem>;
export type Cin7PurchaseLine = z.infer<typeof Cin7PurchaseLine>;
export type Cin7Purchase = z.infer<typeof Cin7Purchase>;
export type Cin7AdvancedPurchase = z.infer<typeof Cin7AdvancedPurchase>;
export type Cin7Webhook = z.infer<typeof Cin7Webhook>;
export type NewWebhook = z.infer<typeof Cin7NewWebhook>;
