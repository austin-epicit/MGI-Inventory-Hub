import { api } from "../../lib/api";
import type { UserRole } from "../../types/user";

export type SyncSource = "fixture" | "http";
export type SyncKind = "incremental" | "reconcile" | "backfill";
export type RemapEntity = "product" | "purchase" | "sale";

export interface SyncStatus {
	source: SyncSource;
	connected: boolean;
	running: boolean;
	lastSuccessAt: string | null;
	lastRun: {
		kind: string;
		status: "ok" | "partial" | "failed";
		errorCode: string | null;
		errorMessage: string | null;
		finishedAt: string | null;
	} | null;
	perEntity: { entity: string; lastSuccessAt: string | null; backfillDone: boolean }[];
	backfill: { done: boolean; progressPct: number };
	quarantined: {
		count: number;
		items: {
			entity: string;
			recordId: string;
			attempts: number;
			lastCode: string;
			lastMessage: string;
			lastFailedAt: string;
		}[];
	};
	baseCurrency: string | null;
	timeZone: string;
	webhooks: {
		registered: boolean;
		inactiveTypes: string[];
		reactivatedTypes: string[];
		lastCheckAt: string | null;
		lastEventAt: string | null;
	};
}

export interface WebhookSettings {
	registered: boolean;
	types: { type: string; active: boolean }[];
	registeredAt: string | null;
	lastCheckAt: string | null;
	reactivatedAt: string | null;
	reactivatedTypes: string[];
	lastEventAt: string | null;
}

export interface Cin7Connection {
	source: SyncSource;
	connected: boolean;
	accountIdMasked: string | null;
	// The stored credentials failed to decrypt (rotated key or damaged row); re-enter them.
	unreadable: boolean;
	verifiedAt: string | null;
	company: string | null;
	baseCurrency: string | null;
	timeZone: string | null;
}

export interface UserRow {
	id: string;
	email: string;
	name: string;
	role: UserRole;
	deactivated: boolean;
	pendingInvite: boolean;
	createdAt: string;
}

const json = (body: unknown) => JSON.stringify(body);

export const fetchSyncStatus = () => api<SyncStatus>("/api/sync/status");
export const runSync = (kind: SyncKind) =>
	api<{ started: boolean }>("/api/sync/run", { method: "POST", body: json({ kind }) });
export const remap = (entity: RemapEntity) =>
	api<{ entity: RemapEntity; remapped: number; skipped: number }>("/api/sync/remap", {
		method: "POST",
		body: json({ entity }),
	});

export const fetchCin7 = () => api<Cin7Connection>("/api/settings/cin7");
export const saveCin7 = (creds: {
	accountId: string;
	applicationKey: string;
	confirmReplace?: boolean;
}) => api<Cin7Connection>("/api/settings/cin7", { method: "PUT", body: json(creds) });
export const disconnectCin7 = () => api<Cin7Connection>("/api/settings/cin7", { method: "DELETE" });

export const fetchWebhooks = () => api<WebhookSettings>("/api/settings/webhooks");
export const registerWebhooks = () =>
	api<WebhookSettings>("/api/settings/webhooks/register", { method: "POST" });

export const fetchUsers = () => api<UserRow[]>("/api/users");
export const inviteUser = (u: { email: string; name: string; role: UserRole }) =>
	api<{ inviteUrl: string }>("/api/users/invites", { method: "POST", body: json(u) });
export const updateUser = (id: string, patch: { role?: UserRole; deactivated?: boolean }) =>
	api<UserRow>(`/api/users/${id}`, { method: "PATCH", body: json(patch) });
export const resetLink = (id: string) =>
	api<{ resetUrl: string }>(`/api/users/${id}/reset-link`, { method: "POST" });
