import express, { type Express, type NextFunction, type Request, type Response } from "express";
import type { Cin7Dataset } from "../generate.js";
import { parseCin7Stamp } from "../../src/cin7/timestamps.js";
import type { Cin7Attachment, Cin7Webhook } from "../../src/cin7/schemas.js";
import { toAdvancedShape } from "../advancedShape.js";
import { FILES_HOST } from "../catalog.js";
import { attachmentBytes } from "../images.js";

export type FakeCin7Opts = {
	accountId: string;
	applicationKey: string;
	faults?: { status: 429 | 503 | 500; everyNth: number };
	// Where the dataset's second attachment host is served. Default: 127.0.0.1 on the same port,
	// a different host name from the API's, like a pre-signed storage URL.
	filesOrigin?: string;
};

export type FakeCin7 = Express & { requests: { method: string; path: string }[] };

// Mirrors Cin7's filters: strictly newer than the cursor; records without a stamp always pass.
const newer = (stamp: string | null | undefined, since?: Date) =>
	!since || !stamp || parseCin7Stamp(stamp) > since;

type Product = Cin7Dataset["products"][number];

export function createFakeCin7(ds: Cin7Dataset, opts: FakeCin7Opts): FakeCin7 {
	const app = express() as FakeCin7;
	app.requests = [];
	const webhooks: Cin7Webhook[] = [];
	let webhookSeq = 0;
	let apiCalls = 0;
	const productById = new Map(ds.products.map((p) => [p.ID, p]));
	const saleById = new Map(ds.sales.map((s) => [s.ID, s]));
	const purchaseById = new Map(ds.purchases.map((p) => [p.ID, p]));
	const purchaseType = new Map(ds.purchaseList.map((p) => [p.ID, p.Type]));

	// Cin7 treats query names case-insensitively.
	const param = (req: Request, name: string): string | undefined => {
		for (const [k, v] of Object.entries(req.query)) {
			if (k.toLowerCase() === name.toLowerCase() && typeof v === "string")
				return v;
		}
		return undefined;
	};
	const since = (req: Request, name: string) => {
		const v = param(req, name);
		return v ? parseCin7Stamp(v) : undefined;
	};
	const pageOf = <T>(req: Request, all: T[]) => {
		const page = Math.max(1, Number(param(req, "Page") ?? 1));
		const limit = Math.max(1, Number(param(req, "Limit") ?? 100));
		return {
			Total: all.length,
			Page: page,
			items: all.slice((page - 1) * limit, page * limit),
		};
	};
	const wrap = <T>(req: Request, key: string, all: T[]) => {
		const { items, ...head } = pageOf(req, all);
		return { ...head, [key]: items };
	};
	const notFound = (res: Response, what: string) =>
		res.status(404).json({ Exception: `${what} not found` });

	const origin = (req: Request) => `${req.protocol}://${req.get("host")}`;
	const filesOrigin = (req: Request) =>
		opts.filesOrigin ?? `http://127.0.0.1:${req.socket.localPort}`;
	// Cin7's real attachment URL on the API host; the dataset's second host stays a separate,
	// unauthenticated one.
	const rewrite = (req: Request, a: Cin7Attachment): Cin7Attachment => {
		const url =
			new URL(a.DownloadUrl).hostname === FILES_HOST
				? `${filesOrigin(req)}/files/${a.ID}`
				: `${origin(req)}/Attachment/Download?ID=${a.ID}&ContentType=${a.ContentType}&FileName=${encodeURIComponent(a.FileName)}`;
		return { ...a, DownloadUrl: url };
	};

	const serveAttachment = async (id: string, res: Response) => {
		const file = await attachmentBytes(ds.attachmentKinds, id);
		if (!file) return notFound(res, `attachment ${id}`);
		res.type(file.contentType).send(file.bytes);
	};

	app.use((req, _res, next) => {
		app.requests.push({ method: req.method, path: req.originalUrl.split("?")[0]! });
		next();
	});

	const authed = (req: Request, res: Response, next: NextFunction) => {
		if (
			req.get("api-auth-accountid") !== opts.accountId ||
			req.get("api-auth-applicationkey") !== opts.applicationKey
		) {
			res.status(403).json({
				Exception: "Authorization has been denied for this request.",
			});
			return;
		}
		next();
	};

	app.get("/files/:id", (req, res) => void serveAttachment(String(req.params.id), res));
	app.get("/Attachment/Download", authed, (req, res) => {
		void serveAttachment(param(req, "ID") ?? "", res);
	});

	const api = express.Router();
	api.use(authed);
	api.use((_req, res, next) => {
		const f = opts.faults;
		apiCalls += 1;
		if (f && apiCalls % f.everyNth === 0) {
			if (f.status !== 500) res.set("Retry-After", "1");
			res.status(f.status).json({ Exception: "injected fault" });
			return;
		}
		next();
	});
	api.use(express.json());

	api.get("/me", (_req, res) => res.json(ds.me));
	api.get("/ref/priceTier", (_req, res) => res.json({ PriceTiers: ds.priceTiers }));
	api.get("/ref/location", (req, res) => res.json(wrap(req, "LocationList", ds.locations)));
	api.get("/supplier", (req, res) => {
		const s = since(req, "ModifiedSince");
		res.json(
			wrap(
				req,
				"SupplierList",
				ds.suppliers.filter((x) => newer(x.LastModifiedOn, s))
			)
		);
	});
	api.get("/customer", (req, res) => {
		const s = since(req, "ModifiedSince");
		res.json(
			wrap(
				req,
				"CustomerList",
				ds.customers.filter((x) => newer(x.LastModifiedOn, s))
			)
		);
	});
	api.get("/product", (req, res) => {
		const withAtt = param(req, "IncludeAttachments") === "true";
		const shape = (p: Product): Product => {
			if (!withAtt) {
				const { Attachments: _drop, ...rest } = p;
				return rest as Product;
			}
			return { ...p, Attachments: p.Attachments?.map((a) => rewrite(req, a)) };
		};
		const id = param(req, "ID");
		if (id) {
			const p = productById.get(id);
			return res.json({
				Total: p ? 1 : 0,
				Page: 1,
				Products: p ? [shape(p)] : [],
			});
		}
		const s = since(req, "ModifiedSince");
		const list = ds.products.filter((x) => newer(x.LastModifiedOn, s));
		const { items, ...head } = pageOf(req, list);
		res.json({ ...head, Products: items.map(shape) });
	});
	api.get("/product/attachments", (req, res) => {
		const atts = productById.get(param(req, "ProductID") ?? "")?.Attachments ?? [];
		const firstImage = atts.find((a) => a.ContentType.startsWith("image/"));
		// Unlike the embedded list, this endpoint reports IsDefault, as a string.
		res.json(
			atts.map((a) => ({
				...rewrite(req, a),
				IsDefault: String(a === firstImage),
			}))
		);
	});
	api.get("/ref/productavailability", (req, res) =>
		res.json(wrap(req, "ProductAvailabilityList", ds.availability))
	);
	api.get("/saleList", (req, res) => {
		const s = since(req, "UpdatedSince");
		res.json(
			wrap(
				req,
				"SaleList",
				ds.saleList.filter((x) => newer(x.Updated, s))
			)
		);
	});
	api.get("/sale", (req, res) => {
		const sale = saleById.get(param(req, "ID") ?? "");
		return sale ? res.json(sale) : notFound(res, "sale");
	});
	api.get("/purchaseList", (req, res) => {
		const s = since(req, "UpdatedSince");
		res.json(
			wrap(
				req,
				"PurchaseList",
				ds.purchaseList.filter((x) => newer(x.LastUpdatedDate, s))
			)
		);
	});
	// /advanced-purchase serves every purchase type in the advanced shape; the deprecated /purchase
	// serves Simple purchases only, in the legacy shape.
	api.get("/advanced-purchase", (req, res) => {
		const po = purchaseById.get(param(req, "ID") ?? "");
		return po ? res.json(toAdvancedShape(po)) : notFound(res, "purchase");
	});
	api.get("/purchase", (req, res) => {
		const id = param(req, "ID") ?? "";
		const po =
			purchaseType.get(id) === "Simple Purchase"
				? purchaseById.get(id)
				: undefined;
		return po ? res.json(po) : notFound(res, "purchase");
	});

	api.get("/webhooks", (_req, res) => res.json({ Webhooks: webhooks }));
	api.post("/webhooks", (req, res) => {
		webhookSeq += 1;
		const body = req.body as Cin7Webhook;
		const created: Cin7Webhook = {
			...body,
			ID: `00000000-0000-4000-8000-${String(webhookSeq).padStart(12, "0")}`,
			Name: `${body.Type} #${webhookSeq}`,
		};
		webhooks.push(created);
		res.json({ Webhooks: [created] });
	});
	api.put("/webhooks", (req, res) => {
		const w = req.body as Cin7Webhook;
		const i = webhooks.findIndex((x) => x.ID === w.ID);
		if (i < 0) return notFound(res, "webhook");
		webhooks[i] = { ...w, Name: webhooks[i]!.Name };
		res.json({ Webhooks: [webhooks[i]] });
	});

	app.use("/ExternalApi/v2", api);
	return app;
}
