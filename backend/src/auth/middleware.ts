import type { RequestHandler } from "express";
import type { Db } from "../db.js";
import { httpError } from "../http/responses.js";
import {
	clearSession,
	issueSession,
	SESSION_COOKIE,
	verifySession,
	type AuthConfig,
} from "./session.js";

export type AuthUser = { id: string; email: string; name: string; role: "admin" | "viewer" };

declare global {
	// eslint-disable-next-line @typescript-eslint/no-namespace
	namespace Express {
		interface Request {
			user?: AuthUser;
		}
	}
}

const unauthenticated = () => httpError(401, "UNAUTHENTICATED", "Sign in required");

export const createRequireAuth =
	(db: Db, cfg: AuthConfig, clock: () => Date): RequestHandler =>
	async (req, res, next) => {
		const token = req.cookies?.[SESSION_COOKIE];
		const now = clock();
		const session = typeof token === "string" ? verifySession(token, cfg, now) : null;
		if (!session) return next(unauthenticated());
		// Role and deactivation come from the row, never the token, so changes bite immediately.
		const user = await db.user.findUnique({ where: { id: session.userId } });
		// A password reset bumps session_version, which kills every session issued before it.
		if (
			!user ||
			user.deactivated_at ||
			user.session_version !== session.sessionVersion
		) {
			clearSession(res, cfg);
			return next(unauthenticated());
		}
		req.user = { id: user.id, email: user.email, name: user.name, role: user.role };
		// Sliding: re-issue once less than half the lifetime remains.
		if (session.secondsLeft < (cfg.sessionTtlHours * 3600) / 2) {
			issueSession(res, user, cfg, now);
		}
		next();
	};

export const requireRole =
	(role: AuthUser["role"]): RequestHandler =>
	(req, _res, next) => {
		if (req.user?.role !== role)
			return next(httpError(403, "FORBIDDEN", "Not allowed"));
		next();
	};
