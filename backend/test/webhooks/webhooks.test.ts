import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { generateDataset, type Cin7Dataset } from "../../fixtures/generate.js";
import { decryptSecret, parseKey, saveCredentials } from "../../src/cin7/credentials.js";
import { createFixtureSource } from "../../src/cin7/fixtureSource.js";
import { Cin7AuthError, Cin7HttpError, type Cin7Source } from "../../src/cin7/source.js";
import { log } from "../../src/log.js";
import { runSync, type SyncDeps } from "../../src/sync/engine.js";
import { createSyncTick } from "../../src/sync/scheduler.js";
import { getSyncStatus } from "../../src/sync/status.js";
import { createWebhookRunner, extractTargets, parseTolerant } from "../../src/webhooks/receiver.js";
import {
	checkWebhooks,
	registerWebhooks,
	WEBHOOK_TYPES,
	type WebhookDeps,
} from "../../src/webhooks/register.js";
import { TEST_BASE_URL, TEST_ENCRYPTION_KEY, testApp, testCin7Wiring } from "../helpers/app.js";
import { agentFor, insertUser, loginAs } from "../helpers/auth.js";
import { resetDb, testDb } from "../helpers/db.js";

const HOUR = 3_600_000;
const T0 = new Date("2026-11-20T12:00:00.000Z");
const KEY = parseKey(TEST_ENCRYPTION_KEY);

// Small dataset keeps the backfill quick.
const ds: Cin7Dataset = generateDataset({ seed: 7, asOf: "2026-11-01", months: 2 });

type Call = { method: string; args: unknown[] };
function spy(inner: Cin7Source) {
	const calls: Call[] = [];
	const source = new Proxy(inner, {
		get(target, key) {
			const value: unknown = Reflect.get(target, key);
			if (typeof value !== "function") return value;
			return async (...args: unknown[]) => {
				calls.push({ method: String(key), args });
				return value(...args);
			};
		},
	});
	return { source, calls, called: (m: string) => calls.filter((c) => c.method === m) };
}

const syncDeps = (source: Cin7Source): SyncDeps => ({
	db: testDb,
	source,
	clock: () => T0,
	log,
});
const hookDeps = (source: Cin7Source): WebhookDeps => ({ ...syncDeps(source), key: KEY });

beforeEach(async () => {
	await resetDb();
	await saveCredentials(testDb, KEY, { accountId: "a", applicationKey: "k" }, T0);
});
afterAll(() => testDb.$disconnect());

// Registers against the in-memory Cin7 and returns what Cin7 would call us with.
async function registered(source: Cin7Source) {
	await registerWebhooks(hookDeps(source), "https://hub.example.com");
	const hooks = await source.webhooks.list();
	const first = hooks[0]!;
	const token = new URL(first.ExternalURL).pathname.split("/")[4]!;
	return { token, bearer: first.ExternalBearerToken!, hooks };
}

function wired(source: Cin7Source) {
	const runner = createWebhookRunner({
		db: testDb,
		log,
		resolveDeps: async () => syncDeps(source),
		debounceMs: 60_000,
	});
	const cin7 = { ...testCin7Wiring(), resolveSource: async () => ({ source }) };
	return { app: testApp({ cin7, webhookRunner: runner, clock: () => T0 }), runner };
}

const post = (app: ReturnType<typeof testApp>, token: string, type: string, bearer?: string) => {
	const r = agentFor(app).post(`/api/webhooks/cin7/${token}/${type}`);
	// Cin7 is not a browser: no Origin header.
	r.unset("Origin");
	if (bearer !== undefined) r.set("Authorization", `Bearer ${bearer}`);
	return r;
};

