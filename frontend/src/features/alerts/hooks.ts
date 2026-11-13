import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	dismissAlert,
	fetchAlertThresholds,
	fetchAlerts,
	restoreAlert,
	saveAlertThresholds,
} from "./api";

const ALERTS_KEY = ["alerts"] as const;
const SETTINGS_KEY = ["alerts", "settings"] as const;

// The nav badge and the page share this query; focus refetch keeps the badge honest after a sync.
export const useAlerts = () =>
	useQuery({
		queryKey: ALERTS_KEY,
		queryFn: fetchAlerts,
		staleTime: 5 * 60_000,
		refetchOnWindowFocus: true,
	});

export function useDismissAlert() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: dismissAlert,
		onSuccess: () => qc.invalidateQueries({ queryKey: ALERTS_KEY }),
	});
}

export function useRestoreAlert() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: restoreAlert,
		onSuccess: () => qc.invalidateQueries({ queryKey: ALERTS_KEY }),
	});
}

export const useAlertThresholds = () =>
	useQuery({ queryKey: SETTINGS_KEY, queryFn: fetchAlertThresholds });

export function useSaveAlertThresholds() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: saveAlertThresholds,
		onSuccess: () =>
			Promise.all([
				qc.invalidateQueries({ queryKey: ALERTS_KEY }),
				qc.invalidateQueries({ queryKey: SETTINGS_KEY }),
			]),
	});
}
