import type { Response } from "express";
import jwt from "jsonwebtoken";

export const SESSION_COOKIE = "mgi_session";

export type AuthConfig = {
	jwtSecret: string;
	sessionTtlHours: number;
	setupToken: string;
	secureCookie: boolean;
};

export type SessionUser = { id: string; role: string; session_version: number };

const cookieOptions = (cfg: AuthConfig) => ({
	httpOnly: true,
	sameSite: "strict" as const,
	secure: cfg.secureCookie,
	path: "/",
});

export const issueSession = (
	res: Response,
	user: SessionUser,
	cfg: AuthConfig,
	now: Date
): void => {
	const iat = Math.floor(now.getTime() / 1000);
	const ttlSeconds = Math.round(cfg.sessionTtlHours * 3600);
	const token = jwt.sign(
		{
			sub: user.id,
			role: user.role,
			sv: user.session_version,
			iat,
			exp: iat + ttlSeconds,
		},
		cfg.jwtSecret,
		{ algorithm: "HS256" }
	);
	res.cookie(SESSION_COOKIE, token, { ...cookieOptions(cfg), maxAge: ttlSeconds * 1000 });
};

export const clearSession = (res: Response, cfg: AuthConfig): void => {
	res.clearCookie(SESSION_COOKIE, cookieOptions(cfg));
};

export type VerifiedSession = { userId: string; sessionVersion: number; secondsLeft: number };

// The clock is injected so expiry follows the app clock, not the wall clock.
export const verifySession = (
	token: string,
	cfg: AuthConfig,
	now: Date
): VerifiedSession | null => {
	try {
		const nowSec = Math.floor(now.getTime() / 1000);
		const p = jwt.verify(token, cfg.jwtSecret, {
			algorithms: ["HS256"],
			clockTimestamp: nowSec,
		});
		if (
			typeof p === "string" ||
			typeof p.sub !== "string" ||
			typeof p.exp !== "number"
		) {
			return null;
		}
		return {
			userId: p.sub,
			sessionVersion: typeof p.sv === "number" ? p.sv : -1,
			secondsLeft: p.exp - nowSec,
		};
	} catch {
		return null;
	}
};
