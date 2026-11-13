import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import ToastViewport from "./ToastViewport";
import { useToastStore } from "../../stores/toastStore";

describe("ToastViewport", () => {
	afterEach(() => {
		vi.useRealTimers();
		useToastStore.setState({ toasts: [] });
	});

	it("renders error toasts as alerts and other kinds without a role", () => {
		useToastStore.setState({
			toasts: [
				{ id: 1, kind: "error", message: "Boom" },
				{ id: 2, kind: "success", message: "Saved" },
			],
		});
		render(<ToastViewport />);
		expect(screen.getByRole("alert")).toHaveTextContent("Boom");
		expect(screen.getAllByRole("alert")).toHaveLength(1);
	});

	it("keeps error toasts for 8s and others for 4s", () => {
		vi.useFakeTimers();
		const { push } = useToastStore.getState();
		act(() => {
			push("error", "Boom");
			push("info", "Fyi");
		});
		act(() => {
			vi.advanceTimersByTime(5000);
		});
		const live = useToastStore.getState().toasts.filter((t) => !t.leaving);
		expect(live.map((t) => t.message)).toEqual(["Boom"]);
		act(() => {
			vi.advanceTimersByTime(4000);
		});
		expect(useToastStore.getState().toasts.filter((t) => !t.leaving)).toHaveLength(0);
	});
});
