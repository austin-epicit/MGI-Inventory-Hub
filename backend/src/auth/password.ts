import bcrypt from "bcryptjs";
import { z } from "zod";

const COST = 12;

export const hashPassword = (password: string): Promise<string> => bcrypt.hash(password, COST);

let dummyHash: Promise<string> | undefined;

// Compares against a throwaway hash when there is no real one, so an unknown email costs
// the same bcrypt time as a wrong password.
export const verifyPassword = async (hash: string | null, password: string): Promise<boolean> => {
	if (!hash) {
		dummyHash ??= bcrypt.hash("never-a-real-password", COST);
		await bcrypt.compare(password, await dummyHash);
		return false;
	}
	return bcrypt.compare(password, hash);
};

// bcrypt ignores everything past 72 bytes, so a longer password would be silently truncated.
export const passwordSchema = z
	.string()
	.min(12, "must be at least 12 characters")
	.refine((p) => Buffer.byteLength(p) <= 72, "must be at most 72 bytes");
