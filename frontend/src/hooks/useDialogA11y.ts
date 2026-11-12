import { useEffect, useRef } from "react";
import type { RefObject } from "react";

const FOCUSABLE_SELECTOR =
	'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogA11yProps<T extends HTMLElement> {
	ref: RefObject<T | null>;
	role: "dialog";
	"aria-modal": true;
	tabIndex: -1;
}

/**
 * Standard modal/dialog a11y wiring for an overlay: Escape closes it, focus
 * moves into the dialog on open, Tab/Shift+Tab is trapped inside it, and focus
 * returns to whatever triggered it once it closes. Spread the returned props
 * onto the dialog's outer container — the same element `role="dialog"`
 * belongs on.
 *
 * `active` gates every effect and must flip to `true` in the exact render
 * where the dialog's markup (and therefore the ref) actually commits. For a
 * component that mounts/unmounts entirely as a whole (ConfirmDialog,
 * AdjustStockModal) that's just its default of `true`. For Drawer, which
 * keeps rendering through a close transition, pass its internal `mounted`
 * flag — not `isOpen`, which flips a render *before* `mounted` does and would
 * fire the initial-focus effect before the dialog exists in the DOM.
 */
export function useDialogA11y<T extends HTMLElement = HTMLDivElement>(
	onClose: () => void,
	active = true
): DialogA11yProps<T> {
	const ref = useRef<T>(null);
	const previouslyFocused = useRef<HTMLElement | null>(null);

	// Initial focus in, return focus on close.
	useEffect(() => {
		if (!active) return;
		previouslyFocused.current = document.activeElement as HTMLElement | null;

		const dialog = ref.current;
		const focusable = dialog?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
		const target = focusable && focusable.length > 0 ? focusable[0] : dialog;
		target?.focus();

		return () => {
			previouslyFocused.current?.focus?.();
		};
	}, [active]);

	// Escape-to-close + Tab/Shift+Tab focus trap.
	useEffect(() => {
		if (!active) return;
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				onClose();
				return;
			}
			if (e.key !== "Tab") return;
			const dialog = ref.current;
			if (!dialog) return;
			const focusable = Array.from(
				dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
			);
			if (focusable.length === 0) {
				e.preventDefault();
				return;
			}
			const first = focusable[0];
			const last = focusable[focusable.length - 1];
			if (e.shiftKey && document.activeElement === first) {
				e.preventDefault();
				last.focus();
			} else if (!e.shiftKey && document.activeElement === last) {
				e.preventDefault();
				first.focus();
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [active, onClose]);

	return { ref, role: "dialog", "aria-modal": true, tabIndex: -1 };
}
