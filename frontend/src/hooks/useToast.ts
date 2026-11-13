import type { ReactNode } from "react";
import { useToastStore, type PushOptions } from "../stores/toastStore";

export interface ToastApi {
	success: (message: ReactNode) => void;
	error: (message: ReactNode, options?: PushOptions) => void;
	warning: (message: ReactNode, options?: PushOptions) => void;
	info: (message: ReactNode, options?: PushOptions) => void;
}

// Thin hook over toastStore — callers never touch the store's id/array shape.
export function useToast(): ToastApi {
	const push = useToastStore((s) => s.push);
	return {
		success: (message) => {
			push("success", message);
		},
		error: (message, options) => {
			push("error", message, options);
		},
		warning: (message, options) => {
			push("warning", message, options);
		},
		info: (message, options) => {
			push("info", message, options);
		},
	};
}
