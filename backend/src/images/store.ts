import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { Db } from "../db.js";
import type { SyncDeps } from "../sync/engine.js";

export type ImageSize = "thumb" | "medium" | "original";
export const IMAGE_SIZES: readonly ImageSize[] = ["thumb", "medium", "original"];
export const MAX_ATTEMPTS = 3;
export const DEFAULT_MAX_PER_RUN = 100;

// Extension by accepted type; anything else is skipped.
const EXT: Record<string, string> = {
	"image/jpeg": "jpg",
	"image/png": "png",
	"image/webp": "webp",
	"image/gif": "gif",
};
export const ORIGINAL_EXTS = Object.values(EXT);
export const MIME_BY_EXT: Record<string, string> = Object.fromEntries(
	Object.entries(EXT).map(([mime, ext]) => [ext, mime])
);
const EXT_BY_FORMAT: Record<string, string> = { jpeg: "jpg", png: "png", webp: "webp", gif: "gif" };
const VARIANTS = [
	{ file: "thumb.webp", width: 160, quality: 80 },
	{ file: "medium.webp", width: 640, quality: 85 },
] as const;

export const imagePath = (id: string, size: ImageSize): string => `/api/images/${id}/${size}`;

// Folder per attachment ID: a product can have several pictures, and a replaced picture is a new ID.
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const imageDir = (uploadsDir: string, id: string): string => {
	// The ID becomes a directory name, so anything but a plain UUID (e.g. "..") is refused.
	if (!UUID_RE.test(id)) throw new RangeError(`attachment id is not a UUID: ${id}`);
	return path.join(uploadsDir, "products", id);
};

const mimeOf = (contentType: string): string => contentType.split(";")[0]!.trim().toLowerCase();
const isImageType = (contentType: string): boolean => mimeOf(contentType) in EXT;

// Temp file then rename, so a crash never leaves a truncated file under its final name.
async function writeAtomic(file: string, bytes: Buffer): Promise<void> {
	const tmp = `${file}.tmp-${process.pid}`;
	try {
		await writeFile(tmp, bytes);
		await rename(tmp, file);
	} catch (err) {
		await rm(tmp, { force: true });
		throw err;
	}
}

type Row = { id: string; content_type: string; download_url: string };
type Outcome = "stored" | "skipped";

async function storeOne(deps: SyncDeps & { uploadsDir: string }, row: Row): Promise<Outcome> {
	if (!isImageType(row.content_type)) return "skipped";
	imageDir(deps.uploadsDir, row.id); // refuses a non-UUID id before any download
	const { bytes } = await deps.source.download(row.download_url);
	// Trust the bytes, not Cin7's claimed type: sharp decodes by content (and rasterizes SVG).
	const format = (await sharp(bytes, { failOn: "error" }).metadata()).format;
	const ext = format ? EXT_BY_FORMAT[format] : undefined;
	if (!ext) return "skipped";
	const dir = imageDir(deps.uploadsDir, row.id);
	await mkdir(dir, { recursive: true });
	// Decode first: a corrupt file must fail before anything is written.
	const base = sharp(bytes, { failOn: "error" }).rotate();
	const variants = await Promise.all(
		VARIANTS.map(async (v) => ({
			file: v.file,
			bytes: await base
				.clone()
				.resize({ width: v.width, withoutEnlargement: true })
				.webp({ quality: v.quality })
				.toBuffer(),
		}))
	);
	await writeAtomic(path.join(dir, `original.${ext}`), bytes);
	for (const v of variants) await writeAtomic(path.join(dir, v.file), v.bytes);
	return "stored";
}

const isDefault = (v: boolean | string | undefined): boolean => v === true || v === "true";

// One is_primary per product with stored pictures. With several image attachments Cin7's
// IsDefault decides (one extra call); a single picture needs no lookup.
async function choosePrimary(deps: SyncDeps, productId: string): Promise<void> {
	const { db, source } = deps;
	const rows = await db.product_image.findMany({
		where: { product_id: productId },
		orderBy: { position: "asc" },
	});
	const images = rows.filter((r) => isImageType(r.content_type));
	const stored = images.filter((r) => r.status === "stored");
	let pick = stored[0]?.id;
	if (stored.length > 0 && images.length > 1) {
		const atts = await source.productAttachments(productId);
		const def = atts.find((a) => isDefault(a.IsDefault));
		if (def && stored.some((r) => r.id === def.ID)) pick = def.ID;
	}
	await db.$transaction([
		db.product_image.updateMany({
			where: { product_id: productId, is_primary: true, id: { not: pick ?? "" } },
			data: { is_primary: false },
		}),
		...(pick
			? [
					db.product_image.update({
						where: { id: pick },
						data: { is_primary: true },
					}),
				]
			: []),
	]);
}

