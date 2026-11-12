import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Cin7Attachment } from "../../src/cin7/schemas.js";
import type { Cin7Source } from "../../src/cin7/source.js";
import {
	imageDir,
	imagePath,
	primaryImagePaths,
	processPendingImages,
} from "../../src/images/store.js";
import { log } from "../../src/log.js";
import { upsertProducts } from "../../src/sync/products.js";
import { demoDataset } from "../helpers/dataset.js";
import { resetDb, testDb } from "../helpers/db.js";

const now = new Date("2026-11-01T12:00:00Z");
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const att = (ID: string, ContentType = "image/png"): Cin7Attachment => ({
	ID,
	ContentType,
	FileName: `${ID}.x`,
	DownloadUrl: `https://x/${ID}`,
});

let dir: string;
let png: Buffer;
beforeAll(async () => {
	png = await sharp({
		create: { width: 800, height: 600, channels: 3, background: "#3b82f6" },
	})
		.png()
		.toBuffer();
});
beforeEach(async () => {
	await resetDb();
	dir = await mkdtemp(path.join(os.tmpdir(), "mgi-img-"));
});
afterAll(async () => {
	await testDb.$disconnect();
});

type Opts = {
	defaultId?: string;
	failIds?: string[];
	returned?: Record<string, { bytes: Buffer; contentType: string }>;
};
function fakeSource(o: Opts = {}) {
	const download = vi.fn(async (url: string) => {
		const id = url.split("/").pop()!;
		if (o.failIds?.includes(id)) throw new Error("boom");
		return o.returned?.[id] ?? { bytes: png, contentType: "image/png" };
	});
	const productAttachments = vi.fn(async (pid: string) => {
		const rows = await testDb.product_image.findMany({
			where: { product_id: pid },
			orderBy: { position: "asc" },
		});
		return rows.map((r) => ({
			...att(r.id, r.content_type),
			IsDefault: String(r.id === o.defaultId),
		}));
	});
	return {
		download,
		productAttachments,
		source: { download, productAttachments } as unknown as Cin7Source,
	};
}
const run = (source: Cin7Source, ids?: string[]) =>
	processPendingImages({ db: testDb, source, clock: () => now, log, uploadsDir: dir }, ids);

async function seedProduct(atts: Cin7Attachment[], index = 0) {
	const p = structuredClone(demoDataset().products[index]!);
	p.Attachments = atts;
	await upsertProducts(testDb, [p], now);
	return p.ID;
}
const byPosition = (pid: string) =>
	testDb.product_image.findMany({ where: { product_id: pid }, orderBy: { position: "asc" } });

