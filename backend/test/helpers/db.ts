import { createDb } from "../../src/db.js";

export const testDb = createDb(process.env.TEST_DATABASE_URL!);

// Truncates every table except Prisma's own migration ledger.
export const resetDb = async (): Promise<void> => {
	// Truncation is unrecoverable, so refuse any database not named for tests.
	const dbName = new URL(process.env.TEST_DATABASE_URL!).pathname.replace(/^\//, "");
	if (!dbName.endsWith("_test")) {
		throw new Error(`resetDb refuses to truncate "${dbName}": name must end in _test`);
	}
	const tables = await testDb.$queryRaw<{ tablename: string }[]>`
		SELECT tablename FROM pg_tables
		WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
	if (tables.length === 0) return;
	const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
	await testDb.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
};
