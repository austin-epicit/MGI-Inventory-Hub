import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
	createFakeCin7,
	type FakeCin7,
	type FakeCin7Opts,
} from "../../fixtures/fake-cin7/server.js";
import type { Cin7Dataset } from "../../fixtures/generate.js";
import { createHttpSource } from "../../src/cin7/httpSource.js";
import {
	Cin7AuthError,
	Cin7HttpError,
	Cin7ParseError,
	Cin7RateLimitError,
} from "../../src/cin7/source.js";
import { demoDataset } from "../helpers/dataset.js";

const ACCOUNT = "acct-1";
const KEY = "key-1";
const noLimit = { take: async () => {} };

const servers: Server[] = [];
afterEach(async () => {
	await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

async function start(ds: Cin7Dataset, over: Partial<FakeCin7Opts> = {}) {
	const app: FakeCin7 = createFakeCin7(ds, {
		accountId: ACCOUNT,
		applicationKey: KEY,
		...over,
	});
	const server = await new Promise<Server>((resolve) => {
		const s = app.listen(0, () => resolve(s));
	});
	servers.push(server);
	const port = (server.address() as AddressInfo).port;
	return { app, port, baseUrl: `http://localhost:${port}/ExternalApi/v2/` };
}

type Seen = { url: URL; headers: Record<string, string> };

// Wraps global fetch, recording what was sent.
function spyFetch() {
	const seen: Seen[] = [];
	const fetchImpl: typeof fetch = (input, init) => {
		seen.push({
			url: new URL(String(input)),
			headers: {
				...((init?.headers as Record<string, string> | undefined) ?? {}),
			},
		});
		return fetch(input, init);
	};
	return { seen, fetchImpl };
}

function build(
	baseUrl: string,
	over: {
		applicationKey?: string;
		fetchImpl?: typeof fetch;
		limiter?: { take(): Promise<void> };
	} = {}
) {
	const sleeps: number[] = [];
	let calls = 0;
	const source = createHttpSource({
		baseUrl,
		accountId: ACCOUNT,
		applicationKey: KEY,
		limiter: noLimit,
		sleep: async (ms) => {
			sleeps.push(ms);
		},
		onCall: () => (calls += 1),
		...over,
	});
	return { source, sleeps, calls: () => calls };
}

const stubFetch =
	(respond: () => Response | Promise<Response>): typeof fetch =>
	async () =>
		respond();

describe("createHttpSource against the fake Cin7", () => {
	it("sends both auth headers; wrong key → Cin7AuthError without retry", async () => {
		const { baseUrl } = await start(demoDataset());
		const spy = spyFetch();
		const ok = build(baseUrl, { fetchImpl: spy.fetchImpl });
		expect((await ok.source.me()).Currency).toBe(demoDataset().me.Currency);
		expect(spy.seen[0]!.headers).toMatchObject({
			"api-auth-accountid": ACCOUNT,
			"api-auth-applicationkey": KEY,
		});

		const bad = build(baseUrl, { applicationKey: "wrong" });
		await expect(bad.source.me()).rejects.toBeInstanceOf(Cin7AuthError);
		expect(bad.calls()).toBe(1);
		expect(bad.sleeps).toEqual([]);
	});

	it("pages until Total: 250 products at limit 100 → 3 calls", async () => {
		const ds = structuredClone(demoDataset());
		const base = ds.products[0]!;
		ds.products = Array.from({ length: 250 }, (_, i) => ({
			...base,
			ID: `p-${i}`,
			SKU: `SKU-${i}`,
		}));
		const { baseUrl } = await start(ds);
		const { source, calls } = build(baseUrl);
		const got: string[] = [];
		let total = 0;
		for (let page = 1; got.length < total || page === 1; page++) {
			const r = await source.products({ page, limit: 100 });
			total = r.total;
			got.push(...r.items.map((p) => p.ID));
		}
		expect(total).toBe(250);
		expect(got).toHaveLength(250);
		expect(calls()).toBe(3);
	});

	it("uses Cin7's query names and UTC millisecond stamps", async () => {
		const { baseUrl } = await start(demoDataset());
		const spy = spyFetch();
		const { source } = build(baseUrl, { fetchImpl: spy.fetchImpl });
		await source.products({
			page: 2,
			limit: 50,
			modifiedSince: new Date("2026-03-01T08:05:09.123Z"),
		});
		await source.saleList({
			page: 1,
			limit: 10,
			updatedSince: new Date("2026-03-01T00:00:00Z"),
		});
		const [p, s] = spy.seen.map((x) => x.url);
		expect(p!.pathname).toBe("/ExternalApi/v2/product");
		expect(Object.fromEntries(p!.searchParams)).toEqual({
			Page: "2",
			Limit: "50",
			ModifiedSince: "2026-03-01T08:05:09.123",
			IncludeAttachments: "true",
			IncludeDeprecated: "true",
		});
		expect(s!.searchParams.get("UpdatedSince")).toBe("2026-03-01T00:00:00.000");
	});

	it("429 waits Retry-After then succeeds; 503 handled the same", async () => {
		for (const status of [429, 503] as const) {
			const { baseUrl } = await start(demoDataset(), {
				faults: { status, everyNth: 2 },
			});
			const { source, sleeps, calls } = build(baseUrl);
			await source.me(); // request 1 passes
			const tiers = await source.priceTiers(); // request 2 faults, request 3 passes
			expect(tiers.length).toBeGreaterThan(0);
			expect(sleeps).toEqual([1000]);
			expect(calls()).toBe(3);
		}
	});

	it("429 without Retry-After waits 60 s; five 429s → Cin7RateLimitError", async () => {
		const sleeps: number[] = [];
		let n = 0;
		const source = createHttpSource({
			baseUrl: "http://cin7.test/ExternalApi/v2/",
			accountId: ACCOUNT,
			applicationKey: KEY,
			limiter: noLimit,
			sleep: async (ms) => {
				sleeps.push(ms);
			},
			fetchImpl: stubFetch(() => {
				n += 1;
				return new Response("slow down", { status: 429 });
			}),
		});
		await expect(source.me()).rejects.toBeInstanceOf(Cin7RateLimitError);
		expect(n).toBe(5);
		expect(sleeps).toEqual([60_000, 60_000, 60_000, 60_000]);
	});

	it("caps a huge Retry-After at 120 s", async () => {
		const sleeps: number[] = [];
		let n = 0;
		const source = createHttpSource({
			baseUrl: "http://cin7.test/ExternalApi/v2/",
			accountId: ACCOUNT,
			applicationKey: KEY,
			limiter: noLimit,
			sleep: async (ms) => {
				sleeps.push(ms);
			},
			fetchImpl: stubFetch(() =>
				++n === 1
					? new Response("slow", {
							status: 429,
							headers: { "retry-after": "86400" },
						})
					: Response.json({
							Company: "C",
							Currency: "USD",
							TimeZone: "UTC",
						})
			),
		});
		await source.me();
		expect(sleeps).toEqual([120_000]);
	});

	it("JSON calls never follow a redirect: the key is not resent, the call fails without retries", async () => {
		const modes: (RequestRedirect | undefined)[] = [];
		const sleeps: number[] = [];
		const source = createHttpSource({
			baseUrl: "https://cin7.test/ExternalApi/v2/",
			accountId: ACCOUNT,
			applicationKey: KEY,
			limiter: noLimit,
			sleep: async (ms) => {
				sleeps.push(ms);
			},
			fetchImpl: async (_input, init) => {
				modes.push(init?.redirect);
				return new Response(null, {
					status: 302,
					headers: { location: "http://evil.test/steal" },
				});
			},
		});
		const err = await source.me().catch((e: unknown) => e);
		expect(err).toBeInstanceOf(Cin7HttpError);
		expect((err as Cin7HttpError).status).toBe(302);
		expect(modes).toEqual(["manual"]);
		expect(sleeps).toEqual([]);
	});

	it("500 ×5 → Cin7HttpError after 5 jittered backoffs", async () => {
		const { baseUrl } = await start(demoDataset(), {
			faults: { status: 500, everyNth: 1 },
		});
		const { source, sleeps, calls } = build(baseUrl);
		const err = await source.me().catch((e: unknown) => e);
		expect(err).toBeInstanceOf(Cin7HttpError);
		expect((err as Cin7HttpError).status).toBe(500);
		expect(sleeps).toHaveLength(5);
		[2000, 4000, 8000, 16_000, 32_000].forEach((base, i) => {
			expect(sleeps[i]).toBeGreaterThanOrEqual(base * 0.8);
			expect(sleeps[i]).toBeLessThanOrEqual(base * 1.2);
		});
		expect(calls()).toBe(6);
	});

	it("network failures and timeouts surface as Cin7HttpError with a non-4xx status", async () => {
		const down = createHttpSource({
			baseUrl: "http://cin7.test/ExternalApi/v2/",
			accountId: ACCOUNT,
			applicationKey: KEY,
			limiter: noLimit,
			sleep: async () => {},
			fetchImpl: async () => {
				throw new TypeError("fetch failed");
			},
		});
		const e1 = await down.me().catch((e: unknown) => e);
		expect(e1).toBeInstanceOf(Cin7HttpError);
		expect((e1 as Cin7HttpError).status).toBe(0);

		const slow = createHttpSource({
			baseUrl: "http://cin7.test/ExternalApi/v2/",
			accountId: ACCOUNT,
			applicationKey: KEY,
			limiter: noLimit,
			sleep: async () => {},
			fetchImpl: async () => {
				throw new DOMException("The operation timed out", "TimeoutError");
			},
		});
		const e2 = await slow.me().catch((e: unknown) => e);
		expect(e2).toBeInstanceOf(Cin7HttpError);
		expect((e2 as Cin7HttpError).status).toBe(599);
	});

	it("404 on a detail endpoint → null; other 4xx is a Cin7HttpError", async () => {
		const { baseUrl } = await start(demoDataset());
		const { source } = build(baseUrl);
		expect(await source.product("nope")).toBeNull();
		expect(await source.sale("nope")).toBeNull();
		for (const type of [
			"Simple Purchase",
			"Advanced Purchase",
			"Service Purchase",
		] as const) {
			expect(await source.purchase("nope", type)).toBeNull();
		}
		const stub = createHttpSource({
			baseUrl: "http://cin7.test/ExternalApi/v2/",
			accountId: ACCOUNT,
			applicationKey: KEY,
			limiter: noLimit,
			sleep: async () => {},
			fetchImpl: stubFetch(() => new Response("bad request", { status: 400 })),
		});
		const err = await stub.me().catch((e: unknown) => e);
		expect(err).toBeInstanceOf(Cin7HttpError);
		expect((err as Cin7HttpError).status).toBe(400);
	});

	it("unparseable or off-contract bodies → Cin7ParseError with a 2 KB excerpt", async () => {
		const make = (body: string) =>
			createHttpSource({
				baseUrl: "http://cin7.test/ExternalApi/v2/",
				accountId: ACCOUNT,
				applicationKey: KEY,
				limiter: noLimit,
				sleep: async () => {},
				fetchImpl: stubFetch(() => new Response(body, { status: 200 })),
			});
		const html = `<html>${"x".repeat(5000)}</html>`;
		const e1 = await make(html)
			.me()
			.catch((e: unknown) => e);
		expect(e1).toBeInstanceOf(Cin7ParseError);
		expect((e1 as Cin7ParseError).bodyExcerpt).toBe(html.slice(0, 2048));
		await expect(make(JSON.stringify({ Company: 1 })).me()).rejects.toBeInstanceOf(
			Cin7ParseError
		);
	});

	it("download(): auth headers to the API host, none to another host; every call is limited", async () => {
		const ds = demoDataset();
		const { baseUrl } = await start(ds);
		const spy = spyFetch();
		let takes = 0;
		const { source, calls } = build(baseUrl, {
			fetchImpl: spy.fetchImpl,
			limiter: {
				take: async () => {
					takes += 1;
				},
			},
		});
		const page = await source.products({ page: 1, limit: 1000 });
		const withBoth = page.items.find(
			(p) =>
				p.Attachments?.some((a) => a.ContentType === "application/pdf") &&
				p.Attachments.some((a) => a.ContentType === "image/png")
		)!;
		const image = withBoth.Attachments!.find((a) => a.ContentType === "image/png")!;
		const pdf = withBoth.Attachments!.find((a) => a.ContentType === "application/pdf")!;
		const apiHost = new URL(baseUrl).host;
		expect(new URL(image.DownloadUrl).host).toBe(apiHost);
		expect(new URL(image.DownloadUrl).pathname).toBe("/Attachment/Download");
		expect(new URL(pdf.DownloadUrl).host).not.toBe(apiHost);
		expect(new URL(pdf.DownloadUrl).hostname).not.toBe("localhost");

		spy.seen.length = 0;
		const img = await source.download(image.DownloadUrl);
		const doc = await source.download(pdf.DownloadUrl);
		expect(img.contentType).toBe("image/png");
		expect(img.bytes.subarray(1, 4).toString()).toBe("PNG");
		expect(doc.contentType).toBe("application/pdf");
		expect(spy.seen[0]!.headers["api-auth-applicationkey"]).toBe(KEY);
		expect(spy.seen[0]!.headers["api-auth-accountid"]).toBe(ACCOUNT);
		expect(spy.seen[1]!.headers).not.toHaveProperty("api-auth-applicationkey");
		expect(spy.seen[1]!.headers).not.toHaveProperty("api-auth-accountid");
		expect(takes).toBe(3);
		expect(calls()).toBe(3);
	});

	it("fixture and HTTP sources agree on product attachments", async () => {
		const ds = demoDataset();
		const { baseUrl } = await start(ds);
		const { source } = build(baseUrl);
		const withAtt = ds.products.find((p) => (p.Attachments?.length ?? 0) > 1)!;
		const atts = await source.productAttachments(withAtt.ID);
		expect(atts.map((a) => a.ID)).toEqual(withAtt.Attachments!.map((a) => a.ID));
		expect(atts.filter((a) => a.IsDefault === "true")).toHaveLength(1);
	});

	it("webhooks round-trip through POST/PUT/GET /webhooks", async () => {
		const { baseUrl, app } = await start(demoDataset());
		const { source } = build(baseUrl);
		const created = await source.webhooks.create({
			Type: "Sale/OrderAuthorised",
			IsActive: true,
			ExternalURL: "https://hub.example/hook",
			ExternalAuthorizationType: "bearerauth",
			ExternalBearerToken: "t",
		});
		expect(created.ID).toBeTruthy();
		const updated = await source.webhooks.update({ ...created, IsActive: false });
		expect(updated.IsActive).toBe(false);
		expect(await source.webhooks.list()).toEqual([updated]);
		expect(
			app.requests
				.filter((r) => r.path.endsWith("/webhooks"))
				.map((r) => r.method)
		).toEqual(["POST", "PUT", "GET"]);
	});
});

describe("webhook writes over HTTP", () => {
	const hook = {
		Type: "Sale/Voided",
		IsActive: true,
		ExternalURL: "https://hub.example/hook",
		ExternalAuthorizationType: "bearerauth",
		ExternalBearerToken: "t",
	};

	it("POST /webhooks is never blindly retried on a network error or a 5xx", async () => {
		for (const failure of ["network", "500"]) {
			let posts = 0;
			const fetchImpl: typeof fetch = async () => {
				posts += 1;
				if (failure === "network") throw new TypeError("fetch failed");
				return new Response("boom", { status: 500 });
			};
			const { source, sleeps } = build("http://localhost:1/ExternalApi/v2/", {
				fetchImpl,
			});
			await expect(source.webhooks.create(hook)).rejects.toBeInstanceOf(
				Cin7HttpError
			);
			expect(posts).toBe(1);
			expect(sleeps).toEqual([]);
		}
	});

	it("PUT /webhooks (idempotent) still retries a network error", async () => {
		let puts = 0;
		const fetchImpl: typeof fetch = async () => {
			puts += 1;
			if (puts === 1) throw new TypeError("fetch failed");
			return Response.json({ Webhooks: [{ ID: "1", ...hook }] });
		};
		const { source } = build("http://localhost:1/ExternalApi/v2/", { fetchImpl });
		await source.webhooks.update({ ID: "1", ...hook });
		expect(puts).toBe(2);
	});
});

describe("purchase detail over HTTP", () => {
	it("every purchase type comes from /advanced-purchase in the advanced shape", async () => {
		const ds = demoDataset();
		const { baseUrl, app } = await start(ds);
		const { source } = build(baseUrl);
		for (const type of [
			"Simple Purchase",
			"Advanced Purchase",
			"Service Purchase",
		] as const) {
			const item = ds.purchaseList.find((p) => p.Type === type)!;
			const po = await source.purchase(item.ID, type);
			expect(po, type).not.toBeNull();
			expect(po!.ID).toBe(item.ID);
			expect(po!.Type).toBe(type);
			expect(Array.isArray(po!.StockReceived)).toBe(true);
			if (type === "Service Purchase") {
				expect(po!.Order!.Lines).toEqual([]);
				expect(po!.Order!.AdditionalCharges!.length).toBeGreaterThan(0);
			}
		}
		const paths = new Set(app.requests.map((r) => r.path));
		expect(paths).toEqual(new Set(["/ExternalApi/v2/advanced-purchase"]));
	});
});

describe("download() credential handling", () => {
	const HTTPS_BASE = "https://cin7.test/ExternalApi/v2/";
	const redirect = (to: string) =>
		new Response(null, { status: 302, headers: { location: to } });
	function scripted(respond: (url: URL) => Response) {
		const seen: Seen[] = [];
		const fetchImpl: typeof fetch = async (input, init) => {
			const url = new URL(String(input));
			seen.push({
				url,
				headers: { ...((init?.headers as Record<string, string>) ?? {}) },
			});
			return respond(url);
		};
		const source = createHttpSource({
			baseUrl: HTTPS_BASE,
			accountId: ACCOUNT,
			applicationKey: KEY,
			limiter: noLimit,
			sleep: async () => {},
			fetchImpl,
		});
		return { source, seen };
	}
	const hasKey = (s: Seen) => "api-auth-applicationkey" in s.headers;

	it("a cross-host redirect drops the auth headers", async () => {
		const { source, seen } = scripted((u) =>
			u.host === "cin7.test"
				? redirect("https://storage.test/blob")
				: new Response("bytes", {
						headers: { "content-type": "image/png" },
					})
		);
		const got = await source.download("https://cin7.test/Attachment/Download?ID=1");
		expect(got.bytes.toString()).toBe("bytes");
		expect(seen.map((s) => [s.url.host, hasKey(s)])).toEqual([
			["cin7.test", true],
			["storage.test", false],
		]);
	});

	it("an https to http redirect on the API host is refused; the key never goes over http", async () => {
		const { source, seen } = scripted(() => redirect("http://cin7.test/steal"));
		const err = await source
			.download("https://cin7.test/Attachment/Download?ID=1")
			.catch((e: unknown) => e);
		expect(err).toBeInstanceOf(Cin7HttpError);
		expect(seen).toHaveLength(1);
		expect(seen.filter((s) => s.url.protocol === "http:")).toEqual([]);
	});

	it("a plain-http URL on the API host gets no key", async () => {
		const { source, seen } = scripted(() => new Response("x"));
		await source.download("http://cin7.test/Attachment/Download?ID=1");
		expect(seen.map(hasKey)).toEqual([false]);
	});

	it("stops following redirects after 3 hops", async () => {
		let n = 0;
		const { source, seen } = scripted(() => redirect(`https://cin7.test/hop-${++n}`));
		await expect(source.download("https://cin7.test/start")).rejects.toBeInstanceOf(
			Cin7HttpError
		);
		expect(seen).toHaveLength(4);
	});
});
