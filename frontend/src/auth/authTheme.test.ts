import { describe, expect, it } from "vitest";

// The auth screens must follow the app theme: no fixed light-mode palette classes.
const sources = import.meta.glob(["./*.ts", "./*.tsx", "!./*.test.*"], {
	query: "?raw",
	import: "default",
	eager: true,
}) as Record<string, string>;
const fixed =
	/\b(?:bg|text|border|ring|placeholder:text)-(?:white|black|gray|zinc|slate|blue|red)(?:-\d+)?\b/;

describe("auth screens use theme tokens", () => {
	it("finds the auth sources", () => {
		expect(Object.keys(sources).length).toBeGreaterThan(5);
	});

	for (const [file, text] of Object.entries(sources)) {
		it(`${file} has no fixed palette classes`, () => {
			expect(text).not.toMatch(fixed);
		});
	}
});