describe("parseTolerant / extractTargets", () => {
	it("parses strict JSON and strips trailing commas outside strings only", () => {
		expect(parseTolerant('{"a":1}')).toEqual({ a: 1 });
		expect(parseTolerant('{"a":[1,2,],"b":{"c":"x,}",},}')).toEqual({
			a: [1, 2],
			b: { c: "x,}" },
		});
		expect(parseTolerant("not json")).toBeUndefined();
		expect(parseTolerant("")).toBeUndefined();
	});

	it("pulls record ids per type, lowercased and de-duplicated", () => {
		expect(extractTargets("Sale/OrderAuthorised", { SaleID: "AB-1" })).toEqual({
			sales: ["ab-1"],
		});
		expect(extractTargets("Sale/InvoiceAuthorised", { SaleTaskID: "AB-2" })).toEqual({
			sales: ["ab-2"],
		});
		expect(extractTargets("Purchase/OrderAuthorised", { TaskID: "P-1" })).toEqual({
			purchases: ["p-1"],
		});
		expect(
			extractTargets("Purchase/Updated", {
				CustomerDetailsList: [{ ID: "P-2" }, { ID: "p-2" }],
			})
		).toEqual({ purchases: ["p-2"] });
		expect(
			extractTargets("Product/Updated", { ProductDetailsList: [{ ID: "X" }] })
		).toEqual({
			products: ["x"],
		});
		expect(
			extractTargets("Stock/AvailableStockLevelChanged", [
				{ ID: "X" },
				{ ID: "Y" },
				{ ID: "X" },
			])
		).toEqual({ products: ["x", "y"] });
		expect(
			extractTargets("Customer/Updated", { NumberOfCustomers: 1 })
		).toBeUndefined();
		expect(extractTargets("Sale/Voided", { nothing: 1 })).toBeUndefined();
	});
});

describe("registerWebhooks / checkWebhooks", () => {
	it("creates one bearer-auth webhook per type, stores the bearer encrypted, is idempotent", async () => {
		const source = createFixtureSource(ds);
		const { hooks, bearer, token } = await registered(source);
		expect(hooks.map((h) => h.Type).sort()).toEqual([...WEBHOOK_TYPES].sort());
		expect(WEBHOOK_TYPES).toHaveLength(10);
		for (const h of hooks) {
			expect(h).toMatchObject({
				IsActive: true,
				ExternalAuthorizationType: "bearerauth",
			});
			expect(h.ExternalURL).toBe(
				`https://hub.example.com/api/webhooks/cin7/${token}/${h.Type}`
			);
		}
		const row = await testDb.cin7_connection.findUniqueOrThrow({ where: { id: 1 } });
		expect(row.webhook_path_token).toBe(token);
		expect(row.webhook_bearer_enc).not.toContain(bearer);
		expect(decryptSecret(row.webhook_bearer_enc!, KEY)).toBe(bearer);

		await registerWebhooks(hookDeps(source), "https://hub.example.com");
		expect(await source.webhooks.list()).toHaveLength(10);
		const again = await testDb.cin7_connection.findUniqueOrThrow({ where: { id: 1 } });
		expect(again.webhook_path_token).toBe(token);
	});

	it("an ambiguous create failure re-lists and reuses the webhook instead of duplicating", async () => {
		const inner = createFixtureSource(ds);
		let failed = false;
		const source: Cin7Source = {
			...inner,
			webhooks: {
				...inner.webhooks,
				create: async (w) => {
					const made = await inner.webhooks.create(w);
					if (!failed) {
						failed = true;
						throw new Cin7HttpError("unreachable", 0);
					}
					return made;
				},
			},
		};
		await registerWebhooks(hookDeps(source), "https://hub.example.com");
		const hooks = await inner.webhooks.list();
		expect(hooks).toHaveLength(10);
		expect(new Set(hooks.map((h) => h.Type)).size).toBe(10);
	});

	it("reactivates an inactive webhook, runs a reconcile and flags it in sync status", async () => {
		const spied = spy(createFixtureSource(ds));
		await registered(spied.source);
		const [victim] = await spied.source.webhooks.list();
		await spied.source.webhooks.update({ ...victim!, IsActive: false });

		await checkWebhooks(hookDeps(spied.source));

		const after = await spied.source.webhooks.list();
		expect(after.every((h) => h.IsActive)).toBe(true);
		expect(await testDb.sync_run.count({ where: { kind: "reconcile" } })).toBe(1);
		const status = await getSyncStatus(testDb, { source: "fixture", connected: true });
		expect(status.webhooks).toMatchObject({
			registered: true,
			inactiveTypes: [],
			reactivatedTypes: [victim!.Type],
			lastCheckAt: T0.toISOString(),
		});

		// All healthy: no further reconcile.
		await checkWebhooks(hookDeps(spied.source));
		expect(await testDb.sync_run.count({ where: { kind: "reconcile" } })).toBe(1);
	});

	it("checkWebhooks does nothing when no webhooks were ever registered", async () => {
		const spied = spy(createFixtureSource(ds));
		await checkWebhooks(hookDeps(spied.source));
		expect(spied.calls).toEqual([]);
	});
});

