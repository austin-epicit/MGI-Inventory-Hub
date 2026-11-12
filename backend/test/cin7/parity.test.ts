import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFakeCin7, type FakeCin7 } from "../../fixtures/fake-cin7/server.js";
import { createFixtureSource } from "../../src/cin7/fixtureSource.js";
import { createHttpSource } from "../../src/cin7/httpSource.js";
import type { Cin7Source } from "../../src/cin7/source.js";
import { log } from "../../src/log.js";
import { runSync } from "../../src/sync/engine.js";
import { demoDataset } from "../helpers/dataset.js";
import { resetDb, testDb } from "../helpers/db.js";

const T0 = new Date("2026-11-20T12:00:00.000Z");
let server: Server;
let app: FakeCin7;
let baseUrl: string;

beforeAll(async () => {
	app = createFakeCin7(demoDataset(), { accountId: "a", applicationKey: "k" });
	server = await new Promise<Server>((resolve) => {
		const s = app.listen(0, () => resolve(s));
	});
	baseUrl = `http://localhost:${(server.address() as AddressInfo).port}/ExternalApi/v2/`;
});
afterAll(() => new Promise((r) => server.close(r)));

const attachmentId = (url: string) => {
	const u = new URL(url);
	return u.searchParams.get("ID") ?? u.pathname.split("/").pop()!;
};

// Every mirrored table, rows in a stable order, attachment URLs (image rows and product.raw)
// reduced to the attachment ID: the fake serves them from its own host.
async function snapshotTables(): Promise<Record<string, string[]>> {
	const dump = (rows: object[]) =>
		rows
			.map((r) =>
				JSON.stringify(r, (_k, v: unknown) =>
					typeof v === "bigint" ? v.toString() : v
				)
			)
			.sort();
	const images = (await testDb.product_image.findMany()).map((i) => ({
		...i,
		download_url: attachmentId(i.download_url),
	}));
	// product.raw keeps the embedded attachment list, URLs included.
	const products = (await testDb.product.findMany()).map((p) => {
		const raw = structuredClone(p.raw) as { Attachments?: { DownloadUrl: string }[] };
		for (const a of raw.Attachments ?? []) a.DownloadUrl = attachmentId(a.DownloadUrl);
		return { ...p, raw };
	});
	return {
		price_tier: dump(await testDb.price_tier.findMany()),
		location: dump(await testDb.location.findMany()),
		supplier: dump(await testDb.supplier.findMany()),
		customer: dump(await testDb.customer.findMany()),
		product: dump(products),
		product_price_snapshot: dump(await testDb.product_price_snapshot.findMany()),
		product_image: dump(images),
		purchase: dump(await testDb.purchase.findMany()),
		purchase_line: dump(await testDb.purchase_line.findMany()),
		sale: dump(await testDb.sale.findMany()),
		sale_line: dump(await testDb.sale_line.findMany()),
		stock_level: dump(await testDb.stock_level.findMany()),
	};
}

async function backfill(source: Cin7Source) {
	await resetDb();
	const r = await runSync({ db: testDb, source, clock: () => T0, log }, "backfill", {
		trigger: "manual",
	});
	expect(r.status).toBe("ok");
	return snapshotTables();
}

describe("HTTP source + fake Cin7", () => {
	it("parity: backfill over HTTP equals backfill via the fixture source", async () => {
		const viaFixture = await backfill(createFixtureSource(demoDataset()));
		app.requests.length = 0;
		const http = createHttpSource({
			baseUrl,
			accountId: "a",
			applicationKey: "k",
			limiter: { take: async () => {} },
		});
		const viaHttp = await backfill(http);

		for (const [table, rows] of Object.entries(viaFixture)) {
			expect(viaHttp[table], table).toEqual(rows);
		}
		// Service purchases (no lines, only charges) arrive over HTTP and are stored with zero lines.
		const service = await testDb.purchase.findMany({
			where: { type: "Service Purchase" },
		});
		expect(service.length).toBeGreaterThan(0);
		for (const po of service) {
			expect(po.counted).toBe(true);
			expect(Number(po.total)).toBeGreaterThan(0);
			expect(
				await testDb.purchase_line.count({ where: { purchase_id: po.id } })
			).toBe(0);
		}
		expect(viaFixture.sale!.length).toBeGreaterThan(0);
		expect(viaFixture.product_image!.length).toBeGreaterThan(0);
	}, 120_000);

	it("only GET outside /webhooks", () => {
		expect(app.requests.length).toBeGreaterThan(100); // the backfill above really went over HTTP
		const writes = app.requests.filter((r) => r.method !== "GET");
		expect(writes.every((r) => r.path.endsWith("/webhooks"))).toBe(true);
	});
});
