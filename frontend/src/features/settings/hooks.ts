import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UserRole } from "../../types/user";
import {
	disconnectCin7,
	fetchCin7,
	fetchSyncStatus,
	fetchUsers,
	fetchWebhooks,
	inviteUser,
	registerWebhooks,
	remap,
	resetLink,
	runSync,
	saveCin7,
	updateUser,
} from "./api";

const STATUS_KEY = ["sync", "status"] as const;
const CIN7_KEY = ["settings", "cin7"] as const;
const USERS_KEY = ["users"] as const;
const WEBHOOKS_KEY = ["settings", "webhooks"] as const;

// Polls fast while a run is live so "Sync now" visibly finishes, slowly otherwise.
export const useSyncStatus = () =>
	useQuery({
		queryKey: STATUS_KEY,
		queryFn: fetchSyncStatus,
		staleTime: 0,
		refetchInterval: (q) => (q.state.data?.running ? 2_000 : 30_000),
	});

export const useCin7Connection = () => useQuery({ queryKey: CIN7_KEY, queryFn: fetchCin7 });

function useRefreshConnection() {
	const qc = useQueryClient();
	return () =>
		Promise.all([
			qc.invalidateQueries({ queryKey: CIN7_KEY }),
			qc.invalidateQueries({ queryKey: STATUS_KEY }),
		]);
}

export function useSaveCin7() {
	const refresh = useRefreshConnection();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: saveCin7,
		onSuccess: (_data, vars) =>
			// A replaced account wipes the mirror, so every cached list and report is stale.
			vars.confirmReplace ? qc.invalidateQueries() : refresh(),
	});
}

export function useDisconnectCin7() {
	const refresh = useRefreshConnection();
	return useMutation({ mutationFn: disconnectCin7, onSuccess: refresh });
}

export function useRunSync() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: runSync,
		onSettled: () => qc.invalidateQueries({ queryKey: STATUS_KEY }),
	});
}

export const useRemap = () => useMutation({ mutationFn: remap });

export const useUsers = () => useQuery({ queryKey: USERS_KEY, queryFn: fetchUsers });

export function useInviteUser() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: inviteUser,
		onSuccess: () => qc.invalidateQueries({ queryKey: USERS_KEY }),
	});
}

export function useUpdateUser() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (v: { id: string; role?: UserRole; deactivated?: boolean }) =>
			updateUser(v.id, { role: v.role, deactivated: v.deactivated }),
		onSettled: () => qc.invalidateQueries({ queryKey: USERS_KEY }),
	});
}

export const useResetLink = () => useMutation({ mutationFn: resetLink });

export const useWebhooks = () => useQuery({ queryKey: WEBHOOKS_KEY, queryFn: fetchWebhooks });

export function useRegisterWebhooks() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: registerWebhooks,
		onSuccess: () =>
			Promise.all([
				qc.invalidateQueries({ queryKey: WEBHOOKS_KEY }),
				qc.invalidateQueries({ queryKey: STATUS_KEY }),
			]),
	});
}
