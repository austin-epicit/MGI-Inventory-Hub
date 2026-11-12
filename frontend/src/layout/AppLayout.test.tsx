import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import { formatDateTime, setFormatContext } from "../lib/format";
import AppLayout from "./AppLayout";

const hook = vi.hoisted(() => ({
	state: { data: undefined, isLoading: true } as {
		data?: unknown;
		isLoading: boolean;
	},
}));
vi.mock("../features/settings/hooks", () => ({
	useSyncStatus: () => ({ ...hook.state, isError: false, error: null }),
}));

const seen: string[] = [];
function Probe() {
	const text = formatDateTime("2026-03-01T17:05:00Z");
	seen.push(text);
	return <div>{text}</div>;
}

const ui = () => (
	<MemoryRouter>
		<Routes>
			<Route element={<AppLayout />}>
				<Route index element={<Probe />} />
			</Route>
		</Routes>
	</MemoryRouter>
);

describe("AppLayout format context", () => {
	it("waits for the status, then first paints in the account's zone, never the browser's", () => {
		// The test env runs in America/Los_Angeles; the account is in Chicago.
		setFormatContext({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
		hook.state = { data: undefined, isLoading: true };
		const { rerender } = render(ui());
		expect(seen).toEqual([]); // nothing painted in the wrong zone while loading

		hook.state = {
			data: {
				source: "http",
				baseCurrency: "USD",
				timeZone: "America/Chicago",
				connected: true,
				running: false,
				lastSuccessAt: null,
				quarantined: { count: 0, items: [] },
				lastRun: null,
			},
			isLoading: false,
		};
		rerender(ui());
		expect(screen.getByText(/11:05 AM/)).toBeInTheDocument(); // 17:05Z in Chicago (CST)
		expect(seen.every((t) => t.includes("11:05 AM"))).toBe(true);
		expect(seen.some((t) => t.includes("9:05 AM"))).toBe(false); // Los Angeles wall time
	});
});

describe("AppLayout error boundary", () => {
	it("a page that throws shows the fallback inside the shell instead of blanking the app", () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		hook.state = { data: undefined, isLoading: false };
		const Boom = () => {
			throw new RangeError("Invalid time zone");
		};
		render(
			<MemoryRouter>
				<Routes>
					<Route element={<AppLayout />}>
						<Route index element={<Boom />} />
					</Route>
				</Routes>
			</MemoryRouter>
		);
		expect(screen.getByText("This page could not be displayed")).toBeInTheDocument();
		expect(screen.getByRole("navigation")).toBeInTheDocument();
		spy.mockRestore();
	});
});
