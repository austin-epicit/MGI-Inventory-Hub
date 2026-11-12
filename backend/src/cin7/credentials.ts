import crypto from "node:crypto";
import type { Db } from "../db.js";

export const parseKey = (base64: string): Buffer => Buffer.from(base64, "base64");

// AES-256-GCM; stored as iv:tag:ciphertext (hex). The tag makes tampering fail loudly on decrypt.
export function encryptSecret(secret: string, key: Buffer): string {
	const iv = crypto.randomBytes(12);
	const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
	const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
	return [iv, cipher.getAuthTag(), encrypted].map((b) => b.toString("hex")).join(":");
}

export function decryptSecret(blob: string, key: Buffer): string {
	const [ivHex, tagHex, dataHex] = blob.split(":");
	if (!ivHex || !tagHex || dataHex === undefined) throw new Error("malformed secret");
	const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
	decipher.setAuthTag(Buffer.from(tagHex, "hex"));
	return Buffer.concat([
		decipher.update(Buffer.from(dataHex, "hex")),
		decipher.final(),
	]).toString("utf8");
}

export const ACCOUNT_FINGERPRINT_KEY = "cin7.account_fingerprint";

// Survives Disconnect (which deletes the credentials row) so reconnecting the same account is
// still recognised; a hash, so no account ID sits in app_setting.
export const accountFingerprint = (accountId: string): string =>
	crypto.createHash("sha256").update(accountId.trim().toLowerCase()).digest("hex");

export type Cin7Credentials = { accountId: string; applicationKey: string };

export async function saveCredentials(
	db: Db,
	key: Buffer,
	creds: Cin7Credentials,
	verifiedAt: Date
): Promise<void> {
	const data = {
		account_id_enc: encryptSecret(creds.accountId, key),
		application_key_enc: encryptSecret(creds.applicationKey, key),
		verified_at: verifiedAt,
	};
	await db.cin7_connection.upsert({
		where: { id: 1 },
		create: { id: 1, ...data },
		update: data,
	});
}

export async function loadCredentials(
	db: Db,
	key: Buffer
): Promise<(Cin7Credentials & { verifiedAt: Date | null }) | null> {
	const row = await db.cin7_connection.findUnique({ where: { id: 1 } });
	if (!row) return null;
	return {
		accountId: decryptSecret(row.account_id_enc, key),
		applicationKey: decryptSecret(row.application_key_enc, key),
		verifiedAt: row.verified_at,
	};
}

export async function deleteCredentials(db: Db): Promise<void> {
	await db.cin7_connection.deleteMany({});
}
