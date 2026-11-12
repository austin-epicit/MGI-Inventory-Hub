import { z } from "zod";
import type { RateLimiter } from "./rateLimiter.js";
import {
	Cin7AdvancedPurchase,
	Cin7Attachment,
	Cin7AvailabilityPage,
	Cin7CustomerPage,
	Cin7LocationPage,
	Cin7Me,
	Cin7ProductPage,
	Cin7PriceTiers,
	Cin7PurchaseListPage,
	Cin7Sale,
	Cin7SaleListPage,
	Cin7SupplierPage,
	Cin7Webhook,
} from "./schemas.js";
import {
	Cin7AuthError,
	Cin7HttpError,
	Cin7ParseError,
	Cin7RateLimitError,
	type Cin7Source,
	type NewWebhook,
} from "./source.js";

const TIMEOUT_MS = 30_000;
const RATE_TRIES = 5;
const DEFAULT_RATE_WAIT_MS = 60_000;
const BACKOFF_MS = [2000, 4000, 8000, 16_000, 32_000];
const MAX_REDIRECTS = 3;
const MAX_RETRY_AFTER_MS = 120_000; // a hostile or broken header must not park a sync for hours

export type HttpSourceOpts = {
	baseUrl: string;
	accountId: string;
	applicationKey: string;
	limiter: RateLimiter;
	fetchImpl?: typeof fetch;
	sleep?: (ms: number) => Promise<void>;
	onCall?: () => void;
};

type Raw = { status: number; headers: Headers; body: Buffer };

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
// Cin7 filters take UTC to the millisecond, no zone suffix.
const stamp = (d: Date) => d.toISOString().slice(0, 23);
const jitter = (ms: number) => Math.round(ms * (0.8 + Math.random() * 0.4));
const excerpt = (b: Buffer) => b.subarray(0, 2048).toString("utf8");

const WebhookList = z.object({ Webhooks: z.array(Cin7Webhook) }).passthrough();
const Attachments = z.array(Cin7Attachment);

