import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { parseKey, saveCredentials } from "../../src/cin7/credentials.js";
import { getCin7Source, loadDemo } from "../../src/cin7/sourceFactory.js";
import { TEST_ENCRYPTION_KEY } from "../helpers/app.js";
import { demoDataset } from "../helpers/dataset.js";
import { resetDb, testDb } from "../helpers/db.js";

const env = (CIN7_SOURCE: "fixture" | "http") => ({
	CIN7_SOURCE,
	CIN7_BASE_URL: "http://localhost:1/ExternalApi/v2/",
	ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
});

beforeEach(resetDb);
afterAll(() => testDb.$disconnect());

describe("getCin7Source", () => {
	it("CIN7_SOURCE=fixture serves the tests' demo dataset, one instance per process", async () => {
		const handle = await getCin7Source(testDb, env("fixture"));
		expect(handle?.source.kind).toBe("fixture");
		expect(handle?.apiCalls).toBeUndefined();
		expect((await getCin7Source(testDb, env("fixture")))?.source).toBe(handle?.source);
		expect((await loadDemo()).dataset).toEqual(demoDataset());
	});

	it("CIN7_SOURCE=http is null until stored credentials exist, so the scheduler idles", async () => {
		expect(await getCin7Source(testDb, env("http"))).toBeNull();
	});

	it("CIN7_SOURCE=http builds an HTTP source from the stored credentials", async () => {
		await saveCredentials(
			testDb,
			parseKey(TEST_ENCRYPTION_KEY),
			{ accountId: "a", applicationKey: "k" },
			new Date()
		);
		const handle = await getCin7Source(testDb, env("http"));
		expect(handle?.source.kind).toBe("http");
		expect(handle?.apiCalls?.()).toBeTypeOf("number");
	});
});
