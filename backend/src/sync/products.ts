import type { Prisma } from "../../generated/prisma/client.js";
import type { Db } from "../db.js";
import type { Cin7Product } from "../cin7/schemas.js";
import { parseCin7Timestamp } from "./dates.js";
import { dec4 } from "./money.js";
import { recordSnapshotIfChanged } from "./snapshots.js";

export const tierPricesOf = (p: Cin7Product): number[] => [
	p.PriceTier1,
	p.PriceTier2,
	p.PriceTier3,
	p.PriceTier4,
	p.PriceTier5,
	p.PriceTier6,
	p.PriceTier7,
	p.PriceTier8,
	p.PriceTier9,
	p.PriceTier10,
];

// Everything except id and synced_at, so remap can rewrite mapped columns without touching sync state.
export function mapProduct(p: Cin7Product) {
	return {
		sku: p.SKU,
		name: p.Name,
		category: p.Category ?? null,
		brand: p.Brand ?? null,
		type: p.Type,
		status: p.Status,
		uom: p.UOM ?? null,
		barcode: p.Barcode ?? null,
		average_cost: dec4(p.AverageCost),
		tier_prices: tierPricesOf(p).map(dec4),
		cin7_modified_at: p.LastModifiedOn ? parseCin7Timestamp(p.LastModifiedOn) : null,
		raw: p as unknown as Prisma.InputJsonValue,
	};
}

type Tx = Prisma.TransactionClient;

// Attachment ID is the identity: a new ID starts pending, a known ID keeps its status (metadata and
// position still refresh), a missing ID is deleted. is_primary is Task 9's call, never touched here.
async function syncImages(tx: Tx, p: Cin7Product): Promise<string[]> {
	const atts = p.Attachments;
	// Cin7 only returns Attachments when asked; absent means unknown, so leave image rows alone.
	if (!Array.isArray(atts)) return [];
	const existing = await tx.product_image.findMany({
		where: { product_id: p.ID },
		select: { id: true },
	});
	const known = new Set(existing.map((e) => e.id));
	const keep = atts.map((a) => a.ID);
	await tx.product_image.deleteMany({ where: { product_id: p.ID, id: { notIn: keep } } });
	const fresh: string[] = [];
	for (const [position, a] of atts.entries()) {
		const meta = {
			product_id: p.ID,
			file_name: a.FileName,
			content_type: a.ContentType,
			download_url: a.DownloadUrl,
			position,
		};
		if (known.has(a.ID)) {
			await tx.product_image.update({ where: { id: a.ID }, data: meta });
		} else {
			await tx.product_image.create({
				data: { id: a.ID, ...meta, status: "pending" },
			});
			fresh.push(a.ID);
		}
	}
	return fresh;
}

// imageIds = attachments newly queued by this call (status pending), for the image worker.
export async function upsertProducts(
	db: Db,
	raws: Cin7Product[],
	now: Date
): Promise<{ upserted: number; snapshots: number; imageIds: string[] }> {
	let snapshots = 0;
	const imageIds: string[] = [];
	for (const p of raws) {
		const data = { ...mapProduct(p), synced_at: now };
		await db.$transaction(async (tx) => {
			await tx.product.upsert({
				where: { id: p.ID },
				create: { id: p.ID, ...data },
				update: data,
			});
			if (
				await recordSnapshotIfChanged(
					tx,
					p.ID,
					{ averageCost: p.AverageCost, tierPrices: tierPricesOf(p) },
					now
				)
			) {
				snapshots++;
			}
			imageIds.push(...(await syncImages(tx, p)));
		});
	}
	return { upserted: raws.length, snapshots, imageIds };
}
