import { createHash, timingSafeEqual } from "node:crypto";
import { Router, type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";
import type { Db } from "../db.js";
import { createSuccessResponse, httpError } from "../http/responses.js";
import { validate } from "../http/validate.js";
import { createLoginGuard, createLoginLimiter, createTokenLimiter } from "./loginGuard.js";
import { hashPassword, passwordSchema, verifyPassword } from "./password.js";
import { clearSession, issueSession, type AuthConfig } from "./session.js";
import { consumeAuthToken, type TokenKind } from "./tokens.js";

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email());

const sameSecret = (a: string, b: string): boolean =>
	timingSafeEqual(
		createHash("sha256").update(a).digest(),
		createHash("sha256").update(b).digest()
	);

type Deps = { db: Db; clock: () => Date; auth: AuthConfig };

const publicUser = (u: { id: string; email: string; name: string; role: string }) => ({
	id: u.id,
	email: u.email,
	name: u.name,
	role: u.role,
});

export const createAuthRoutes = (deps: Deps, requireAuth: RequestHandler): Router => {
	const { db, clock, auth } = deps;
	const router = Router();
	const guard = createLoginGuard(clock);
	const tokenLimiter = createTokenLimiter();
	const loginLimiter = createLoginLimiter();

	router.get("/setup-status", async (_req, res) => {
		res.json(createSuccessResponse({ needsSetup: (await db.user.count()) === 0 }));
	});

	router.post(
		"/setup",
		tokenLimiter,
		validate({
			body: z.object({
				setupToken: z.string().min(1),
				name: z.string().trim().min(1).max(200),
				email: emailSchema,
				password: passwordSchema,
			}),
		}),
		async (req, res) => {
			const { setupToken, name, email, password } = req.valid.body;
			const alreadySetUp = () =>
				httpError(409, "ALREADY_SET_UP", "The first admin already exists");
			if ((await db.user.count()) > 0) throw alreadySetUp();
			if (!sameSecret(setupToken, auth.setupToken)) {
				const bad = httpError(
					403,
					"BAD_SETUP_TOKEN",
					"Setup token is incorrect"
				);
				bad.field = "setupToken";
				throw bad;
			}
			const password_hash = await hashPassword(password);
			const user = await db.$transaction(async (tx) => {
				// Serializes two simultaneous setups; the loser sees the winner's row.
				await tx.$executeRaw`SELECT pg_advisory_xact_lock(7001, 0)`;
				if ((await tx.user.count()) > 0) throw alreadySetUp();
				return tx.user.create({
					data: { email, name, password_hash, role: "admin" },
				});
			});
			issueSession(res, user, auth, clock());
			res.status(201).json(createSuccessResponse(publicUser(user)));
		}
	);

	router.post(
		"/login",
		loginLimiter,
		validate({
			body: z.object({
				email: emailSchema,
				password: z.string().min(1).max(1000),
			}),
		}),
		async (req, res) => {
			const { email, password } = req.valid.body;
			if (guard.isLocked(email, req.ip ?? "")) {
				throw httpError(
					429,
					"TOO_MANY_ATTEMPTS",
					"Too many failed attempts. Try again in 15 minutes."
				);
			}
			const user = await db.user.findUnique({ where: { email } });
			const ok = await verifyPassword(user?.password_hash ?? null, password);
			if (!user || !ok || user.deactivated_at) {
				guard.recordFailure(email, req.ip ?? "");
				throw httpError(
					401,
					"INVALID_CREDENTIALS",
					"Invalid email or password"
				);
			}
			guard.recordSuccess(email, req.ip ?? "");
			issueSession(res, user, auth, clock());
			res.json(createSuccessResponse(publicUser(user)));
		}
	);

	router.post("/logout", (_req, res) => {
		clearSession(res, auth);
		res.json(createSuccessResponse({ loggedOut: true }));
	});

	router.get("/me", requireAuth, (req, res) => {
		res.json(createSuccessResponse(publicUser(req.user!)));
	});

	const spendToken = (kind: TokenKind) => async (req: Request, res: Response) => {
		const { token, password } = req.valid.body;
		const password_hash = await hashPassword(password);
		const now = clock();
		let userId = "";
		const done = await consumeAuthToken(db, token, kind, now, async (tx, id) => {
			userId = id;
			await tx.user.update({
				where: { id },
				data: { password_hash, session_version: { increment: 1 } },
			});
		});
		if (!done)
			throw httpError(
				400,
				"INVALID_TOKEN",
				"This link is invalid or has expired"
			);
		const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
		if (user.deactivated_at)
			throw httpError(403, "DEACTIVATED", "This account is deactivated");
		issueSession(res, user, auth, now);
		res.json(createSuccessResponse(publicUser(user)));
	};

	const tokenBody = validate({
		body: z.object({ token: z.string().min(1).max(200), password: passwordSchema }),
	});
	router.post("/accept-invite", tokenLimiter, tokenBody, spendToken("invite"));
	router.post("/reset", tokenLimiter, tokenBody, spendToken("reset"));

	return router;
};
