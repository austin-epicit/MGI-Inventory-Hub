let baseCurrency = "USD";
let appTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

// An unknown zone makes every Intl.DateTimeFormat throw, which would blank the whole app.
function validZone(timeZone: string): boolean {
	try {
		new Intl.DateTimeFormat("en-US", { timeZone });
		return true;
	} catch {
		return false;
	}
}

// Set once the app settings load (Cin7's base currency and time zone).
export function setFormatContext(ctx: { currency?: string; timeZone?: string }) {
	if (ctx.currency) baseCurrency = ctx.currency;
	if (ctx.timeZone && validZone(ctx.timeZone)) appTimeZone = ctx.timeZone;
}

export const camelCaseToRegular = (str: string) =>
	str.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (m) => m.toUpperCase());

export const formatter = new Intl.NumberFormat(navigator.languages, {
	notation: "compact",
	compactDisplay: "short",
});

const moneyFormats = new Map<string, Intl.NumberFormat>();
const plainNumber = new Intl.NumberFormat("en-US", {
	minimumFractionDigits: 2,
	maximumFractionDigits: 2,
});

function moneyFormat(currency: string): Intl.NumberFormat | null {
	let f = moneyFormats.get(currency);
	if (!f) {
		try {
			f = new Intl.NumberFormat("en-US", {
				style: "currency",
				currency,
				minimumFractionDigits: 2,
				maximumFractionDigits: 2,
			});
		} catch {
			return null; // not a currency code Intl knows
		}
		moneyFormats.set(currency, f);
	}
	return f;
}

// An unknown currency code degrades to a plain number with the code in front, never a render crash.
export function formatMoney(n: number, currency: string = baseCurrency): string {
	const f = moneyFormat(currency);
	return f ? f.format(n) : `${currency} ${plainNumber.format(n)}`;
}

const qtyFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });

// Quantities: Cin7 allows fractional units, up to 4 dp.
export const formatQty = (n: number): string => qtyFormat.format(n);

const countFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export const formatCount = (n: number): string => countFormat.format(n);

// Word only, so call sites keep their own number formatting: `${formatCount(n)} ${plural(n, "unit")}`.
export const plural = (n: number, singular: string, pluralForm: string = `${singular}s`): string =>
	n === 1 ? singular : pluralForm;

const percentFormats = new Map<number, Intl.NumberFormat>();

// Rounds to the displayed precision before choosing a sign, so -0.03 reads "0.0%" and never "−0.0%".
export function formatPercent(n: number, opts: { signed?: boolean; dp?: number } = {}): string {
	const dp = opts.dp ?? 1;
	let f = percentFormats.get(dp);
	if (!f) {
		f = new Intl.NumberFormat("en-US", {
			minimumFractionDigits: dp,
			maximumFractionDigits: dp,
		});
		percentFormats.set(dp, f);
	}
	const body = f.format(Math.abs(n));
	const rounded = Number(body.replace(/,/g, ""));
	if (rounded === 0) return `${body}%`;
	const sign = n < 0 ? "−" : opts.signed ? "+" : "";
	return `${sign}${body}%`;
}

const compactMoneyFormats = new Map<string, Intl.NumberFormat>();

// Axis ticks: "$1.2K". An unknown currency code falls back to the full amount.
export function formatMoneyCompact(n: number, currency: string = baseCurrency): string {
	let f = compactMoneyFormats.get(currency);
	if (!f) {
		try {
			f = new Intl.NumberFormat("en-US", {
				style: "currency",
				currency,
				notation: "compact",
				maximumFractionDigits: 1,
			});
		} catch {
			return formatMoney(n, currency);
		}
		compactMoneyFormats.set(currency, f);
	}
	return f.format(n);
}

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
const dateFormat = new Intl.DateTimeFormat("en-US", {
	timeZone: "UTC",
	month: "short",
	day: "numeric",
	year: "numeric",
});

// Calendar date: formatted in UTC from the parts, so no time zone can move the day. Anything that
// is not a real date (including 2026-02-31) comes back as written rather than rolled forward.
export function formatDate(ymd: string): string {
	const m = YMD.exec(ymd);
	if (!m) return ymd;
	const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
	const date = new Date(Date.UTC(y, mo - 1, d));
	if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d)
		return ymd;
	return dateFormat.format(date);
}

const dateTimeFormats = new Map<string, Intl.DateTimeFormat>();

export function formatDateTime(iso: string): string {
	let f = dateTimeFormats.get(appTimeZone);
	if (!f) {
		f = new Intl.DateTimeFormat("en-US", {
			timeZone: appTimeZone,
			month: "short",
			day: "numeric",
			year: "numeric",
			hour: "numeric",
			minute: "2-digit",
		});
		dateTimeFormats.set(appTimeZone, f);
	}
	return f.format(new Date(iso));
}

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "always" });

export function formatRelative(iso: string, now: number = Date.now()): string {
	const secs = Math.round((Date.parse(iso) - now) / 1000);
	const abs = Math.abs(secs);
	if (abs < 45) return "just now";
	if (abs < 3600) return rtf.format(Math.round(secs / 60), "minute");
	if (abs < 86_400) return rtf.format(Math.round(secs / 3600), "hour");
	return rtf.format(Math.round(secs / 86_400), "day");
}

const ymdParts = new Map<string, Intl.DateTimeFormat>();

// Today's calendar date in the Cin7 app zone, never the browser zone.
export function todayYmd(now: Date = new Date()): string {
	let f = ymdParts.get(appTimeZone);
	if (!f) {
		f = new Intl.DateTimeFormat("en-CA", {
			timeZone: appTimeZone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
		});
		ymdParts.set(appTimeZone, f);
	}
	const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
	return `${p.year}-${p.month}-${p.day}`;
}
