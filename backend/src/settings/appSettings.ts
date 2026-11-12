import type { Prisma } from "../../generated/prisma/client.js";
import type { Db } from "../db.js";

export const getSetting = async <T = unknown>(db: Db, key: string): Promise<T | null> => {
	const row = await db.app_setting.findUnique({ where: { key } });
	return row ? (row.value as T) : null;
};

export const setSetting = async (
	db: Db,
	key: string,
	value: Prisma.InputJsonValue
): Promise<void> => {
	await db.app_setting.upsert({ where: { key }, create: { key, value }, update: { value } });
};
