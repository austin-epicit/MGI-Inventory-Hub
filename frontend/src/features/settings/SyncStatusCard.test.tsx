import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "../../test/testUtils";
import type { SyncStatus } from "./api";
import SyncStatusCard from "./SyncStatusCard";

const hook = vi.hoisted(() => ({ data: undefined as unknown }));
vi.mock("./hooks", () => ({
	useSyncStatus: () => ({
		data: hook.data,
		isLoading: false,
		isError: false,
		refetch: vi.fn(),
	}),
	useRunSync: () => ({ mutate: vi.fn(), isPending: false }),
	useRemap: () => ({
		mutateAsync: vi.fn(),
		isPending: false,
		isError: false,
		reset: vi.fn(),
	}),
}));

const status = (over: Partial<SyncStatus> = {}): SyncStatus => ({
	source: "http",
	connected: true,
	running: false,
	lastSuccessAt: null,
	lastRun: null,
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

const failed = (errorCode: string, errorMessage: string): SyncStatus["lastRun"] => ({
	kind: "incremental",
	status: "failed",
	errorCode,
	errorMessage,
	finishedAt: null,
});

afterEach(() => {
	hook.data = undefined;
});

describe("SyncStatusCard failures", () => {
	it("shows the reason sentence for a failed run and the raw text only in a title", () => {
		hook.data = status({
			lastRun: failed("CIN7_HTTP", "PrismaClientKnownRequestError: boom"),
		});
		render(<SyncStatusCard />);
		expect(screen.getByText("Couldn't reach Cin7.")).toHaveAttribute(
			"title",
			"PrismaClientKnownRequestError: boom"
		);
		expect(screen.queryByText(/Prisma/)).toBeNull();
	});

	it("falls back to the generic sentence for an unknown code", () => {
		hook.data = status({ lastRun: failed("SYNC_ERROR", "raw") });
		render(<SyncStatusCard />);
		expect(
			screen.getByText(
				"The sync stopped with an unexpected error. It retries automatically."
			)
		).toBeInTheDocument();
	});

	it("maps skipped-record codes the same way and keeps the message in a title", () => {
		hook.data = status({
			quarantined: {
				count: 1,
				items: [
					{
						entity: "products",
						recordId: "p1",
						attempts: 3,
						lastCode: "CIN7_HTTP",
						lastMessage: "HTTP 500 body",
						lastFailedAt: "2026-03-01T00:00:00Z",
					},
				],
			},
		});
		render(<SyncStatusCard />);
		expect(screen.getByText(/Couldn't reach Cin7\./)).toHaveAttribute(
			"title",
			"HTTP 500 body"
		);
		expect(screen.queryByText("HTTP 500 body")).toBeNull();
	});
});
