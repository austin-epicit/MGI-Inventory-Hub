import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeCin7 } from "../../fixtures/fake-cin7/server.js";
import { generateDataset } from "../../fixtures/generate.js";
import { loadCredentials, parseKey, saveCredentials } from "../../src/cin7/credentials.js";
import { clearMirror } from "../../src/sync/reset.js";
import { upsertProducts } from "../../src/sync/products.js";
import { withSyncLock } from "../../src/sync/scheduler.js";
import { TEST_ENCRYPTION_KEY, testApp, testCin7Wiring } from "../helpers/app.js";
import { insertUser, loginAs } from "../helpers/auth.js";
import { resetDb, testDb } from "../helpers/db.js";

const noLimit = { take: async () => {} };
const servers: Server[] = [];
beforeEach(resetDb);
afterEach(async () => {
	await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});
afterAll(() => testDb.$disconnect());

// A small dataset keeps the full HTTP backfill quick.
const dataset = generateDataset({ seed: 7, asOf: "2026-11-01", months: 2 });
const GOOD = { accountId: "acct-1", applicationKey: "key-1" };

async function startFake() {
	const app = createFakeCin7(dataset, { accountId: "acct-1", applicationKey: "key-1" });
	const server = await new Promise<Server>((resolve) => {
		const s = app.listen(0, () => resolve(s));
	});
	servers.push(server);
	return `http://localhost:${(server.address() as AddressInfo).port}/ExternalApi/v2/`;
}

async function httpApp(baseUrl: string) {
	await insertUser("admin@example.com", "admin");
	const app = testApp({
		cin7: testCin7Wiring(
			{ CIN7_SOURCE: "http", CIN7_BASE_URL: baseUrl },
			{ limiter: noLimit }
		),
	});
	return loginAs(app, "admin@example.com");
}

describe("admin routes", () => {
	it.each([
		["get", "/api/settings/cin7", undefined],
		["put", "/api/settings/cin7", GOOD],
		["delete", "/api/settings/cin7", undefined],
		["post", "/api/sync/run", { kind: "incremental" }],
		["post", "/api/sync/remap", { entity: "product" }],
	] as const)("viewer is refused with 403 on %s %s", async (method, path, body) => {
		await insertUser("v@example.com");
		const agent = await loginAs(testApp(), "v@example.com");
		const res = await agent[method](path).send(body);
		expect(res.status).toBe(403);
	});

	it("sync status reports the effective zone: Cin7's when valid, else the app's", async () => {
		await insertUser("v@example.com");
		const agent = await loginAs(testApp({ timeZone: "Europe/Paris" }), "v@example.com");
		// Before the first sync nothing is cached.
		expect((await agent.get("/api/sync/status")).body.data.timeZone).toBe(
			"Europe/Paris"
		);
		const set = (timeZone: string) =>
			testDb.app_setting.upsert({
				where: { key: "cin7.me" },
				create: {
					key: "cin7.me",
					value: { company: "C", currency: "USD", timeZone },
				},
				update: { value: { company: "C", currency: "USD", timeZone } },
			});
		await set("Pacific Standard Time"); // a Windows name Intl rejects
		expect((await agent.get("/api/sync/status")).body.data.timeZone).toBe(
			"Europe/Paris"
		);
		await set("Asia/Tokyo");
		expect((await agent.get("/api/sync/status")).body.data.timeZone).toBe("Asia/Tokyo");
	});

	it("sync status is open to any signed-in user", async () => {
		await insertUser("v@example.com");
		const agent = await loginAs(testApp(), "v@example.com");
		const res = await agent.get("/api/sync/status");
		expect(res.status).toBe(200);
		expect(res.body.data).toMatchObject({
			source: "fixture",
			running: false,
			lastRun: null,
			lastSuccessAt: null,
			backfill: { done: false, progressPct: 0 },
			quarantined: { count: 0, items: [] },
		});
	});
});

