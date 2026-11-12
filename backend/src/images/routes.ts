import { readFile } from "node:fs/promises";
import path from "node:path";
import { Router, type RequestHandler } from "express";
import type { Db } from "../db.js";
import { httpError } from "../http/responses.js";
import {
	IMAGE_SIZES,
	imageDir,
	MIME_BY_EXT,
	ORIGINAL_EXTS,
	UUID_RE as UUID,
	type ImageSize,
} from "./store.js";

const notFound = () => httpError(404, "NOT_FOUND", "Image not found");

async function readIfExists(file: string): Promise<Buffer | null> {
	try {
		return await readFile(file);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw err;
	}
}

// Reads only <uploadsDir>/products/<validated uuid>/<fixed name>; nothing from the URL becomes a
// path except those two checked parts.
async function load(
	uploadsDir: string,
	id: string,
	size: ImageSize
): Promise<{ bytes: Buffer; type: string } | null> {
	const dir = imageDir(uploadsDir, id);
	if (size !== "original") {
		const bytes = await readIfExists(path.join(dir, `${size}.webp`));
		return bytes && { bytes, type: "image/webp" };
	}
	for (const ext of ORIGINAL_EXTS) {
		const bytes = await readIfExists(path.join(dir, `original.${ext}`));
		if (bytes) return { bytes, type: MIME_BY_EXT[ext]! };
	}
	return null;
}

export const createImageRoutes = (
	deps: { db: Db; uploadsDir: string },
	requireAuth: RequestHandler
): Router => {
	const router = Router();
	router.use(requireAuth);
	router.get("/:id/:size", async (req, res) => {
		const { id, size } = req.params as { id: string; size: string };
		if (!UUID.test(id) || !(IMAGE_SIZES as readonly string[]).includes(size))
			throw notFound();
		const row = await deps.db.product_image.findFirst({
			where: { id: id.toLowerCase(), status: "stored" },
			select: { id: true },
		});
		if (!row) throw notFound();
		const file = await load(deps.uploadsDir, row.id, size as ImageSize);
		if (!file) {
			// Stored but gone from disk (volume restore, manual cleanup): queue it for the next sync.
			await deps.db.product_image.updateMany({
				where: { id: row.id, status: "stored" },
				data: { status: "pending", attempts: 0, error: null },
			});
			throw notFound();
		}
		res.set({
			"Content-Type": file.type,
			// Files are keyed by Cin7 attachment ID; a replaced picture arrives as a new ID.
			"Cache-Control": "private, max-age=604800, immutable",
			"X-Content-Type-Options": "nosniff",
		});
		res.send(file.bytes);
	});
	return router;
};
