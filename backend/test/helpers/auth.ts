import type { Express } from "express";
import request from "supertest";
import { hashPassword } from "../../src/auth/password.js";
import { TEST_BASE_URL } from "./app.js";
import { testDb } from "./db.js";

export const PASSWORD = "correct horse battery";

let cachedHash: string | undefined;

// One bcrypt hash reused across inserts keeps the suite fast.
export const insertUser = async (
	email: string,
	role: "admin" | "viewer" = "viewer",
	extra: { deactivated?: boolean; password?: string | null } = {}
) => {
	cachedHash ??= await hashPassword(PASSWORD);
	return testDb.user.create({
		data: {
			email,
			name: email.split("@")[0],
			role,
			password_hash: extra.password === null ? null : cachedHash,
			deactivated_at: extra.deactivated ? new Date() : null,
		},
	});
};

export const agentFor = (app: Express) => request.agent(app).set("Origin", TEST_BASE_URL);

export type Agent = ReturnType<typeof agentFor>;

export const loginAs = async (app: Express, email: string): Promise<Agent> => {
	const agent = agentFor(app);
	const res = await agent.post("/api/auth/login").send({ email, password: PASSWORD });
	if (res.status !== 200) {
		throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
	}
	return agent;
};

export const tokenFromUrl = (url: string): string => url.split("/").pop()!;

export const clockAt = (iso: string) => {
	let now = new Date(iso);
	return {
		clock: () => now,
		advance: (ms: number) => {
			now = new Date(now.getTime() + ms);
		},
	};
};