describe("PUT /api/settings/cin7", () => {
	it("rejected credentials give 422 CIN7_AUTH and nothing is saved", async () => {
		const agent = await httpApp(await startFake());
		const res = await agent
			.put("/api/settings/cin7")
			.send({ accountId: "acct-1", applicationKey: "wrong" });
		expect(res.status).toBe(422);
		expect(res.body.error.code).toBe("CIN7_AUTH");
		expect(await testDb.cin7_connection.count()).toBe(0);
		expect(await testDb.app_setting.count()).toBe(0);
	});

	it("an unreachable Cin7 gives 502 CIN7_UNREACHABLE and nothing is saved", async () => {
		const agent = await httpApp("http://localhost:1/ExternalApi/v2/");
		const res = await agent.put("/api/settings/cin7").send(GOOD);
		expect(res.status).toBe(502);
		expect(res.body.error.code).toBe("CIN7_UNREACHABLE");
		expect(await testDb.cin7_connection.count()).toBe(0);
	});

	it("verified credentials are saved encrypted, masked on read, and cache /me", async () => {
		const agent = await httpApp(await startFake());
		const put = await agent.put("/api/settings/cin7").send(GOOD);
		expect(put.status).toBe(200);
		const row = await testDb.cin7_connection.findUniqueOrThrow({ where: { id: 1 } });
		expect(JSON.stringify(row)).not.toContain("key-1");
		const get = await agent.get("/api/settings/cin7");
		expect(get.body.data).toMatchObject({
			source: "http",
			connected: true,
			accountIdMasked: "••••ct-1",
			baseCurrency: dataset.me.Currency,
			timeZone: dataset.me.TimeZone,
			company: dataset.me.Company,
		});
		expect(get.body.data.verifiedAt).toBeTypeOf("string");
		expect(JSON.stringify(get.body)).not.toContain("key-1");
		const del = await agent.delete("/api/settings/cin7");
		expect(del.body.data.connected).toBe(false);
		expect(await testDb.cin7_connection.count()).toBe(0);
	});

	it("unreadable stored credentials: GET still answers, PUT replaces them, DELETE removes them", async () => {
		const agent = await httpApp(await startFake());
		await testDb.cin7_connection.create({
			data: { id: 1, account_id_enc: "00:00:00", application_key_enc: "garbage" },
		});
		const get = await agent.get("/api/settings/cin7");
		expect(get.status).toBe(200);
		expect(get.body.data).toMatchObject({
			connected: true,
			accountIdMasked: null,
			unreadable: true,
		});
		const put = await agent.put("/api/settings/cin7").send(GOOD);
		expect(put.status).toBe(200);
		expect(put.body.data).toMatchObject({ unreadable: false });
		await testDb.cin7_connection.update({
			where: { id: 1 },
			data: { account_id_enc: "broken" },
		});
		const del = await agent.delete("/api/settings/cin7");
		expect(del.status).toBe(200);
		expect(del.body.data.connected).toBe(false);
	});
});

