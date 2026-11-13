import { describe, expect, it } from "vitest";
import { isValidEmail } from "./validation";

describe("isValidEmail", () => {
	it.each(["user@example.com", "sales@mgi.test", "boss@x.com", " a@b.co "])(
		"accepts %j",
		(v) => expect(isValidEmail(v)).toBe(true)
	);
	it.each(["a@b", "no at", "a b@c.d", "x@y.", "", "@b.c"])("rejects %j", (v) =>
		expect(isValidEmail(v)).toBe(false)
	);
});
