import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

export type Db = PrismaClient;

export const createDb = (connectionString: string): Db =>
	new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const globalForPrisma = globalThis as unknown as { prisma: Db | undefined };

// Cached on globalThis so tsx watch reloads reuse one pool.
export const getDb = (connectionString: string): Db => {
	globalForPrisma.prisma ??= createDb(connectionString);
	return globalForPrisma.prisma;
};
