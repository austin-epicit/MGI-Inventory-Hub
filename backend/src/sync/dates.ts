import { parseCin7Stamp } from "../cin7/timestamps.js";
import type { Db } from "../db.js";
import { getCachedMe } from "./engine.js";

export const parseCin7Timestamp = parseCin7Stamp;

// Business dates arrive as "2026-03-01T00:00:00" in the account's own calendar. Slicing keeps the
// day as written; any Date round trip would shift it under a non-UTC server zone.
export function parseCin7Date(s: string | null | undefined): string | null {
	if (!s) return null;
	const m = /^(\d{4}-\d{2}-\d{2})(?:$|[T ])/.exec(s);
	if (!m) throw new RangeError(`not a Cin7 date: ${s}`);
	return m[1]!;
}

// @db.Date is written as UTC midnight; read it back with toISOString().slice(0, 10), never local getters.
export const ymdToDbDate = (ymd: string): Date => new Date(`${ymd}T00:00:00.000Z`);

export const cin7DateToDb = (s: string | null | undefined): Date | null => {
	const ymd = parseCin7Date(s);
	return ymd ? ymdToDbDate(ymd) : null;
};

export const laterOf = (...ds: (Date | null)[]): Date =>
	new Date(Math.max(...ds.filter((d): d is Date => d !== null).map((d) => d.getTime())));

// Cin7 may name a zone Intl does not know (a Windows zone name), so callers fall back instead.
export function validTimeZone(tz: string | null | undefined): string | null {
	if (!tz) return null;
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: tz });
		return tz;
	} catch {
		return null;
	}
}

// Wall-clock calendar day and minutes past midnight of an instant in an IANA zone.
export function zonedParts(at: Date, timeZone: string): { ymd: string; minutes: number } {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone,
		hourCycle: "h23",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	}).formatToParts(at);
	const get = (type: Intl.DateTimeFormatPartTypes) =>
		parts.find((p) => p.type === type)?.value ?? "";
	return {
		ymd: `${get("year")}-${get("month")}-${get("day")}`,
		minutes: Number(get("hour")) * 60 + Number(get("minute")),
	};
}

export function addDays(ymd: string, days: number): string {
	const d = ymdToDbDate(ymd);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}

// Today's calendar day in the Cin7 zone, falling back to the configured zone, then UTC.
export async function resolveToday(deps: {
	db: Db;
	clock?: () => Date;
	timeZone?: string;
}): Promise<string> {
	const tz =
		validTimeZone((await getCachedMe(deps.db))?.timeZone) ??
		validTimeZone(deps.timeZone) ??
		"UTC";
	return zonedParts((deps.clock ?? (() => new Date()))(), tz).ymd;
}
