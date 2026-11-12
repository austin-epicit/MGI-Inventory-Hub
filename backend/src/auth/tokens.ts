import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "../../generated/prisma/client.js";
import type { Db } from "../db.js";

export type TokenKind = "invite" | "reset";

export const TOKEN_TTL_MS: Record<TokenKind, number> = {
	invite: 7 * 24 * 3_600_000,
	reset: 24 * 3_600_000,
};

export const hashToken = (token: string): string =>
	createHash("sha256").update(token).digest("hex");

// Only the hash is stored, so a database leak does not yield usable links.
export const issueAuthToken = async (
	db: Db,
	userId: string,
	kind: TokenKind,
	now: Date
): Promise<string> => {
	const token = randomBytes(32).toString("base64url");
	await db.$transaction([
		// A fresh link replaces any earlier unused one of the same kind.
		db.auth_token.updateMany({
			where: { user_id: userId, kind, used_at: null },
			data: { used_at: now },
		}),
		db.auth_token.create({
			data: {
				user_id: userId,
				kind,
				token_hash: hashToken(token),
				expires_at: new Date(now.getTime() + TOKEN_TTL_MS[kind]),
			},
		}),
	]);
	return token;
};

// Single use: the conditional update lets exactly one of two parallel requests win.
export const consumeAuthToken = async (
	db: Db,
	token: string,
	kind: TokenKind,
	now: Date,
	apply: (tx: Prisma.TransactionClient, userId: string) => Promise<void>
): Promise<boolean> =>
	db.$transaction(async (tx) => {
		const row = await tx.auth_token.findUnique({
			where: { token_hash: hashToken(token) },
		});
		if (!row || row.kind !== kind) return false;
		const { count } = await tx.auth_token.updateMany({
			where: { id: row.id, used_at: null, expires_at: { gt: now } },
			data: { used_at: now },
		});
		if (count !== 1) return false;
		await apply(tx, row.user_id);
		return true;
	});
