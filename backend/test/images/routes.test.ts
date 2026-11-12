import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Cin7Source } from "../../src/cin7/source.js";
import { processPendingImages } from "../../src/images/store.js";
import { log } from "../../src/log.js";
import { upsertProducts } from "../../src/sync/products.js";
import { testApp } from "../helpers/app.js";
import { agentFor, insertUser, loginAs } from "../helpers/auth.js";
import { demoDataset } from "../helpers/dataset.js";
import { resetDb, testDb } from "../helpers/db.js";

const now = new Date("2026-11-01T12:00:00Z");
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
let dir: string;

beforeAll(async () => {
	dir = await mkdtemp(path.join(os.tmpdir(), "mgi-img-"));
});
beforeEach(async () => {
	await resetDb();
	const png = await sharp({
		create: { width: 400, height: 300, channels: 3, background: "#222222" },
	})
		.png()
		.toBuffer();
	const p = structuredClone(demoDataset().products[0]!);
	p.Attachments = [
		{
			ID: A,
			ContentType: "image/png",
			FileName: "a.png",
			DownloadUrl: `https://x/${A}`,
		},
	];
	await upsertProducts(testDb, [p], now);
	const source = {
		download: async () => ({ bytes: png, contentType: "image/png" }),
	} as unknown as Cin7Source;
	await processPendingImages({ db: testDb, source, clock: () => now, log, uploadsDir: dir });
});
afterAll(async () => {
	await rm(dir, { recursive: true, force: true });
	await testDb.$disconnect();
});

const app = () => testApp({ uploadsDir: dir });
const viewer = async () => {
	await insertUser("v@example.com");
	return loginAs(app(), "v@example.com");
};

describe("GET /api/images/:id/:size", () => {
	it("no session → 401", async () => {
		const res = await agentFor(app()).get(`/api/images/${A}/thumb`);
		expect(res.status).toBe(401);
	});

	it("serves thumb and medium as webp with the immutable private cache header", async () => {
		const agent = await viewer();
		for (const size of ["thumb", "medium"]) {
			const res = await agent.get(`/api/images/${A}/${size}`);
			expect(res.status).toBe(200);
			expect(res.headers["content-type"]).toBe("image/webp");
			expect(res.headers["cache-control"]).toBe(
				"private, max-age=604800, immutable"
			);
		}
	});

	it("serves the original with its own type", async () => {
		const res = await (await viewer()).get(`/api/images/${A}/original`);
		expect(res.status).toBe(200);
		expect(res.headers["content-type"]).toBe("image/png");
	});

	it.each([
		["unknown id", "11111111-1111-4111-8111-111111111111", "thumb"],
		["traversal id", "..%2F..%2Fetc", "thumb"],
		["bad size", A, "huge"],
		["traversal size", A, "..%2Fthumb"],
		["non-uuid text", "not-a-uuid", "thumb"],
	])("%s → 404", async (_n, id, size) => {
		const res = await (await viewer()).get(`/api/images/${id}/${size}`);
		expect(res.status).toBe(404);
	});

	it("a stored row whose file is gone → 404 now, and the next sync downloads it again", async () => {
		await rm(path.join(dir, "products", A, "thumb.webp"));
		const agent = await viewer();
		expect((await agent.get(`/api/images/${A}/thumb`)).status).toBe(404);
		expect(
			await testDb.product_image.findUniqueOrThrow({ where: { id: A } })
		).toMatchObject({
			status: "pending",
			attempts: 0,
		});
		const png = await sharp({
			create: { width: 40, height: 30, channels: 3, background: "#444444" },
		})
			.png()
			.toBuffer();
		const source = {
			download: async () => ({ bytes: png, contentType: "image/png" }),
		} as unknown as Cin7Source;
		await processPendingImages({
			db: testDb,
			source,
			clock: () => now,
			log,
			uploadsDir: dir,
		});
		expect((await agent.get(`/api/images/${A}/thumb`)).status).toBe(200);
	});

	it("a row that is not stored → 404", async () => {
		await testDb.product_image.update({
			where: { id: A },
			data: { status: "pending" },
		});
		expect((await (await viewer()).get(`/api/images/${A}/thumb`)).status).toBe(404);
	});
});
