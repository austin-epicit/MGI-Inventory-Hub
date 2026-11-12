const STAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,7}))?(Z)?$/;

// Cin7 modification stamps vary: with or without a trailing "Z", 0-7 fraction digits. A stamp
// without a zone is UTC (the API is documented as UTC), never the server's local time.
export function parseCin7Stamp(s: string): Date {
	const m = STAMP.exec(s.trim());
	if (!m) throw new RangeError(`not a Cin7 timestamp: ${s}`);
	const ms = m[7] ? Number(m[7].slice(0, 3).padEnd(3, "0")) : 0;
	return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], ms));
}
