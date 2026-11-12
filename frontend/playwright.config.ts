import { readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "@playwright/test";

// The dev admin's login lives in backend/.env as comments; env vars win so CI can supply its own.
const devEnv = (key: string): string | undefined => {
	try {
		const text = readFileSync(path.resolve(process.cwd(), "../backend/.env"), "utf8");
		return new RegExp(`^#?\\s*${key}=(.*)$`, "m").exec(text)?.[1]?.trim();
	} catch {
		return undefined;
	}
};
for (const [name, key] of [
	["E2E_ADMIN_EMAIL", "DEV_ADMIN_EMAIL"],
	["E2E_ADMIN_PASSWORD", "DEV_ADMIN_PASSWORD"],
] as const) {
	const value = process.env[name] ?? devEnv(key);
	if (value) process.env[name] = value; // assigning undefined would store the string "undefined"
}

// Runs against the already-running dev servers (web :5180 proxying the API :3100) on demo data.
export default defineConfig({
	testDir: "./e2e",
	timeout: 60_000,
	expect: { timeout: 10_000 },
	reporter: "list",
	use: {
		baseURL: process.env.E2E_BASE_URL ?? "http://localhost:5180",
		trace: "retain-on-failure",
	},
});
