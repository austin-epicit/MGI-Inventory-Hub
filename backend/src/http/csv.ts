import type { Response } from "express";
import { httpError } from "./responses.js";

export type CsvCell = string | number | null | undefined;
export type CsvColumn<T> = { label: string; value: (row: T) => CsvCell };

export const EXPORT_ROW_CAP = 50_000;

const BOM = "\uFEFF";
// A spreadsheet runs a text cell starting with one of these as a formula.
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(v: CsvCell): string {
	if (v === null || v === undefined) return "";
	if (typeof v === "number") return String(v); // never guarded: -12.5 must stay a number
	const s = FORMULA_START.test(v) ? `'${v}` : v;
	return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
	const lines = [
		columns.map((c) => csvCell(c.label)).join(","),
		...rows.map((r) => columns.map((c) => csvCell(c.value(r))).join(",")),
	];
	return `${BOM}${lines.join("\r\n")}\r\n`;
}

export const exportFilename = (table: string, today: string): string => `mgi-${table}-${today}.csv`;

export function sendCsv(res: Response, filename: string, csv: string): void {
	res.status(200)
		.set({
			"Content-Type": "text/csv; charset=utf-8",
			"Content-Disposition": `attachment; filename="${filename}"`,
			"Cache-Control": "no-store",
		})
		.send(csv);
}

export function assertWithinCap(total: number, cap: number): void {
	if (total > cap) {
		throw httpError(
			422,
			"TOO_MANY_ROWS",
			"Too many rows to export. Narrow the filters."
		);
	}
}