describe("switching Cin7 account", () => {
	const OTHER = { accountId: "acct-2", applicationKey: "key-2" };
	const key = parseKey(TEST_ENCRYPTION_KEY);

	async function fakeFor(creds: typeof OTHER) {
		const app = createFakeCin7(dataset, creds);
		const server = await new Promise<Server>((resolve) => {
			const s = app.listen(0, () => resolve(s));
		});
		servers.push(server);
		return `http://localhost:${(server.address() as AddressInfo).port}/ExternalApi/v2/`;
	}

	// Stored acct-1 credentials plus a mirror with every kind of derived state.
	async function seedMirror() {
		await saveCredentials(testDb, key, GOOD, new Date());
		await testDb.cin7_connection.update({
			where: { id: 1 },
			data: { webhook_path_token: "old-token" },
		});
		await upsertProducts(testDb, [structuredClone(dataset.products[0]!)], new Date());
		await testDb.sync_cursor.create({
			data: { entity: "sales", backfill_done: true, backfill_page: 3 },
		});
		await testDb.sync_record_failure.create({
			data: {
				entity: "sales",
				record_id: "x",
				attempts: 3,
				last_code: "CIN7_DATA",
				last_message: "m",
				first_failed_at: new Date(),
				last_failed_at: new Date(),
			},
		});
		await testDb.app_setting.create({
			data: { key: "cin7.webhooks", value: { registeredAt: "2026-01-01" } },
		});
		await testDb.app_setting.create({
			data: {
				key: "cin7.me",
				value: { company: "Old", currency: "EUR", timeZone: "UTC" },
			},
		});
	}

	it("re-saving the same account (a rotated key) keeps every mirrored row", async () => {
		const agent = await httpApp(
			await fakeFor({ accountId: "acct-1", applicationKey: "key-9" })
		);
		await seedMirror();
		const res = await agent
			.put("/api/settings/cin7")
			.send({ accountId: "acct-1", applicationKey: "key-9" });
		expect(res.status).toBe(200);
		expect(await testDb.product.count()).toBe(1);
		expect(await testDb.sync_cursor.count()).toBe(1);
		expect(await testDb.sync_record_failure.count()).toBe(1);
		expect(
			(await testDb.cin7_connection.findUniqueOrThrow({ where: { id: 1 } }))
				.webhook_path_token
		).toBe("old-token");
	});

	const FINGERPRINT = "cin7.account_fingerprint";
	const sha = (id: string) => createHash("sha256").update(id).digest("hex");
	const keptAfterReconnect = async () => {
		expect(await testDb.product.count()).toBe(1);
		expect(await testDb.product_price_snapshot.count()).toBeGreaterThan(0);
	};

	it("Disconnect then reconnecting the same account keeps the mirror and price snapshots", async () => {
		const agent = await httpApp(await startFake());
		expect((await agent.put("/api/settings/cin7").send(GOOD)).status).toBe(200);
		await upsertProducts(testDb, [structuredClone(dataset.products[0]!)], new Date());
		await agent.delete("/api/settings/cin7");
		const res = await agent.put("/api/settings/cin7").send(GOOD);
		expect(res.status).toBe(200);
		await keptAfterReconnect();
	});

	it("reconnecting with the account ID in another letter case also keeps the mirror", async () => {
		const upper = { accountId: "ACCT-1", applicationKey: "key-1" };
		const agent = await httpApp(await fakeFor(upper));
		await saveCredentials(testDb, key, GOOD, new Date());
		await testDb.app_setting.create({
			data: { key: FINGERPRINT, value: sha("acct-1") },
		});
		await upsertProducts(testDb, [structuredClone(dataset.products[0]!)], new Date());
		await agent.delete("/api/settings/cin7");
		const res = await agent.put("/api/settings/cin7").send(upper);
		expect(res.status).toBe(200);
		await keptAfterReconnect();
	});

	it("after Disconnect a different account is refused, and confirmReplace wipes and re-fingerprints", async () => {
		const agent = await httpApp(await fakeFor(OTHER));
		await saveCredentials(testDb, key, GOOD, new Date());
		await testDb.app_setting.create({
			data: { key: FINGERPRINT, value: sha("acct-1") },
		});
		await upsertProducts(testDb, [structuredClone(dataset.products[0]!)], new Date());
		await agent.delete("/api/settings/cin7");
		const refused = await agent.put("/api/settings/cin7").send(OTHER);
		expect(refused.status).toBe(409);
		expect(refused.body.error.code).toBe("ACCOUNT_CHANGED");
		expect(await testDb.product.count()).toBe(1);
		const ok = await agent
			.put("/api/settings/cin7")
			.send({ ...OTHER, confirmReplace: true });
		expect(ok.status).toBe(200);
		expect(await testDb.product.count()).toBe(0);
		const fp = await testDb.app_setting.findUniqueOrThrow({
			where: { key: FINGERPRINT },
		});
		expect(fp.value).toBe(sha("acct-2"));
	});

	it("an install saved before fingerprints existed still matches by its stored account ID", async () => {
		const agent = await httpApp(await startFake());
		await seedMirror(); // credentials row only, no fingerprint
		const res = await agent.put("/api/settings/cin7").send(GOOD);
		expect(res.status).toBe(200);
		expect(await testDb.product.count()).toBe(1);
		const fp = await testDb.app_setting.findUniqueOrThrow({
			where: { key: FINGERPRINT },
		});
		expect(fp.value).toBe(sha("acct-1"));
	});

	it("a different account with a non-empty mirror is refused with 409 ACCOUNT_CHANGED", async () => {
		const agent = await httpApp(await fakeFor(OTHER));
		await seedMirror();
		const res = await agent.put("/api/settings/cin7").send(OTHER);
		expect(res.status).toBe(409);
		expect(res.body.error.code).toBe("ACCOUNT_CHANGED");
		expect(await testDb.product.count()).toBe(1);
		expect((await loadCredentials(testDb, key))!.accountId).toBe("acct-1");
	});

	it("demo data (no stored credentials) counts as a different account too", async () => {
		const agent = await httpApp(await fakeFor(OTHER));
		await upsertProducts(testDb, [structuredClone(dataset.products[0]!)], new Date());
		const res = await agent.put("/api/settings/cin7").send(OTHER);
		expect(res.status).toBe(409);
		expect(res.body.error.code).toBe("ACCOUNT_CHANGED");
	});

	it("confirmReplace clears the mirror and derived state, then saves the new account", async () => {
		const agent = await httpApp(await fakeFor(OTHER));
		await seedMirror();
		await testDb.app_setting.create({
			data: {
				key: "sync.backfill_started_at.sales",
				value: "2026-01-01T00:00:00.000Z",
			},
		});
		await testDb.sync_run.create({
			data: {
				kind: "incremental",
				trigger: "schedule",
				status: "ok",
				started_at: new Date("2026-01-01T00:00:00Z"),
				finished_at: new Date("2026-01-01T00:01:00Z"),
			},
		});
		const res = await agent
			.put("/api/settings/cin7")
			.send({ ...OTHER, confirmReplace: true });
		expect(res.status).toBe(200);
		expect(
			await testDb.app_setting.count({
				where: { key: { startsWith: "sync.backfill_started_at." } },
			})
		).toBe(0);
		// The old account's last good run must not feed "Synced N min ago" for the new one.
		expect((await agent.get("/api/sync/status")).body.data.lastSuccessAt).toBeNull();
		expect(await testDb.product.count()).toBe(0);
		expect(await testDb.sync_cursor.count()).toBe(0);
		expect(await testDb.sync_record_failure.count()).toBe(0);
		expect(await testDb.app_setting.count({ where: { key: "cin7.webhooks" } })).toBe(0);
		const row = await testDb.cin7_connection.findUniqueOrThrow({ where: { id: 1 } });
		expect(row.webhook_path_token).toBeNull();
		expect((await loadCredentials(testDb, key))!.accountId).toBe("acct-2");
		expect(res.body.data).toMatchObject({
			company: dataset.me.Company,
			baseCurrency: dataset.me.Currency,
		});
	});

	it("after a clear, a run that started at or after the clear is shown normally", async () => {
		const agent = await httpApp(await fakeFor(OTHER));
		const run = (startedAt: string, finishedAt: string) =>
			testDb.sync_run.create({
				data: {
					kind: "incremental",
					trigger: "schedule",
					status: "ok",
					started_at: new Date(startedAt),
					finished_at: new Date(finishedAt),
				},
			});
		await run("2026-01-01T00:00:00Z", "2026-01-01T00:01:00Z"); // old account
		await clearMirror(testDb, new Date("2026-01-02T00:00:00Z"));
		const status = async () => (await agent.get("/api/sync/status")).body.data;
		expect((await status()).lastSuccessAt).toBeNull();
		expect((await status()).lastRun).toBeNull();
		await run("2026-01-02T00:00:00Z", "2026-01-02T00:05:00Z"); // new backfill, at the clear
		expect((await status()).lastSuccessAt).toBe("2026-01-02T00:05:00.000Z");
		expect((await status()).lastRun).toMatchObject({ status: "ok" });
	});
});