describe("processPendingImages", () => {
	it("stores original + thumb + medium once; a second run downloads nothing", async () => {
		await seedProduct([att(A)]);
		const f = fakeSource();
		expect(await run(f.source)).toEqual({ stored: 1, skipped: 0, failed: 0 });
		expect((await readdir(path.join(dir, "products", A))).sort()).toEqual([
			"medium.webp",
			"original.png",
			"thumb.webp",
		]);
		const meta = async (f: string) =>
			sharp(await readFile(path.join(dir, "products", A, f))).metadata();
		const [thumb, medium] = [await meta("thumb.webp"), await meta("medium.webp")];
		expect([thumb.format, thumb.width, medium.format, medium.width]).toEqual([
			"webp",
			160,
			"webp",
			640,
		]);
		const row = await testDb.product_image.findUniqueOrThrow({ where: { id: A } });
		expect([row.status, row.is_primary, row.stored_at !== null]).toEqual([
			"stored",
			true,
			true,
		]);
		expect(f.download).toHaveBeenCalledTimes(1);
		expect(f.productAttachments).not.toHaveBeenCalled(); // single image: no default lookup
		expect(await run(f.source)).toEqual({ stored: 0, skipped: 0, failed: 0 });
		expect(f.download).toHaveBeenCalledTimes(1);
	});

	it("a PDF attachment is skipped without a download", async () => {
		await seedProduct([att(A, "application/pdf")]);
		const f = fakeSource();
		expect(await run(f.source)).toEqual({ stored: 0, skipped: 1, failed: 0 });
		expect(f.download).not.toHaveBeenCalled();
		const row = await testDb.product_image.findUniqueOrThrow({ where: { id: A } });
		expect([row.status, row.is_primary]).toEqual(["skipped", false]);
	});

	it("a download that is not an image at all fails (decode error)", async () => {
		await seedProduct([att(A)]);
		const f = fakeSource({
			returned: { [A]: { bytes: Buffer.from("x"), contentType: "text/html" } },
		});
		expect(await run(f.source)).toEqual({ stored: 0, skipped: 0, failed: 1 });
	});

	it("derives type from the bytes: JPEG claimed as PNG is stored as .jpg", async () => {
		await seedProduct([att(A)]);
		const jpg = await sharp(png).jpeg().toBuffer();
		const f = fakeSource({
			returned: { [A]: { bytes: jpg, contentType: "image/png" } },
		});
		expect(await run(f.source)).toEqual({ stored: 1, skipped: 0, failed: 0 });
		expect(await readdir(path.join(dir, "products", A))).toContain("original.jpg");
	});

	it("an SVG claimed as PNG is skipped, nothing written", async () => {
		await seedProduct([att(A)]);
		const svg = Buffer.from(
			'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'
		);
		const f = fakeSource({
			returned: { [A]: { bytes: svg, contentType: "image/png" } },
		});
		expect(await run(f.source)).toEqual({ stored: 0, skipped: 1, failed: 0 });
		expect(await readdir(path.join(dir, "products", A)).catch(() => [])).toEqual([]);
	});

	it("maxPerRun caps one call; the rest stay pending for later runs", async () => {
		for (const [i, id] of [
			A,
			B,
			C,
			"dddddddd-dddd-4ddd-8ddd-dddddddddddd",
			"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
		].entries())
			await seedProduct([att(id)], i);
		const f = fakeSource();
		const first = await processPendingImages(
			{ db: testDb, source: f.source, clock: () => now, log, uploadsDir: dir },
			undefined,
			{ maxPerRun: 2 }
		);
		expect(first).toEqual({ stored: 2, skipped: 0, failed: 0 });
		expect(await testDb.product_image.count({ where: { status: "pending" } })).toBe(3);
		expect(f.download).toHaveBeenCalledTimes(2);
	});

	it("failed downloads retry on later runs, three attempts at most", async () => {
		await seedProduct([att(A)]);
		const f = fakeSource({ failIds: [A] });
		for (let i = 1; i <= 3; i++) {
			expect(await run(f.source)).toEqual({ stored: 0, skipped: 0, failed: 1 });
			const row = await testDb.product_image.findUniqueOrThrow({
				where: { id: A },
			});
			expect([row.status, row.attempts, row.error]).toEqual([
				"failed",
				i,
				"boom",
			]);
		}
		expect(await run(f.source)).toEqual({ stored: 0, skipped: 0, failed: 0 });
		expect(f.download).toHaveBeenCalledTimes(3);
		await testDb.product_image.update({ where: { id: A }, data: { attempts: 1 } });
		expect(await run(fakeSource().source)).toEqual({
			stored: 1,
			skipped: 0,
			failed: 0,
		});
	});

	it("limits work to the given ids", async () => {
		await seedProduct([att(A)], 0);
		await seedProduct([att(B)], 1);
		expect(await run(fakeSource().source, [B])).toEqual({
			stored: 1,
			skipped: 0,
			failed: 0,
		});
		const rows = await testDb.product_image.findMany({ orderBy: { id: "asc" } });
		expect(rows.map((r) => r.status)).toEqual(["pending", "stored"]);
	});

	it("with several images the Cin7 default is primary; exactly one per product", async () => {
		const pid = await seedProduct([att(A), att(B), att(C, "application/pdf")]);
		const f = fakeSource({ defaultId: B });
		await run(f.source);
		expect(f.productAttachments).toHaveBeenCalledTimes(1);
		expect((await byPosition(pid)).map((r) => r.is_primary)).toEqual([
			false,
			true,
			false,
		]);
	});

	it("falls back to the first stored image by position when the default is not stored", async () => {
		const pid = await seedProduct([att(A), att(B)]);
		await run(fakeSource({ defaultId: B, failIds: [B] }).source);
		expect((await byPosition(pid)).map((r) => r.is_primary)).toEqual([true, false]);
	});

	it("re-picks the primary when the primary attachment is deleted in Cin7", async () => {
		const pid = await seedProduct([att(A), att(B)]);
		const f = fakeSource({ defaultId: A });
		await run(f.source);
		await seedProduct([att(B)]);
		await run(f.source);
		const rows = await testDb.product_image.findMany({ where: { product_id: pid } });
		expect(rows.map((r) => [r.id, r.is_primary])).toEqual([[B, true]]);
	});

	it("an undecodable image fails cleanly: not stored, not primary, no temp files", async () => {
		await seedProduct([att(A)]);
		const f = fakeSource({
			returned: {
				[A]: {
					bytes: Buffer.from("not an image"),
					contentType: "image/png",
				},
			},
		});
		expect(await run(f.source)).toEqual({ stored: 0, skipped: 0, failed: 1 });
		const row = await testDb.product_image.findUniqueOrThrow({ where: { id: A } });
		expect([row.status, row.is_primary, row.stored_at]).toEqual([
			"failed",
			false,
			null,
		]);
		const files = await readdir(path.join(dir, "products", A)).catch(
			() => [] as string[]
		);
		expect(files.filter((n) => n.includes(".tmp"))).toEqual([]);
	});
});

describe("imagePath + primaryImagePaths", () => {
	it("builds the API path", () => {
		expect(imagePath(A, "thumb")).toBe(`/api/images/${A}/thumb`);
	});

	it("returns the primary's URLs, or null when a product has no stored image", async () => {
		const withImg = await seedProduct([att(A)], 0);
		const without = await seedProduct([], 1);
		const pdfOnly = await seedProduct([att(C, "application/pdf")], 2);
		await run(fakeSource().source);
		const map = await primaryImagePaths(testDb, [withImg, without, pdfOnly]);
		expect(map.get(withImg)).toEqual({
			thumbUrl: `/api/images/${A}/thumb`,
			mediumUrl: `/api/images/${A}/medium`,
			originalUrl: `/api/images/${A}/original`,
		});
		expect(map.get(without)).toBeNull();
		expect(map.get(pdfOnly)).toBeNull();
	});
});

afterAll(async () => {
	if (dir) await rm(dir, { recursive: true, force: true });
});

describe("imageDir", () => {
	it("refuses an id that is not a plain UUID, so it can never leave the products folder", () => {
		expect(imageDir("/up", A)).toBe(path.join("/up", "products", A));
		for (const bad of ["..", "../x", "a/b", `${A}/..`, "", "..\\x"])
			expect(() => imageDir("/up", bad), bad).toThrow(RangeError);
	});
});
