import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "../test/testUtils";
import type { SyncStatus } from "../features/settings/api";
import { useAuth } from "../auth/store";
import { ApiError } from "../lib/api";
import FreshnessIndicator from "./FreshnessIndicator";
import { computeFreshness } from "./freshness";

const NOW = Date.parse("2026-03-01T12:00:00Z");
const minsAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

const status = (over: Partial<SyncStatus> = {}): SyncStatus => ({
	source: "http",
	connected: true,
	running: false,
	lastSuccessAt: minsAgo(3),
	lastRun: {
		kind: "incremental",
		status: "ok",
		errorCode: null,
		errorMessage: null,
		finishedAt: minsAgo(3),
	},
	perEntity: [],
	backfill: { done: true, progressPct: 100 },
	quarantined: { count: 0, items: [] },
	baseCurrency: "USD",
	timeZone: "America/Los_Angeles",
	webhooks: {
		registered: false,
		inactiveTypes: [],
		reactivatedTypes: [],
		lastCheckAt: null,
		lastEventAt: null,
	},
	...over,
});

const hook = vi.hoisted(() => ({ data: undefined as unknown, error: null as Error | null }));
vi.mock("../features/settings/hooks", () => ({
	useSyncStatus: () => ({ data: hook.data, isError: hook.error !== null, error: hook.error }),
}));

describe("computeFreshness", () => {
	it("is a Demo data badge for the fixture source", () => {
		expect(computeFreshness(status({ source: "fixture" }), NOW)).toEqual({
			tone: "demo",
			label: "Demo data",
		});
	});

	it("is neutral right after a good run", () => {
		expect(computeFreshness(status(), NOW)).toEqual({
			tone: "neutral",
			label: "Synced 3 min ago",
		});
	});

	it("turns amber past 30 minutes without a success, and not before", () => {
		expect(computeFreshness(status({ lastSuccessAt: minsAgo(30) }), NOW).tone).toBe(
			"neutral"
		);
		const stale = computeFreshness(status({ lastSuccessAt: minsAgo(31) }), NOW);
		expect(stale).toMatchObject({ tone: "warning", label: "Synced 31 min ago" });
	});

	it("turns amber when the last run was partial, even if recent", () => {
		const lastRun = {
			kind: "incremental",
			status: "partial" as const,
			errorCode: null,
			errorMessage: null,
			finishedAt: minsAgo(1),
		};
		expect(computeFreshness(status({ lastRun }), NOW).tone).toBe("warning");
	});

	it("stays amber with the skipped count while records are quarantined", () => {
		const item = {
			entity: "sales",
			recordId: "x",
			attempts: 5,
			lastCode: "CIN7_PARSE",
			lastMessage: "m",
			lastFailedAt: minsAgo(1),
		};
		const f = computeFreshness(
			status({ quarantined: { count: 2, items: [item, item] } }),
			NOW
		);
		expect(f).toMatchObject({ tone: "warning", detail: "2 records skipped" });
		const one = computeFreshness(
			status({ quarantined: { count: 1, items: [item] } }),
			NOW
		);
		expect(one.detail).toBe("1 record skipped");
	});

	it("says not synced yet, amber, when records are skipped before any good run", () => {
		const item = {
			entity: "sales",
			recordId: "x",
			attempts: 5,
			lastCode: "CIN7_PARSE",
			lastMessage: "m",
			lastFailedAt: minsAgo(1),
		};
		expect(
			computeFreshness(
				status({
					lastSuccessAt: null,
					lastRun: null,
					quarantined: { count: 2, items: [item, item] },
				}),
				NOW
			)
		).toEqual({
			tone: "warning",
			label: "Not synced yet",
			detail: "2 records skipped",
			inline: true,
		});
		expect(
			computeFreshness(status({ lastSuccessAt: null, lastRun: null }), NOW)
		).toEqual({
			tone: "neutral",
			label: "Not synced yet",
		});
	});

	it("turns red with the reason when the last run failed", () => {
		const lastRun = {
			kind: "incremental",
			status: "failed" as const,
			errorCode: "CIN7_AUTH",
			errorMessage: "x",
			finishedAt: minsAgo(1),
		};
		expect(computeFreshness(status({ lastRun }), NOW)).toEqual({
			tone: "error",
			label: "Sync failing",
			detail: "Cin7 rejected the saved credentials.",
		});
	});

	it("says so when Cin7 is not connected or has never synced", () => {
		expect(computeFreshness(status({ connected: false }), NOW).label).toBe(
			"Cin7 not connected"
		);
		expect(
			computeFreshness(status({ lastSuccessAt: null, lastRun: null }), NOW).label
		).toBe("Not synced yet");
	});
});

