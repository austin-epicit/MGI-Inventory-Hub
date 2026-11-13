export type CsvColumn<T> = {
	label: string;
	value: (row: T) => string | number | null | undefined;
};

const BOM = "\uFEFF";
const FORMULA_START = /^[=+\-@\t\r]/;

/** One CSV field. Numbers pass through untouched (a negative stays a number); text that a
 * spreadsheet could read as a formula gets a leading apostrophe, then RFC 4180 quoting. */
export function csvCell(v: string | number | null | undefined): string {
	if (v === null || v === undefined) return "";
	if (typeof v === "number") return String(v);
	const text = FORMULA_START.test(v) ? `'${v}` : v;
	return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
	const lines = [
		columns.map((c) => csvCell(c.label)).join(","),
		...rows.map((r) => columns.map((c) => csvCell(c.value(r))).join(",")),
	];
	return `${BOM}${lines.join("\r\n")}\r\n`;
}

export function downloadCsv<T>(filename: string, columns: CsvColumn<T>[], rows: T[]): void {
	const blob = new Blob([toCsv(columns, rows)], { type: "text/csv;charset=utf-8" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 0); // revoking inside the click can cancel the download
}

/** The browser's local calendar date, for filenames. */
export function localYmd(d: Date = new Date()): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Server-side export URL for a list page: the same filter and sort params, never paging. */
export function exportHref(path: string, params: Record<string, string | undefined>): string {
	const qs = new URLSearchParams();
	for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, v);
	const s = qs.toString();
	return `${path}/export.csv${s ? `?${s}` : ""}`;
}
