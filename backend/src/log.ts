import pino from "pino";

// Read process.env directly: env.ts is parsed after the logger must already exist.
export const log = pino({
	level: process.env.NODE_ENV === "test" ? "silent" : (process.env.LOG_LEVEL ?? "info"),
	formatters: { level: (label) => ({ level: label }) },
	timestamp: pino.stdTimeFunctions.isoTime,
	base: { service: "mgi-inventory-hub" },
});