describe("sync routes", () => {
	it("connect, Sync now through the route, status ok and rows mirrored over HTTP", async () => {
		const agent = await httpApp(await startFake());
		await agent.put("/api/settings/cin7").send(GOOD);
		const run = await agent.post("/api/sync/run").send({ kind: "incremental" });
		expect(run.status).toBe(202);
		type Status = { running: boolean; lastRun: { status: string } | null };
		let status: Status = { running: true, lastRun: null };
		for (let i = 0; i < 600 && (status.running || !status.lastRun); i++) {
			await new Promise((r) => setTimeout(r, 100));
			status = (await agent.get("/api/sync/status")).body.data;
		}
		expect(status.lastRun?.status).toBe("ok");
		const body = (await agent.get("/api/sync/status")).body.data;
		expect(body.lastSuccessAt).toBeTypeOf("string");
		expect(body.backfill).toEqual({ done: true, progressPct: 100 });
		expect(await testDb.product.count()).toBe(dataset.products.length);
		expect(await testDb.sale.count()).toBeGreaterThan(0);
		const last = await testDb.sync_run.findFirstOrThrow({ orderBy: { id: "desc" } });
		expect(last.trigger).toBe("manual");
		expect(last.api_calls).toBeGreaterThan(0); // the shared call counter reached the run
	});

	it("a manual run while another sync holds the lock gives 409 SYNC_BUSY", async () => {
		const agent = await httpApp(await startFake());
		await agent.put("/api/settings/cin7").send(GOOD);
		let release!: () => void;
		const held = new Promise<void>((r) => (release = r));
		let entered!: () => void;
		const inside = new Promise<void>((r) => (entered = r));
		const holder = withSyncLock({ db: testDb, clock: () => new Date() }, async () => {
			entered();
			await held;
		});
		await inside;
		const run = await agent.post("/api/sync/run").send({ kind: "incremental" });
		const remap = await agent.post("/api/sync/remap").send({ entity: "product" });
		release();
		await holder;
		expect(run.status).toBe(409);
		expect(run.body.error.code).toBe("SYNC_BUSY");
		expect(remap.status).toBe(409);
		expect(remap.body.error.code).toBe("SYNC_BUSY");
	});

	it("running before Cin7 is connected gives 409 NOT_CONNECTED", async () => {
		const agent = await httpApp("http://localhost:1/ExternalApi/v2/");
		const run = await agent.post("/api/sync/run").send({ kind: "incremental" });
		expect(run.status).toBe(409);
		expect(run.body.error.code).toBe("NOT_CONNECTED");
	});

	it("status lists quarantined records, newest first, capped at 20", async () => {
		await insertUser("v@example.com");
		const base = Date.parse("2026-03-01T00:00:00Z");
		const row = (record_id: string, attempts: number, offset: number) => ({
			entity: "sales",
			record_id,
			attempts,
			last_code: "CIN7_DATA",
			last_message: "bad",
			first_failed_at: new Date(base),
			last_failed_at: new Date(base + offset),
		});
		await testDb.sync_record_failure.createMany({
			data: [
				...Array.from({ length: 22 }, (_, i) => row(`s${i}`, 3, i * 1000)),
				row("young", 2, 99_000),
			],
		});
		const agent = await loginAs(testApp(), "v@example.com");
		const { quarantined } = (await agent.get("/api/sync/status")).body.data;
		expect(quarantined.count).toBe(22);
		expect(quarantined.items).toHaveLength(20);
		expect(quarantined.items[0]).toMatchObject({ recordId: "s21", attempts: 3 });
	});
});
