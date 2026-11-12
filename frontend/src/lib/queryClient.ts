import { QueryClient } from "@tanstack/react-query";

// Reads `status` off the error instead of importing ApiError: api.ts imports this module.
const isClientError = (e: unknown) =>
	typeof (e as { status?: unknown })?.status === "number" &&
	(e as { status: number }).status < 500;

export const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: 30_000,
			refetchOnWindowFocus: false,
			// A 4xx will not fix itself on retry.
			retry: (count, error) => !isClientError(error) && count < 2,
		},
	},
});
