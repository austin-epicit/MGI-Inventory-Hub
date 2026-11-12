import type {
	Cin7Attachment,
	Cin7Availability,
	Cin7Customer,
	Cin7AdvancedPurchase,
	Cin7Location,
	Cin7Me,
	Cin7PriceTier,
	Cin7Product,
	Cin7Purchase,
	Cin7PurchaseListItem,
	Cin7Sale,
	Cin7SaleListItem,
	Cin7Supplier,
	Cin7Webhook,
	NewWebhook,
} from "./schemas.js";

export type PageQuery = { page: number; limit: number };
export type Page<T> = { items: T[]; total: number; page: number };
export type Cin7PurchaseType = "Simple Purchase" | "Advanced Purchase" | "Service Purchase";
export type { NewWebhook };

// The only door to Cin7: the fixture source and the HTTP source both implement it.
export interface Cin7Source {
	readonly kind: "fixture" | "http";
	me(): Promise<Cin7Me>;
	priceTiers(): Promise<Cin7PriceTier[]>;
	locations(page: number): Promise<Page<Cin7Location>>;
	suppliers(q: PageQuery & { modifiedSince?: Date }): Promise<Page<Cin7Supplier>>;
	customers(q: PageQuery & { modifiedSince?: Date }): Promise<Page<Cin7Customer>>;
	/** Always asks for IncludeAttachments and IncludeDeprecated. */
	products(q: PageQuery & { modifiedSince?: Date }): Promise<Page<Cin7Product>>;
	product(id: string): Promise<Cin7Product | null>;
	productAttachments(productId: string): Promise<Cin7Attachment[]>;
	availability(q: PageQuery): Promise<Page<Cin7Availability>>;
	saleList(q: PageQuery & { updatedSince?: Date }): Promise<Page<Cin7SaleListItem>>;
	sale(id: string): Promise<Cin7Sale | null>;
	purchaseList(q: PageQuery & { updatedSince?: Date }): Promise<Page<Cin7PurchaseListItem>>;
	purchase(
		id: string,
		type: Cin7PurchaseType
	): Promise<Cin7Purchase | Cin7AdvancedPurchase | null>;
	download(url: string): Promise<{ bytes: Buffer; contentType: string }>;
	webhooks: {
		list(): Promise<Cin7Webhook[]>;
		create(w: NewWebhook): Promise<Cin7Webhook>;
		update(w: Cin7Webhook): Promise<Cin7Webhook>;
	};
}

const EXCERPT_BYTES = 2048;

export class Cin7AuthError extends Error {
	constructor(
		message: string,
		readonly status: number = 401
	) {
		super(message);
		this.name = "Cin7AuthError";
	}
}

export class Cin7RateLimitError extends Error {
	constructor(
		message: string,
		readonly retryAfterMs?: number
	) {
		super(message);
		this.name = "Cin7RateLimitError";
	}
}

export class Cin7HttpError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly bodyExcerpt: string = ""
	) {
		super(message);
		this.name = "Cin7HttpError";
		this.bodyExcerpt = bodyExcerpt.slice(0, EXCERPT_BYTES);
	}
}

export class Cin7ParseError extends Error {
	readonly bodyExcerpt: string;
	constructor(message: string, body: string) {
		super(message);
		this.name = "Cin7ParseError";
		this.bodyExcerpt = body.slice(0, EXCERPT_BYTES);
	}
}