describe("POST /api/webhooks/cin7/:pathToken/*type", () => {
	it("wrong path token → 404, wrong or missing bearer → 401, nothing stored", async () => {
		const { source } = spy(createFixtureSource(ds));
		const { token, bearer } = await registered(source);
		const { app } = wired(source);
		const body = JSON.stringify({ SaleID: "x" });

		expect((await post(app, "nope", "Sale/Voided", bearer).send(body)).status).toBe(
			404
		);
		expect((await post(app, token, "Sale/Voided", "wrong").send(body)).status).toBe(
			401
		);
		expect(
			(await post(app, token, "Sale/Voided", bearer + "x").send(body)).status
		).toBe(401);
		expect((await post(app, token, "Sale/Voided").send(body)).status).toBe(401);
		expect(await testDb.webhook_event.count()).toBe(0);
	});

	it("an unconnected hub answers 404", async () => {
		await testDb.cin7_connection.deleteMany({});
		const { app } = wired(createFixtureSource(ds));
		expect((await post(app, "any", "Sale/Voided", "b").send("{}")).status).toBe(404);
	});

	it("a valid sale event runs a targeted sync that fetches only that sale", async () => {
		const spied = spy(createFixtureSource(ds));
		await runSync(syncDeps(spied.source), "backfill");
		const [a, b] = ds.saleList.filter(
			(s) => ds.sales.find((d) => d.ID === s.SaleID)!.Order.Lines.length > 0
		);
		const recent = new Date(T0.getTime() - HOUR / 2).toISOString();
		for (const id of [a!.SaleID, b!.SaleID]) {
			ds.saleList.find((s) => s.SaleID === id)!.Updated = recent;
			ds.sales.find((s) => s.ID === id)!.LastModifiedOn = recent;
		}
		const { token, bearer } = await registered(spied.source);
		const { app, runner } = wired(spied.source);
		spied.calls.length = 0;

		const res = await post(app, token, "Sale/OrderAuthorised", bearer)
			.set("Content-Type", "application/json")
			.send(
				JSON.stringify({
					SaleID: a!.SaleID.toUpperCase(),
					EventType: "Sale/OrderAuthorised",
				})
			);
		expect(res.status).toBe(200);
		await runner.flush();

		expect(spied.called("sale").map((c) => c.args[0])).toEqual([a!.SaleID]);
		const run = await testDb.sync_run.findFirstOrThrow({ where: { kind: "targeted" } });
		expect(run).toMatchObject({ trigger: "webhook", status: "ok" });
		const ev = await testDb.webhook_event.findFirstOrThrow();
		expect(ev).toMatchObject({
			type: "Sale/OrderAuthorised",
			record_ids: [a!.SaleID],
			status: "synced",
		});
		expect(ev.received_at).toEqual(T0);
	});

	it("parses a body with trailing commas", async () => {
		const { source } = spy(createFixtureSource(ds));
		const { token, bearer } = await registered(source);
		const { app } = wired(source);
		const res = await post(app, token, "Purchase/OrderAuthorised", bearer)
			.set("Content-Type", "application/json")
			.send('{"TaskID":"P-9","EventType":"Purchase/OrderAuthorised",}');
		expect(res.status).toBe(200);
		expect(await testDb.webhook_event.findFirstOrThrow()).toMatchObject({
			record_ids: ["p-9"],
			status: "received",
		});
	});

	it("a burst of 20 events becomes one targeted run", async () => {
		const spied = spy(createFixtureSource(ds));
		await runSync(syncDeps(spied.source), "backfill");
		const { token, bearer } = await registered(spied.source);
		const { app, runner } = wired(spied.source);
		const ids = ds.saleList.slice(0, 20).map((s) => s.SaleID);
		for (const id of ids) {
			const r = await post(app, token, "Sale/Backordered", bearer)
				.set("Content-Type", "application/json")
				.send(JSON.stringify({ SaleID: id }));
			expect(r.status).toBe(200);
		}
		expect(await testDb.sync_run.count({ where: { kind: "targeted" } })).toBe(0);
		await runner.flush();
		expect(await testDb.sync_run.count({ where: { kind: "targeted" } })).toBe(1);
		expect(await testDb.webhook_event.count({ where: { status: "synced" } })).toBe(20);
	});

	it("unknown types and unparseable bodies still get 200 and are stored as ignored", async () => {
		const { source } = spy(createFixtureSource(ds));
		const { token, bearer } = await registered(source);
		const { app, runner } = wired(source);
		expect(
			(await post(app, token, "Customer/Updated", bearer).send('{"a":1}')).status
		).toBe(200);
		expect(
			(await post(app, token, "Sale/Voided", bearer).send("<<garbage")).status
		).toBe(200);
		expect((await post(app, token, "Sale/Voided", bearer).send("{}")).status).toBe(200);
		await runner.flush();
		const events = await testDb.webhook_event.findMany({ orderBy: { id: "asc" } });
		expect(events.map((e) => e.status)).toEqual(["ignored", "ignored", "ignored"]);
		expect(events[1]!.error).toBeTruthy();
		expect(await testDb.sync_run.count()).toBe(0);
	});

	it("a bare stock array names products", async () => {
		const { source } = spy(createFixtureSource(ds));
		const { token, bearer } = await registered(source);
		const { app } = wired(source);
		await post(app, token, "Stock/AvailableStockLevelChanged", bearer)
			.set("Content-Type", "application/json")
			.send(JSON.stringify([{ ID: "A1" }, { ID: "B2" }]));
		expect(await testDb.webhook_event.findFirstOrThrow()).toMatchObject({
			type: "Stock/AvailableStockLevelChanged",
			record_ids: ["a1", "b2"],
		});
	});
});

