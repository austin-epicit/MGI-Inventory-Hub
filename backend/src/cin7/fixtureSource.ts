import { toAdvancedShape } from "../../fixtures/advancedShape.js";
import { attachmentBytes } from "../../fixtures/images.js";
import type { Cin7Dataset } from "../../fixtures/generate.js";
import type { Cin7Attachment, Cin7Webhook } from "./schemas.js";
import { parseCin7Stamp } from "./timestamps.js";
import { Cin7HttpError, type Cin7Source, type Page, type PageQuery } from "./source.js";

const paged = <T>(all: T[], q: PageQuery): Page<T> => ({
	items: all.slice((q.page - 1) * q.limit, q.page * q.limit),
	total: all.length,
	page: q.page,
});

// Mirrors Cin7's filters: strictly newer than the cursor. Records without a stamp always pass.
const newer = (stamp: string | null | undefined, since?: Date) =>
	!since || !stamp || parseCin7Stamp(stamp) > since;

const isImage = (a: Cin7Attachment) => a.ContentType.startsWith("image/");

export function createFixtureSource(ds: Cin7Dataset): Cin7Source {
	const webhooks: Cin7Webhook[] = [];
	let webhookSeq = 0;
	const productById = new Map(ds.products.map((p) => [p.ID, p]));
	const saleById = new Map(ds.sales.map((s) => [s.ID, s]));
	const purchaseById = new Map(ds.purchases.map((p) => [p.ID, p]));

	return {
		kind: "fixture",
		me: async () => ds.me,
		priceTiers: async () => ds.priceTiers,
		locations: async (page) => paged(ds.locations, { page, limit: 100 }),
		suppliers: async (q) =>
			paged(
				ds.suppliers.filter((s) =>
					newer(s.LastModifiedOn, q.modifiedSince)
				),
				q
			),
		customers: async (q) =>
			paged(
				ds.customers.filter((c) =>
					newer(c.LastModifiedOn, q.modifiedSince)
				),
				q
			),
		products: async (q) =>
			paged(
				ds.products.filter((p) => newer(p.LastModifiedOn, q.modifiedSince)),
				q
			),
		product: async (id) => productById.get(id) ?? null,
		productAttachments: async (productId) => {
			const atts = productById.get(productId)?.Attachments ?? [];
			const firstImage = atts.find(isImage);
			// The standalone endpoint (unlike the embedded list) reports IsDefault, as a string.
			return atts.map((a) => ({ ...a, IsDefault: String(a === firstImage) }));
		},
		availability: async (q) => paged(ds.availability, q),
		saleList: async (q) =>
			paged(
				ds.saleList.filter((s) => newer(s.Updated, q.updatedSince)),
				q
			),
		sale: async (id) => saleById.get(id) ?? null,
		purchaseList: async (q) =>
			paged(
				ds.purchaseList.filter((p) =>
					newer(p.LastUpdatedDate, q.updatedSince)
				),
				q
			),
		// Live Cin7 serves every purchase type from /advanced-purchase, so `type` is not needed here.
		purchase: async (id) => {
			const p = purchaseById.get(id);
			return p ? toAdvancedShape(p) : null;
		},
		download: async (url) => {
			// Cin7's real URLs carry the ID as ?ID=; the dataset's own URLs end in it.
			const u = new URL(url);
			const id = u.searchParams.get("ID") ?? u.pathname.split("/").pop() ?? "";
			const file = await attachmentBytes(ds.attachmentKinds, id);
			if (!file) throw new Cin7HttpError(`attachment not found: ${id}`, 404);
			return file;
		},
		webhooks: {
			list: async () => webhooks.map((w) => ({ ...w })),
			create: async (w) => {
				webhookSeq += 1;
				const created: Cin7Webhook = {
					...w,
					ID: `00000000-0000-4000-8000-${String(webhookSeq).padStart(12, "0")}`,
					Name: `${w.Type} #${webhookSeq}`,
				};
				webhooks.push(created);
				return { ...created };
			},
			update: async (w) => {
				const i = webhooks.findIndex((x) => x.ID === w.ID);
				if (i < 0)
					throw new Cin7HttpError(`webhook not found: ${w.ID}`, 404);
				webhooks[i] = { ...w, Name: webhooks[i].Name };
				return { ...webhooks[i] };
			},
		},
	};
}
