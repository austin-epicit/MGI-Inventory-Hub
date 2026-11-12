import { generateDataset, type Cin7Dataset } from "../../fixtures/generate.js";

let memo: Cin7Dataset | undefined;

// Generation is deterministic, so every test file can share one copy; treat it as read-only.
export function demoDataset(): Cin7Dataset {
	memo ??= generateDataset({ seed: 42, asOf: "2026-11-01", months: 24 });
	return memo;
}
