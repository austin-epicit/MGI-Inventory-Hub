import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Runs once before the suite so every test file sees the current schema.
export default function setup() {
	const url = process.env.TEST_DATABASE_URL;
	if (!url) throw new Error("TEST_DATABASE_URL is not set");
	execSync("npx prisma migrate deploy", {
		cwd: fileURLToPath(new URL("..", import.meta.url)),
		env: { ...process.env, DATABASE_URL: url },
		stdio: "pipe",
	});
}
