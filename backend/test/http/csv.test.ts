import { describe, expect, it } from "vitest";
import { csvCell, exportFilename, toCsv } from "../../src/http/csv.js";

describe("csvCell", () => {
	it.each([
		["plain", "plain"],
		["a,b", '"a,b"'],
		['say "hi"', '"say ""hi"""'],
		["a\nb", '"a\nb"'],
		["a\r\nb", '"a\r\nb"'],
		["=SUM(A1)", "'=SUM(A1)"],
		["-Refurb", "'-Refurb"],
		["@x", "'@x"],
		["+x", "'+x"],
		["\tx", "'\tx"],
		["=a,b", `"'=a,b"`],
		["", ""],
		[-12.5, "-12.5"],
		[0, "0"],
		[1234.5, "1234.5"],
		[null, ""],
		[undefined, ""],
	])("%j -> %j", (input, expected) => {
		expect(csvCell(input as string | number | null | undefined)).toBe(expected);
	});
});

describe("toCsv", () => {
	it("starts with a BOM, header first, CRLF joined, trailing CRLF", () => {
		const out = toCsv(
			[
				{ label: "Name", value: (r: { n: string; q: number }) => r.n },
				{ label: "Qty", value: (r) => r.q },
			],
			[
				{ n: "a", q: 1 },
				{ n: "b,c", q: -2 },
			]
		);
		expect(out).toBe('\uFEFFName,Qty\r\na,1\r\n"b,c",-2\r\n');
	});

	it("header only when there are no rows", () => {
		expect(toCsv([{ label: "X", value: () => 1 }], [])).toBe("\uFEFFX\r\n");
	});
});

describe("exportFilename", () => {
	it("builds mgi-<table>-<date>.csv", () => {
		expect(exportFilename("products", "2026-11-12")).toBe(
			"mgi-products-2026-11-12.csv"
		);
	});
});