// ids: only those attachments; without it, every pending image plus failed ones still under the
// attempt cap (so a later sync run retries them).
export async function processPendingImages(
	deps: SyncDeps & { uploadsDir: string },
	ids?: string[],
	// Caps one call so a first backfill's pictures don't hold the sync lock for ~half an hour.
	opts: { maxPerRun?: number } = {}
): Promise<{ stored: number; skipped: number; failed: number }> {
	const { db, log } = deps;
	const rows = await db.product_image.findMany({
		where: {
			...(ids ? { id: { in: ids } } : {}),
			OR: [
				{ status: "pending" },
				{ status: "failed", attempts: { lt: MAX_ATTEMPTS } },
			],
		},
		// Pending before failed retries (enum order), then a stable product/position order.
		orderBy: [{ status: "asc" }, { product_id: "asc" }, { position: "asc" }],
		take: opts.maxPerRun ?? DEFAULT_MAX_PER_RUN,
	});
	const counts = { stored: 0, skipped: 0, failed: 0 };
	const touched = new Set<string>();
	for (const row of rows) {
		try {
			const outcome = await storeOne(deps, row);
			await db.product_image.update({
				where: { id: row.id },
				data:
					outcome === "stored"
						? {
								status: "stored",
								stored_at: deps.clock(),
								error: null,
							}
						: { status: "skipped", error: null },
			});
			counts[outcome] += 1;
			touched.add(row.product_id);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			log.warn({ err, imageId: row.id }, "product image failed");
			await db.product_image.update({
				where: { id: row.id },
				data: {
					status: "failed",
					attempts: { increment: 1 },
					error: message.slice(0, 500),
				},
			});
			counts.failed += 1;
		}
	}
	// Also products whose primary vanished (its attachment was deleted in Cin7).
	const orphaned = await db.$queryRaw<{ product_id: string }[]>`
		SELECT DISTINCT product_id FROM product_image i
		WHERE status = 'stored'
		AND NOT EXISTS (
			SELECT 1 FROM product_image p WHERE p.product_id = i.product_id AND p.is_primary
		)`;
	for (const o of orphaned) touched.add(o.product_id);
	for (const productId of touched) {
		try {
			await choosePrimary(deps, productId);
		} catch (err) {
			log.warn({ err, productId }, "choosing the primary picture failed");
		}
	}
	return counts;
}

export type ProductImageUrls = { thumbUrl: string; mediumUrl: string; originalUrl: string };

const urlsFor = (id: string): ProductImageUrls => ({
	thumbUrl: imagePath(id, "thumb"),
	mediumUrl: imagePath(id, "medium"),
	originalUrl: imagePath(id, "original"),
});

// For the product API: every requested ID maps to its primary's URLs, or null without a stored one.
export async function primaryImagePaths(
	db: Db,
	productIds: string[]
): Promise<Map<string, ProductImageUrls | null>> {
	const out = new Map<string, ProductImageUrls | null>(productIds.map((id) => [id, null]));
	const rows = await db.product_image.findMany({
		where: { product_id: { in: productIds }, is_primary: true, status: "stored" },
		select: { id: true, product_id: true },
	});
	for (const r of rows) out.set(r.product_id, urlsFor(r.id));
	return out;
}

// Every stored picture of one product, primary first, then Cin7's attachment order.
export async function productImages(
	db: Db,
	productId: string
): Promise<(ProductImageUrls & { id: string; isPrimary: boolean })[]> {
	const rows = await db.product_image.findMany({
		where: { product_id: productId, status: "stored" },
		orderBy: [{ is_primary: "desc" }, { position: "asc" }, { id: "asc" }],
		select: { id: true, is_primary: true },
	});
	return rows.map((r) => ({ id: r.id, ...urlsFor(r.id), isPrimary: r.is_primary }));
}