describe("admin webhook routes", () => {
	it("register is admin-only, then GET shows per-type state", async () => {
		await insertUser("v@example.com");
		await insertUser("admin@example.com", "admin");
		const app = testApp({ cin7: testCin7Wiring(), publicBaseUrl: TEST_BASE_URL });
		const viewer = await loginAs(app, "v@example.com");
		expect((await viewer.post("/api/settings/webhooks/register")).status).toBe(403);
		expect((await viewer.get("/api/settings/webhooks")).status).toBe(403);

		const admin = await loginAs(app, "admin@example.com");
		const before = await admin.get("/api/settings/webhooks");
		expect(before.body.data).toMatchObject({
			registered: false,
			types: [],
			lastEventAt: null,
		});

		const reg = await admin.post("/api/settings/webhooks/register");
		expect(reg.status).toBe(200);
		expect(reg.body.data.registered).toBe(true);
		expect(reg.body.data.types).toHaveLength(10);
		expect(reg.body.data.types[0]).toMatchObject({ active: true });
		expect(JSON.stringify(reg.body)).not.toContain("bearer");
	});
});

describe("nightly hook", () => {
	it("onNightly runs after a reconcile tick, not after an incremental one", async () => {
		const sched = {
			intervalMs: 1,
			nightlyAt: "02:00",
			timezone: "America/Los_Angeles",
		};
		const calls: string[] = [];
		// Runs fail fast on a revoked key; only the tick wiring matters here.
		const revoked: Cin7Source = {
			...createFixtureSource(ds),
			me: async () => {
				throw new Cin7AuthError("no key");
			},
		};
		const deps = syncDeps(revoked);
		const tick = createSyncTick(deps, {
			...sched,
			onNightly: async () => void calls.push("n"),
		});
		// No earlier run: the first tick stands in as the reference, so it is incremental.
		await tick();
		expect(calls).toEqual([]);
		await testDb.sync_run.updateMany({
			data: { started_at: new Date(T0.getTime() - 48 * HOUR) },
		});
		await tick();
		expect(calls).toEqual(["n"]);
	});
});
