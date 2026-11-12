import { Prisma } from "../../generated/prisma/client.js";

const { Decimal } = Prisma;
const HALF_UP = Decimal.ROUND_HALF_UP;

export const round4 = (n: number): number => new Decimal(n).toDecimalPlaces(4, HALF_UP).toNumber();

// rate = base units per document-currency unit (Cin7's CurrencyRate). A zero rate would silently
// zero every total, so fail loudly instead.
export function toBase(amount: number, rate: number): number {
	if (!Number.isFinite(rate) || rate <= 0)
		throw new RangeError(`invalid CurrencyRate: ${rate}`);
	return round4(new Decimal(amount).mul(rate).toNumber());
}

// Unit price after the line discount; rounding happens once, in toBase.
export const netUnit = (price: number, discountPct: number): number =>
	new Decimal(price).mul(new Decimal(100).minus(discountPct)).div(100).toNumber();

// Decimal-safe strings for Prisma money columns (never float arithmetic into the database).
export const dec4 = (n: number): string => new Decimal(n).toFixed(4, HALF_UP);
export const dec2 = (n: number): string => new Decimal(n).toFixed(2, HALF_UP);
export const dec6 = (n: number): string => new Decimal(n).toFixed(6, HALF_UP);

// Typed so the sync engine can record a bad document and keep going.
export class Cin7DataError extends Error {
	constructor(
		message: string,
		readonly recordId: string
	) {
		super(message);
		this.name = "Cin7DataError";
	}
}

// Missing/0/non-finite CurrencyRate: same-currency documents are 1:1; an uncounted foreign one
// stores 0 base amounts (charts never read it, raw keeps the truth); a counted one is an error.
export function baseConverter(
	rate: number | null | undefined,
	currency: string,
	baseCurrency: string,
	counted: boolean,
	recordId: string
): { rate: number; toBase: (amount: number) => number } {
	if (typeof rate === "number" && Number.isFinite(rate) && rate > 0) {
		return { rate, toBase: (a) => toBase(a, rate) };
	}
	if (currency === baseCurrency) return { rate: 1, toBase: (a) => toBase(a, 1) };
	if (!counted) return { rate: 0, toBase: () => 0 };
	throw new Cin7DataError(`counted ${currency} document has CurrencyRate ${rate}`, recordId);
}
