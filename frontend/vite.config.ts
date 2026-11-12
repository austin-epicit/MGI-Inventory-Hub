import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import svgr from "vite-plugin-svgr";

// Pin the zone before any worker starts: Intl resolves it once per process, so
// setting TZ inside a test moves Date math but not formatting.
if (process.env.VITEST) process.env.TZ = "America/Los_Angeles";

export default defineConfig(({ mode }) => ({
	plugins: [react(), tailwindcss(), svgr()],
	define: {
		"process.env.NODE_ENV": JSON.stringify(mode),
	},
	server: {
		proxy: {
			"/api": {
				target: process.env.API_PROXY_TARGET ?? "http://localhost:3100",
				changeOrigin: true,
				secure: false,
			},
		},
		host: true,
		port: 5180,
		watch: {
			usePolling: true,
		},
	},
	test: {
		globals: true,
		environment: "jsdom",
		setupFiles: ["./src/test/setup.ts"],
		css: true,
		include: ["src/**/*.{test,spec}.{ts,tsx}"],
		exclude: ["node_modules/**", "dist/**"],
	},
}));