describe("FreshnessIndicator", () => {
	beforeEach(() => {
		hook.error = null;
		vi.useFakeTimers({ now: NOW, toFake: ["Date", "setInterval", "clearInterval"] });
		act(() =>
			useAuth.setState({
				user: { id: "1", email: "a@b.c", name: "A", role: "viewer" },
			})
		);
	});
	afterEach(() => {
		vi.useRealTimers();
		act(() => useAuth.setState({ user: null }));
	});

	const tone = () => document.querySelector("[data-tone]")?.getAttribute("data-tone");

	it("renders the four states", () => {
		hook.data = status({ source: "fixture" });
		const { rerender } = render(<FreshnessIndicator />);
		expect(screen.getByText("Demo data")).toBeInTheDocument();
		expect(tone()).toBe("demo");

		hook.data = status();
		rerender(<FreshnessIndicator />);
		expect(screen.getByText("Synced 3 min ago")).toBeInTheDocument();
		expect(tone()).toBe("neutral");

		hook.data = status({ lastSuccessAt: minsAgo(31) });
		rerender(<FreshnessIndicator />);
		expect(screen.getByText("Synced 31 min ago")).toBeInTheDocument();
		expect(tone()).toBe("warning");

		hook.data = status({
			lastRun: {
				kind: "incremental",
				status: "failed",
				errorCode: "CIN7_HTTP",
				errorMessage: null,
				finishedAt: minsAgo(1),
			},
		});
		rerender(<FreshnessIndicator />);
		expect(screen.getByText("Sync failing")).toBeInTheDocument();
		expect(screen.getByText(/Couldn't reach Cin7\./)).toBeInTheDocument();
		expect(tone()).toBe("error");
	});

	it("shows the skipped-records copy next to a quarantine badge", () => {
		hook.data = status({
			quarantined: { count: 3, items: [] },
		});
		render(<FreshnessIndicator />);
		expect(screen.getByText(/3 records skipped/)).toBeInTheDocument();
		expect(tone()).toBe("warning");
	});

	it("ages the label as the clock moves, with no new data", () => {
		hook.data = status({ lastSuccessAt: minsAgo(29) });
		render(<FreshnessIndicator />);
		expect(tone()).toBe("neutral");
		act(() => {
			vi.advanceTimersByTime(3 * 60_000);
		});
		expect(screen.getByText("Synced 32 min ago")).toBeInTheDocument();
		expect(tone()).toBe("warning");
	});

	it("shows an amber Status unavailable, with the reason, when the status query fails", () => {
		hook.data = undefined;
		hook.error = new ApiError(
			503,
			"SERVER_UNAVAILABLE",
			"The server isn't responding. Try again in a moment."
		);
		render(<FreshnessIndicator />);
		expect(screen.getByText("Status unavailable")).toBeInTheDocument();
		expect(tone()).toBe("warning");
		expect(document.querySelector("[data-tone]")).toHaveAttribute(
			"title",
			"The server isn't responding. Try again in a moment."
		);
	});

	it("renders nothing until the status loads", () => {
		hook.data = undefined;
		const { container } = render(<FreshnessIndicator />);
		expect(container).toBeEmptyDOMElement();
	});
});
