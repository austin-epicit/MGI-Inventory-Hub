import { rateLimit } from "express-rate-limit";
import { createErrorResponse } from "../http/responses.js";

const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60_000;

type Entry = { failures: number; lockedUntil: number };

// In memory: the API runs as a single instance, so a restart clearing locks is acceptable.
export const createLoginGuard = (clock: () => Date) => {
	const entries = new Map<string, Entry>();
	// Per (email, IP): one client cannot lock a victim out for everyone else.
	const key = (email: string, ip: string) => `${email.toLowerCase()}|${ip}`;

	const sweep = (now: number) => {
		if (entries.size < 1000) return;
		for (const [k, e] of entries) if (e.lockedUntil <= now) entries.delete(k);
	};

	return {
		isLocked(email: string, ip: string): boolean {
			const e = entries.get(key(email, ip));
			if (!e) return false;
			if (e.lockedUntil > clock().getTime()) return true;
			if (e.lockedUntil !== 0) entries.delete(key(email, ip)); // lock served: start clean
			return false;
		},
		recordFailure(email: string, ip: string): void {
			const now = clock().getTime();
			sweep(now);
			const e = entries.get(key(email, ip)) ?? { failures: 0, lockedUntil: 0 };
			e.failures += 1;
			if (e.failures >= MAX_FAILURES) e.lockedUntil = now + LOCK_MS;
			entries.set(key(email, ip), e);
		},
		recordSuccess(email: string, ip: string): void {
			entries.delete(key(email, ip));
		},
	};
};

export type LoginGuard = ReturnType<typeof createLoginGuard>;

// Setup, invite and reset are unauthenticated token endpoints; cap them per IP.
const perIpLimiter = (limit: number) =>
	rateLimit({
		windowMs: 15 * 60_000,
		limit,
		standardHeaders: "draft-8",
		legacyHeaders: false,
		handler: (_req, res) => {
			res.status(429).json(
				createErrorResponse(
					"TOO_MANY_ATTEMPTS",
					"Too many attempts. Try again in 15 minutes."
				)
			);
		},
	});

export const createTokenLimiter = () => perIpLimiter(20);
export const createLoginLimiter = () => perIpLimiter(30);
