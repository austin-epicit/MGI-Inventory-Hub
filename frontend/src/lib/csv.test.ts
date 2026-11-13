import { afterEach, describe, expect, it, vi } from "vitest";
import { csvCell, downloadCsv, exportHref, localYmd, toCsv } from "./csv";

describe("csvCell", () => {
	it.each<[string | number | null | undefined, string]>([
		["plain", "plain"],
		["a,b", '"a,b"'],
		['say "hi"', '"say ""hi"""'],
		["a\nb", '"a\nb"'],
		["=SUM(A1)", "'=SUM(A1)"],
		["-Refurb", "'-Refurb"],
		["@x", "'@x"],
		["+x", "'+x"],
		["\tx", "'\tx"],
		[-12.5, "-12.5"],
		[0, "0"],
		[null, ""],
		[undefined, ""],
	])("%j -> %j", (input, out) => expect(csvCell(input)).toBe(out));

	it("keeps a name with comma, quote and newline as one quoted field", () => {
		expect(csvCell('Dell 24", "Grade A"\nlot')).toBe('"Dell 24"", ""Grade A""\nlot"');
	});

	it("guards then quotes a formula that also contains a comma", () => {
		expect(csvCell('=HYPERLINK("x",1)')).toBe(`"'=HYPERLINK(""x"",1)"`);
	});
});

describe("toCsv", () => {
	it("starts with a BOM and the header, joins with CRLF and ends with CRLF", () => {
		const out = toCsv<{ n: string; q: number }>(
			[
				{ label: "Name", value: (r) => r.n },
				{ label: "Qty", value: (r) => r.q },
			],
			[
				{ n: "a", q: -1 },
				{ n: "=b", q: 2 },
			]
		);
		expect(out).toBe("\uFEFFName,Qty\r\na,-1\r\n'=b,2\r\n");
	});

	it("is just the header for no rows", () => {
		expect(toCsv([{ label: "X", value: () => 1 }], [])).toBe("\uFEFFX\r\n");
	});
});

describe("localYmd", () => {
	it("formats the local calendar date, zero padded", () => {
		expect(localYmd(new Date(2026, 0, 5))).toBe("2026-01-05");
	});
});

describe("exportHref", () => {
	it("keeps set params, drops empty ones, never adds paging", () => {
		expect(
			exportHref("/api/products", {
				grade: "none",
				sort: "sku",
				search: "",
				dir: undefined,
			})
		).toBe("/api/products/export.csv?grade=none&sort=sku");
		expect(exportHref("/api/sales", {})).toBe("/api/sales/export.csv");
	});
});

describe("downloadCsv", () => {
	afterEach(() => vi.restoreAllMocks());

	it("clicks a temporary download link for a utf-8 csv blob, then revokes the url", async () => {
		const create = vi.fn(() => "blob:x");
		const revoke = vi.fn();
		Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
		const click = vi
			.spyOn(HTMLAnchorElement.prototype, "click")
			.mockImplementation(() => {});
		downloadCsv(
			"f.csv",
			[{ label: "A", value: (r: { a: number }) => r.a }],
			[{ a: 1 }]
		);
		const clicked = click.mock.contexts[0] as HTMLAnchorElement;
		expect(revoke).not.toHaveBeenCalled();
		expect(clicked.download).toBe("f.csv");
		expect(clicked.getAttribute("href")).toBe("blob:x");
		const blob = (create.mock.calls[0] as unknown as [Blob])[0];
		expect(blob.type).toBe("text/csv;charset=utf-8");
		// Read raw bytes (text() strips the BOM): EF BB BF then "A".
		const bytes = new Uint8Array(
			await new Promise<ArrayBuffer>((res) => {
				const fr = new FileReader();
				fr.onload = () => res(fr.result as ArrayBuffer);
				fr.readAsArrayBuffer(blob);
			})
		);
		expect([...bytes.slice(0, 4)]).toEqual([0xef, 0xbb, 0xbf, 0x41]);
		await new Promise((r) => setTimeout(r, 0)); // revoke is deferred past the click
		expect(revoke).toHaveBeenCalledWith("blob:x");
		expect(document.querySelector("a[download]")).toBeNull();
	});
});
