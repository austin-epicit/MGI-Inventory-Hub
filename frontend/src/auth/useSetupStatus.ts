import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

export function useSetupStatus() {
	return useQuery({
		queryKey: ["auth", "setup-status"],
		queryFn: () => api<{ needsSetup: boolean }>("/api/auth/setup-status"),
		staleTime: 0,
	});
}