export function createHttpSource(opts: HttpSourceOpts): Cin7Source {
	const base = opts.baseUrl.endsWith("/") ? opts.baseUrl : `${opts.baseUrl}/`;
	const apiUrl = new URL(base);
	const doFetch = opts.fetchImpl ?? fetch;
	const sleep = opts.sleep ?? defaultSleep;
	const authHeaders = {
		"api-auth-accountid": opts.accountId,
		"api-auth-applicationkey": opts.applicationKey,
	};

	// One request with the whole retry policy. Every attempt takes a limiter slot. `null` = 404
	// the caller asked to treat as "no such record".
	async function exec(
		url: string,
		init: {
			method?: string;
			body?: string;
			headers?: Record<string, string>;
			manualRedirect?: boolean;
			// A POST that may have landed must not be resent blindly: no retry on network error or 5xx.
			noBlindRetry?: boolean;
		},
		allow404 = false
	): Promise<Raw | null> {
		let rateTries = 0;
		let backoffs = 0;
		for (;;) {
			await opts.limiter.take();
			opts.onCall?.();
			let raw: Raw;
			try {
				const res = await doFetch(url, {
					method: init.method ?? "GET",
					headers: init.headers,
					body: init.body,
					// JSON calls carry the key; only download() follows redirects, by hand.
					redirect: "manual",
					signal: AbortSignal.timeout(TIMEOUT_MS),
				});
				raw = {
					status: res.status,
					headers: res.headers,
					body: Buffer.from(await res.arrayBuffer()),
				};
			} catch (e) {
				const timedOut =
					e instanceof Error &&
					["TimeoutError", "AbortError"].includes(e.name);
				if (!init.noBlindRetry && backoffs < BACKOFF_MS.length) {
					await sleep(jitter(BACKOFF_MS[backoffs++]!));
					continue;
				}
				const why = e instanceof Error ? e.message : String(e);
				throw new Cin7HttpError(
					timedOut
						? `Cin7 request timed out: ${why}`
						: `Cin7 unreachable: ${why}`,
					timedOut ? 599 : 0
				);
			}

			const { status } = raw;
			if (status >= 300 && status < 400 && !init.manualRedirect)
				throw new Cin7HttpError(
					`Cin7 answered a redirect (HTTP ${status}); the API key is not sent along it`,
					status
				);
			if (status < 400) return raw;
			if (status === 401 || status === 403) {
				throw new Cin7AuthError(
					`Cin7 rejected the credentials (HTTP ${status})`,
					status
				);
			}
			if (status === 404 && allow404) return null;
			if (status === 429 || status === 503) {
				const secs = Number(raw.headers.get("retry-after"));
				const waitMs =
					raw.headers.get("retry-after") !== null &&
					Number.isFinite(secs) &&
					secs >= 0
						? Math.min(secs * 1000, MAX_RETRY_AFTER_MS)
						: DEFAULT_RATE_WAIT_MS;
				if (++rateTries >= RATE_TRIES) {
					throw new Cin7RateLimitError(
						`Cin7 kept answering HTTP ${status}`,
						waitMs
					);
				}
				await sleep(waitMs);
				continue;
			}
			if (status >= 500) {
				if (!init.noBlindRetry && backoffs < BACKOFF_MS.length) {
					await sleep(jitter(BACKOFF_MS[backoffs++]!));
					continue;
				}
				throw new Cin7HttpError(
					`Cin7 answered HTTP ${status}`,
					status,
					excerpt(raw.body)
				);
			}
			throw new Cin7HttpError(
				`Cin7 answered HTTP ${status}`,
				status,
				excerpt(raw.body)
			);
		}
	}

	const urlFor = (path: string, query: Record<string, string | number | undefined> = {}) => {
		const u = new URL(path, base);
		for (const [k, v] of Object.entries(query))
			if (v !== undefined) u.searchParams.set(k, String(v));
		return u.toString();
	};

	function parse<S extends z.ZodType>(schema: S, raw: Raw): z.output<S> {
		const text = raw.body.toString("utf8");
		let json: unknown;
		try {
			json = JSON.parse(text);
		} catch {
			throw new Cin7ParseError("Cin7 body is not JSON", text);
		}
		const r = schema.safeParse(json);
		if (!r.success)
			throw new Cin7ParseError(
				`Cin7 body off contract: ${r.error.message}`,
				text
			);
		return r.data;
	}

	async function get<S extends z.ZodType>(
		path: string,
		query: Record<string, string | number | undefined>,
		schema: S
	): Promise<z.output<S>>;
	async function get<S extends z.ZodType>(
		path: string,
		query: Record<string, string | number | undefined>,
		schema: S,
		detail: true
	): Promise<z.output<S> | null>;
	async function get<S extends z.ZodType>(
		path: string,
		query: Record<string, string | number | undefined>,
		schema: S,
		detail = false
	) {
		const raw = await exec(urlFor(path, query), { headers: authHeaders }, detail);
		return raw ? parse(schema, raw) : null;
	}

	async function send(method: "POST" | "PUT", path: string, body: unknown) {
		const raw = await exec(urlFor(path), {
			method,
			headers: { ...authHeaders, "content-type": "application/json" },
			body: JSON.stringify(body),
			noBlindRetry: method === "POST",
		});
		const hook = parse(WebhookList, raw!).Webhooks[0];
		if (!hook)
			throw new Cin7ParseError(
				"Cin7 returned no webhook",
				raw!.body.toString("utf8")
			);
		return hook;
	}

	const paged = (q: { page: number; limit: number }) => ({ Page: q.page, Limit: q.limit });
	const since = (name: string, d?: Date) => (d ? { [name]: stamp(d) } : {});

	return {
		kind: "http",
		me: () => get("me", {}, Cin7Me),
		priceTiers: async () => (await get("ref/priceTier", {}, Cin7PriceTiers)).PriceTiers,
		locations: async (page) => {
			const r = await get(
				"ref/location",
				paged({ page, limit: 100 }),
				Cin7LocationPage
			);
			return { items: r.LocationList, total: r.Total, page: r.Page };
		},
		suppliers: async (q) => {
			const r = await get(
				"supplier",
				{ ...paged(q), ...since("ModifiedSince", q.modifiedSince) },
				Cin7SupplierPage
			);
			return { items: r.SupplierList, total: r.Total, page: r.Page };
		},
		customers: async (q) => {
			const r = await get(
				"customer",
				{ ...paged(q), ...since("ModifiedSince", q.modifiedSince) },
				Cin7CustomerPage
			);
			return { items: r.CustomerList, total: r.Total, page: r.Page };
		},
		products: async (q) => {
			const r = await get(
				"product",
				{
					...paged(q),
					...since("ModifiedSince", q.modifiedSince),
					IncludeAttachments: "true",
					IncludeDeprecated: "true",
				},
				Cin7ProductPage
			);
			return { items: r.Products, total: r.Total, page: r.Page };
		},
		product: async (id) => {
			const r = await get(
				"product",
				{ ID: id, IncludeAttachments: "true", IncludeDeprecated: "true" },
				Cin7ProductPage,
				true
			);
			return r?.Products[0] ?? null;
		},
		productAttachments: async (productId) =>
			(await get(
				"product/attachments",
				{ ProductID: productId },
				Attachments,
				true
			)) ?? [],
		availability: async (q) => {
			const r = await get(
				"ref/productavailability",
				paged(q),
				Cin7AvailabilityPage
			);
			return { items: r.ProductAvailabilityList, total: r.Total, page: r.Page };
		},
		saleList: async (q) => {
			const r = await get(
				"saleList",
				{ ...paged(q), ...since("UpdatedSince", q.updatedSince) },
				Cin7SaleListPage
			);
			return { items: r.SaleList, total: r.Total, page: r.Page };
		},
		sale: (id) => get("sale", { ID: id }, Cin7Sale, true),
		purchaseList: async (q) => {
			const r = await get(
				"purchaseList",
				{ ...paged(q), ...since("UpdatedSince", q.updatedSince) },
				Cin7PurchaseListPage
			);
			return { items: r.PurchaseList, total: r.Total, page: r.Page };
		},
		// /advanced-purchase serves Simple, Advanced and Service purchases; /purchase is deprecated.
		// The type only matters to the caller's logging.
		purchase: (id) => get("advanced-purchase", { ID: id }, Cin7AdvancedPurchase, true),
		// MGI's key goes only to the API host over the API's scheme; a pre-signed storage URL never sees it. Redirects are
		// followed by hand so the same rule applies to every hop.
		download: async (url) => {
			let target = url;
			for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
				const cur = new URL(target);
				// Host AND scheme: the key never travels in cleartext, even to the API's own host.
				const headers =
					cur.host === apiUrl.host && cur.protocol === apiUrl.protocol
						? authHeaders
						: undefined;
				const raw = (await exec(target, {
					headers,
					manualRedirect: true,
				}))!;
				const next = raw.headers.get("location");
				if (raw.status >= 300 && raw.status < 400 && next) {
					const to = new URL(next, cur);
					if (cur.protocol === "https:" && to.protocol === "http:") {
						throw new Cin7HttpError(
							"refusing an https to http redirect",
							502
						);
					}
					target = to.toString();
					continue;
				}
				if (raw.status >= 300) {
					throw new Cin7HttpError(
						`attachment unavailable (HTTP ${raw.status})`,
						raw.status
					);
				}
				return {
					bytes: raw.body,
					contentType:
						raw.headers.get("content-type") ??
						"application/octet-stream",
				};
			}
			throw new Cin7HttpError("too many redirects downloading attachment", 502);
		},
		webhooks: {
			list: async () => (await get("webhooks", {}, WebhookList)).Webhooks,
			create: (w: NewWebhook) => send("POST", "webhooks", w),
			update: (w) => send("PUT", "webhooks", w),
		},
	};
}
