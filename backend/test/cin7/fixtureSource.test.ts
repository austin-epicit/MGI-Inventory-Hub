import { describe, expect, it } from "vitest";
import { createFixtureSource } from "../../src/cin7/fixtureSource.js";
import { parseCin7Stamp } from "../../src/cin7/timestamps.js";
import { Cin7HttpError } from "../../src/cin7/source.js";
import { demoDataset } from "../helpers/dataset.js";

const ds = demoDataset();
const src = createFixtureSource(ds);
const isPng = (a: { ContentType: string }) => a.ContentType === "image/png";
const isPdf = (a: { ContentType: string }) => a.ContentType === "application/pdf";

describe("fixture source", () => {
	it("is the fixture kind", () => expect(src.kind).toBe("fixture"));

	it("saleList pages and filters", async () => {
		const all = ds.saleList;
		const p2 = await src.saleList({ page: 2, limit: 50 });
		expect(p2.items[0]).toEqual(all[50]);
		expect(p2.items).toHaveLength(50);
		expect(p2.total).toBe(all.length);
		expect(p2.page).toBe(2);
		const cut = new Date("2026-09-01T00:00:00Z");
		const since = await src.saleList({ page: 1, limit: 1000, updatedSince: cut });
		expect(since.items.length).toBeGreaterThan(0);
		expect(since.items.length).toBeLessThan(all.length);
		expect(since.items.every((s) => new Date(s.Updated) > cut)).toBe(true);
		expect(since.total).toBe(since.items.length);
	});

	it("a page past the end is empty but keeps the total", async () => {
		const p = await src.saleList({ page: 999, limit: 100 });
		expect(p.items).toEqual([]);
		expect(p.total).toBe(ds.saleList.length);
	});

	it("purchaseList filters on LastUpdatedDate", async () => {
		const cut = new Date("2026-08-01T00:00:00Z");
		const r = await src.purchaseList({ page: 1, limit: 1000, updatedSince: cut });
		expect(r.items.length).toBeGreaterThan(0);
		expect(r.items.every((p) => parseCin7Stamp(p.LastUpdatedDate) > cut)).toBe(true);
	});

	it("sale(id) returns the detail or null", async () => {
		const first = ds.saleList[0];
		expect((await src.sale(first.SaleID))?.ID).toBe(first.SaleID);
		expect(await src.sale("00000000-0000-4000-8000-000000000000")).toBeNull();
	});

	it("purchase(id) returns the advanced shape for every purchase type", async () => {
		const adv = ds.purchaseList.find((p) => p.Type === "Advanced Purchase")!;
		const simple = ds.purchaseList.find((p) => p.Type === "Simple Purchase")!;
		const service = ds.purchaseList.find((p) => p.Type === "Service Purchase")!;
		for (const item of [adv, simple, service]) {
			const got = await src.purchase(item.ID, item.Type as "Simple Purchase");
			expect(got).toMatchObject({ ID: item.ID, Type: item.Type });
			expect(
				Array.isArray((got as { StockReceived?: unknown }).StockReceived)
			).toBe(true);
			expect(Array.isArray((got as { Invoice?: unknown }).Invoice)).toBe(true);
		}
		expect(
			await src.purchase(
				"00000000-0000-4000-8000-000000000000",
				"Simple Purchase"
			)
		).toBeNull();
	});

	it("products page, filter by modifiedSince and fetch one by id", async () => {
		const p1 = await src.products({ page: 1, limit: 100 });
		expect(p1.items).toHaveLength(100);
		expect(p1.total).toBe(ds.products.length);
		const cut = new Date("2026-06-01T00:00:00Z");
		const since = await src.products({ page: 1, limit: 1000, modifiedSince: cut });
		expect(since.items.every((p) => new Date(p.LastModifiedOn!) > cut)).toBe(true);
		expect(since.items.length).toBeLessThan(ds.products.length);
		expect((await src.product(ds.products[3].ID))?.SKU).toBe(ds.products[3].SKU);
		expect(await src.product("nope")).toBeNull();
	});

	it("reference lists", async () => {
		expect((await src.me()).Currency).toBe("USD");
		expect(await src.priceTiers()).toHaveLength(10);
		expect((await src.locations(1)).items).toHaveLength(3);
		expect((await src.suppliers({ page: 1, limit: 5 })).items).toHaveLength(5);
		expect((await src.customers({ page: 2, limit: 20 })).items).toHaveLength(5);
		expect((await src.availability({ page: 1, limit: 10 })).total).toBe(
			ds.availability.length
		);
	});

	it("productAttachments carries IsDefault; the first image is the default", async () => {
		const p = ds.products.find((x) => (x.Attachments ?? []).length >= 3)!;
		const atts = await src.productAttachments(p.ID);
		expect(atts.length).toBe(p.Attachments!.length);
		expect(atts.filter((a) => String(a.IsDefault) === "true")).toHaveLength(1);
		expect(await src.productAttachments("nope")).toEqual([]);
	});

	it("download resolves bytes by attachment id on either fixture host", async () => {
		const img = ds.products.flatMap((p) => p.Attachments ?? []).find(isPng)!;
		const png = await src.download(img.DownloadUrl);
		expect(png.contentType).toBe("image/png");
		expect([...png.bytes.subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
		const rewritten = img.DownloadUrl.replace("cin7-fixture.invalid", "localhost:4010");
		expect((await src.download(rewritten)).bytes.equals(png.bytes)).toBe(true);
		const real = `https://cin7-fixture.invalid/Attachment/Download?ID=${img.ID}&ContentType=image/png&FileName=x.png`;
		expect((await src.download(real)).bytes.equals(png.bytes)).toBe(true); // ?ID= wins over the path
		const pdfAtt = ds.products.flatMap((p) => p.Attachments ?? []).find(isPdf)!;
		const pdf = await src.download(pdfAtt.DownloadUrl);
		expect(pdf.contentType).toBe("application/pdf");
		expect(pdf.bytes.subarray(0, 5).toString()).toBe("%PDF-");
		await expect(
			src.download("https://cin7-fixture.invalid/attachments/nope")
		).rejects.toBeInstanceOf(Cin7HttpError);
	});

	it("one placeholder picture per category", async () => {
		const first = (cat: string) =>
			ds.products.find((p) => p.Category === cat && p.Attachments?.some(isPng))!
				.Attachments![0];
		const cats = ["Servers", "Storage", "Networking", "Components"];
		const bytes = await Promise.all(
			cats.map(async (c) =>
				(await src.download(first(c).DownloadUrl)).bytes.toString("base64")
			)
		);
		expect(new Set(bytes).size).toBe(4);
	});

	it("keeps webhooks in memory: create, list, update", async () => {
		const s = createFixtureSource(ds);
		expect(await s.webhooks.list()).toEqual([]);
		const w = await s.webhooks.create({
			Type: "Sale/OrderAuthorised",
			IsActive: true,
			ExternalURL: "https://hub.example/hook",
			ExternalAuthorizationType: "bearerauth",
			ExternalBearerToken: "t",
		});
		expect(w.ID).toBeTruthy();
		expect(w.Name).toBeTruthy();
		const upd = await s.webhooks.update({ ...w, IsActive: false });
		expect(upd.IsActive).toBe(false);
		expect(await s.webhooks.list()).toEqual([upd]);
		await expect(s.webhooks.update({ ...w, ID: "missing" })).rejects.toBeInstanceOf(
			Cin7HttpError
		);
		expect(await createFixtureSource(ds).webhooks.list()).toEqual([]);
	});
});
