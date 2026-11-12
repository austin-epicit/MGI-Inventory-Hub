import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
	decryptSecret,
	deleteCredentials,
	encryptSecret,
	loadCredentials,
	parseKey,
	saveCredentials,
} from "../../src/cin7/credentials.js";
import { TEST_ENCRYPTION_KEY } from "../helpers/app.js";
import { resetDb, testDb } from "../helpers/db.js";

const key = parseKey(TEST_ENCRYPTION_KEY);
beforeEach(resetDb);
afterAll(() => testDb.$disconnect());

describe("credentials", () => {
	it("round-trips and never stores the plaintext", async () => {
		await saveCredentials(
			testDb,
			key,
			{ accountId: "acct-PLAIN-1234", applicationKey: "app-key-PLAIN-5678" },
			new Date("2026-03-01T00:00:00Z")
		);
		const row = await testDb.cin7_connection.findUniqueOrThrow({ where: { id: 1 } });
		expect(JSON.stringify(row)).not.toContain("PLAIN");
		expect(row.account_id_enc).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
		expect(await loadCredentials(testDb, key)).toEqual({
			accountId: "acct-PLAIN-1234",
			applicationKey: "app-key-PLAIN-5678",
			verifiedAt: new Date("2026-03-01T00:00:00Z"),
		});
	});

	it("saving again replaces the single row; delete clears it", async () => {
		const at = new Date();
		await saveCredentials(testDb, key, { accountId: "a", applicationKey: "k" }, at);
		await saveCredentials(testDb, key, { accountId: "b", applicationKey: "k2" }, at);
		expect(await testDb.cin7_connection.count()).toBe(1);
		expect((await loadCredentials(testDb, key))?.accountId).toBe("b");
		await deleteCredentials(testDb);
		expect(await loadCredentials(testDb, key)).toBeNull();
	});

	it("uses a fresh IV each time and rejects tampering or the wrong key", () => {
		const a = encryptSecret("same", key);
		expect(encryptSecret("same", key)).not.toBe(a);
		const [iv, tag, data] = a.split(":");
		const flipped = `${iv}:${tag}:${(data![0] === "0" ? "1" : "0") + data!.slice(1)}`;
		expect(() => decryptSecret(flipped, key)).toThrow();
		expect(() => decryptSecret(a, Buffer.alloc(32, 9))).toThrow();
		expect(() => decryptSecret("nonsense", key)).toThrow("malformed");
	});
});
