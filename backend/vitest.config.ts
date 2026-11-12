import { defineConfig } from "vitest/config";

// Set on the main process so globalSetup and the workers agree on one database.
process.env.TEST_DATABASE_URL ??= "postgresql://postgres@localhost:5440/mgi_test";

export default defineConfig({
	test: {
		environment: "node",
		// bcrypt at cost 12 is slow in pure JS.
		testTimeout: 30_000,
		include: ["src/**/*.test.ts", "test/**/*.test.ts"],
		globalSetup: ["test/globalSetup.ts"],
		// Real Postgres: files share one database, so they must not overlap.
		fileParallelism: false,
		env: { TZ: "America/Los_Angeles", NODE_ENV: "test" },
		coverage: {
			provider: "v8",
			reporter: ["text", "json-summary", "html"],
			include: ["src/**/*.ts"],
			exclude: ["src/**/*.test.ts"],
		},
	},
});
