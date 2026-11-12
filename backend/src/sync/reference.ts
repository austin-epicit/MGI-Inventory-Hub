import type { Prisma } from "../../generated/prisma/client.js";
import type { Db } from "../db.js";
import type { Cin7Customer, Cin7Location, Cin7PriceTier, Cin7Supplier } from "../cin7/schemas.js";
import { parseCin7Timestamp } from "./dates.js";

const json = (v: unknown) => v as Prisma.InputJsonValue;
const stamp = (s: string | null | undefined) => (s ? parseCin7Timestamp(s) : null);
const CHUNK = 200;

async function inChunks<T>(db: Db, items: T[], op: (t: T) => Prisma.PrismaPromise<unknown>) {
	for (let i = 0; i < items.length; i += CHUNK) {
		await db.$transaction(items.slice(i, i + CHUNK).map(op));
	}
}

export async function upsertReference(
	db: Db,
	ref: {
		tiers: Cin7PriceTier[];
		locations: Cin7Location[];
		suppliers: Cin7Supplier[];
		customers: Cin7Customer[];
	},
	now: Date
): Promise<void> {
	await inChunks(db, ref.tiers, (t) =>
		db.price_tier.upsert({
			where: { code: t.Code },
			create: { code: t.Code, name: t.Name, synced_at: now },
			update: { name: t.Name, synced_at: now },
		})
	);
	await inChunks(db, ref.locations, (l) => {
		const data = {
			name: l.Name,
			is_deprecated: l.IsDeprecated ?? false,
			raw: json(l),
			synced_at: now,
		};
		return db.location.upsert({
			where: { id: l.ID },
			create: { id: l.ID, ...data },
			update: data,
		});
	});
	await inChunks(db, ref.suppliers, (s) => {
		const data = {
			name: s.Name,
			currency: s.Currency ?? null,
			raw: json(s),
			cin7_modified_at: stamp(s.LastModifiedOn),
			synced_at: now,
		};
		return db.supplier.upsert({
			where: { id: s.ID },
			create: { id: s.ID, ...data },
			update: data,
		});
	});
	await inChunks(db, ref.customers, (c) => {
		const data = {
			name: c.Name,
			currency: c.Currency ?? null,
			raw: json(c),
			cin7_modified_at: stamp(c.LastModifiedOn),
			synced_at: now,
		};
		return db.customer.upsert({
			where: { id: c.ID },
			create: { id: c.ID, ...data },
			update: data,
		});
	});
}
