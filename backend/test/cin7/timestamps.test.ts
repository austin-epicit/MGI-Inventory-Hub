import { describe, expect, it } from "vitest";
import { parseCin7Stamp } from "../../src/cin7/timestamps.js";

describe("parseCin7Stamp", () => {
	it("reads a zone-less stamp as UTC, not local time (TZ=America/Los_Angeles)", () => {
		expect(process.env.TZ).toBe("America/Los_Angeles");
		expect(parseCin7Stamp("2021-11-02T11:44:45.21").getTime()).toBe(
			Date.UTC(2021, 10, 2, 11, 44, 45, 210)
		);
	});

	it("accepts 0-7 fraction digits with or without Z", () => {
		const base = Date.UTC(2021, 8, 17, 11, 17, 56);
		expect(parseCin7Stamp("2021-09-17T11:17:56").getTime()).toBe(base);
		expect(parseCin7Stamp("2021-09-17T11:17:56Z").getTime()).toBe(base);
		expect(parseCin7Stamp("2021-09-17T11:17:56.8Z").getTime()).toBe(base + 800);
		expect(parseCin7Stamp("2021-09-17T11:17:56.81").getTime()).toBe(base + 810);
		expect(parseCin7Stamp("2021-09-17T11:17:56.812Z").getTime()).toBe(base + 812);
		expect(parseCin7Stamp("2021-09-17T11:17:56.8125000Z").getTime()).toBe(base + 812);
	});

	it("rejects anything else", () => {
		expect(() => parseCin7Stamp("2021-09-17")).toThrow(RangeError);
		expect(() => parseCin7Stamp("not a date")).toThrow(RangeError);
	});
});
