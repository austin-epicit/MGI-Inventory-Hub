import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, render as plainRender } from "@testing-library/react";
import { useToastStore } from "../../stores/toastStore";
import { useAuth } from "../../auth/store";
import AppLayout from "../../layout/AppLayout";
import { createTestQueryClient } from "../../test/testUtils";
import { render, screen, waitFor, within } from "../../test/testUtils";
import AlertsPage from "./AlertsPage";
import AlertsSettingsCard from "./AlertsSettingsCard";
import type { AlertsPayload, AlertThresholds } from "./api";

const envelope = (status: number, data: unknown, error: unknown = null) =>
	new Response(JSON.stringify({ success: status < 400, data, error }), {
		status,
		headers: { "Content-Type": "application/json" },
	});

const thresholds: AlertThresholds = {
	costChangePct: 15,
	costChangeDays: 90,
	slowMoverDays: 90,
	slowMoverMinValue: 1000,
};

const cost = (over: object = {}) => ({
	key: "cost:p1:u1:1",
	dismissed: false,
	productId: "p1",
	sku: "SKU-1",
	name: "Dell 24 Monitor",
	thumbUrl: null,
	previousCost: 100,
	latestCost: 200,
	changePct: 100,
	latestDate: "2026-11-01",
	purchaseId: "pu1",
	orderNumber: "PO-100",
	supplierName: "Acme Supply",
	...over,
});

const slow = (over: object = {}) => ({
	key: "slow:p2:never",
	dismissed: false,
	productId: "p2",
	sku: "SKU-2",
	name: "Old Laptop",
	thumbUrl: null,
	onHand: 4,
	value: 2500,
	lastSold: null,
	daysSinceSale: null,
	...over,
});

const payload = (over: Partial<AlertsPayload> = {}): AlertsPayload => ({
	costChanges: [],
	slowMovers: [],
	thresholds,
	openCount: 0,
	...over,
});

afterEach(() => {
	vi.restoreAllMocks();
	act(() => useAuth.setState({ user: null }));
});

const setRole = (role: "admin" | "viewer") =>
	act(() => useAuth.setState({ user: { id: "u1", email: "a@x.com", name: "A", role } }));

describe("AlertsPage", () => {
	it("lists open alerts only; Show dismissed reveals the rest with Restore", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			envelope(
				200,
				payload({
					costChanges: [
						cost(),
						cost({
							key: "cost:p3:u2:1",
							name: "Hidden Cable",
							dismissed: true,
						}),
					],
				})
			)
		);
		render(<AlertsPage />);
		expect(await screen.findByText("Dell 24 Monitor")).toBeInTheDocument();
		expect(screen.queryByText("Hidden Cable")).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Restore" })).not.toBeInTheDocument();

		await userEvent.setup().click(screen.getByRole("button", { name: "All" }));
		expect(await screen.findByText("Hidden Cable")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Restore" })).toBeInTheDocument();
	});

	it("Dismiss POSTs the key and refetches", async () => {
		let dismissed = false;
		const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
			if (
				String(url).endsWith("/api/alerts/dismiss") &&
				init?.method === "POST"
			) {
				dismissed = true;
				return envelope(200, { key: "cost:p1:u1:1", dismissed: true });
			}
			return envelope(200, payload({ costChanges: [cost({ dismissed })] }));
		});
		render(<AlertsPage />);
		await userEvent
			.setup()
			.click(await screen.findByRole("button", { name: "Dismiss" }));
		const post = spy.mock.calls.find(([u]) => String(u).endsWith("/dismiss"))!;
		expect(JSON.parse(String(post[1]!.body))).toEqual({ key: "cost:p1:u1:1" });
		await waitFor(() =>
			expect(screen.queryByText("Dell 24 Monitor")).not.toBeInTheDocument()
		);
		expect(spy.mock.calls.filter(([u]) => String(u) === "/api/alerts").length).toBe(2);
	});

	it("cost row shows supplier, order, previous to latest cost and signed percent", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			envelope(
				200,
				payload({
					costChanges: [
						cost(),
						cost({
							key: "cost:p4:u3:1",
							productId: "p4",
							name: "Mouse",
							previousCost: 50,
							latestCost: 40,
							changePct: -20,
						}),
					],
				})
			)
		);
		render(<AlertsPage />);
		expect(await screen.findByText("+100.0%")).toBeInTheDocument();
		expect(screen.getByText("−20.0%")).toBeInTheDocument();
		expect(screen.getAllByText("Acme Supply").length).toBe(2);
		expect(screen.getAllByText("PO-100").length).toBe(2);
		expect(screen.getByText("$100.00 → $200.00")).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "Dell 24 Monitor" })).toHaveAttribute(
			"href",
			"/products/p1"
		);
	});

	it("slow mover row shows value and never-sold state", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			envelope(200, payload({ slowMovers: [slow()] }))
		);
		render(<AlertsPage />);
		const table = await screen.findByRole("table", { name: "Slow movers" });
		expect(within(table).getByText("$2,500.00")).toBeInTheDocument();
		expect(within(table).getByText(/never sold/)).toBeInTheDocument();
	});

	it("empty states and rule footers use the current thresholds", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			envelope(
				200,
				payload({
					thresholds: {
						costChangePct: 25,
						costChangeDays: 30,
						slowMoverDays: 60,
						slowMoverMinValue: 500,
					},
				})
			)
		);
		render(<AlertsPage />);
		expect(
			await screen.findByText(
				"No product's last purchase cost moved 25% or more in the last 30 days."
			)
		).toBeInTheDocument();
		expect(
			screen.getByText(
				"No product worth $500.00 or more has gone 60 days without a sale."
			)
		).toBeInTheDocument();
		expect(
			screen.getByText(
				"Last purchase cost vs the one before, ±25% or more, bought in the last 30 days."
			)
		).toBeInTheDocument();
		expect(
			screen.getByText(
				"In stock, no sale in 60 days, stock value $500.00 or more."
			)
		).toBeInTheDocument();
	});

	it("says '1 day', not '1 days', when a threshold is 1", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			envelope(
				200,
				payload({
					thresholds: {
						costChangePct: 25,
						costChangeDays: 1,
						slowMoverDays: 1,
						slowMoverMinValue: 500,
					},
				})
			)
		);
		render(<AlertsPage />);
		expect(await screen.findByText(/bought in the last 1 day\./)).toBeInTheDocument();
		expect(screen.getByText(/no sale in 1 day,/)).toBeInTheDocument();
		expect(screen.getByText(/has gone 1 day without a sale/)).toBeInTheDocument();
		expect(
			screen.getByText(/moved 25% or more in the last 1 day\./)
		).toBeInTheDocument();
	});

	it("footer links admins to Settings; viewers get no link", async () => {
		// A Response body can be read once, so each request needs a fresh one.
		vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
			envelope(200, payload())
		);
		setRole("viewer");
		const { unmount } = render(<AlertsPage />);
		await screen.findByText(/Last purchase cost vs/);
		expect(
			screen.queryByRole("link", { name: "Change thresholds" })
		).not.toBeInTheDocument();
		unmount();
		setRole("admin");
		render(<AlertsPage />);
		const links = await screen.findAllByRole("link", { name: "Change thresholds" });
		expect(links[0]).toHaveAttribute("href", "/settings#alerts-settings");
	});
});

describe("dismiss failure and all-dismissed", () => {
	it("toasts when dismiss fails", async () => {
		vi.spyOn(globalThis, "fetch").mockImplementation(async (url) =>
			String(url).endsWith("/dismiss")
				? envelope(500, null, { code: "X", message: "boom" })
				: envelope(200, payload({ costChanges: [cost()] }))
		);
		render(<AlertsPage />);
		await userEvent
			.setup()
			.click(await screen.findByRole("button", { name: "Dismiss" }));
		await waitFor(() =>
			expect(
				useToastStore.getState().toasts.some((t) => t.kind === "error")
			).toBe(true)
		);
	});

	it("says all are dismissed instead of stating the rule", async () => {
		vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
			envelope(
				200,
				payload({
					costChanges: [
						cost({ dismissed: true }),
						cost({ key: "cost:p9:u9:1", dismissed: true }),
					],
				})
			)
		);
		render(<AlertsPage />);
		expect(await screen.findByText(/All 2 dismissed\./)).toBeInTheDocument();
		expect(
			screen.queryByText(/^No product's last purchase cost moved/)
		).not.toBeInTheDocument();
		expect(screen.getByText(/^No product worth/)).toBeInTheDocument();
	});
});

describe("nav badge", () => {
	const renderLayout = (openCount: number) => {
		vi.spyOn(globalThis, "fetch").mockImplementation(async (url) =>
			String(url).endsWith("/api/alerts")
				? envelope(200, payload({ openCount }))
				: envelope(200, {
						source: "http",
						connected: true,
						running: false,
						lastSuccessAt: null,
						lastRun: null,
						perEntity: [],
						backfill: { done: true, progressPct: 100 },
						quarantined: { count: 0, items: [] },
						baseCurrency: "USD",
						timeZone: "UTC",
						webhooks: {},
					})
		);
		plainRender(
			<QueryClientProvider client={createTestQueryClient()}>
				<MemoryRouter>
					<Routes>
						<Route element={<AppLayout />}>
							<Route index element={<div />} />
						</Route>
					</Routes>
				</MemoryRouter>
			</QueryClientProvider>
		);
	};

	it("shows the open count", async () => {
		renderLayout(7);
		expect(await screen.findByTestId("nav-badge")).toHaveTextContent("7");
		expect(screen.getByRole("img", { name: "7 open alerts" })).toBeInTheDocument();
	});

	it("caps at 99+", async () => {
		renderLayout(150);
		expect(await screen.findByTestId("nav-badge")).toHaveTextContent("99+");
	});

	it("is absent at zero", async () => {
		renderLayout(0);
		await screen.findByRole("link", { name: /Alerts/ });
		await waitFor(() =>
			expect(globalThis.fetch).toHaveBeenCalledWith(
				"/api/alerts",
				expect.anything()
			)
		);
		expect(screen.queryByTestId("nav-badge")).not.toBeInTheDocument();
	});
});

describe("AlertsSettingsCard", () => {
	it("admin edits and saves all four numbers", async () => {
		setRole("admin");
		const spy = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation(async (_u, init) =>
				init?.method === "PUT"
					? envelope(200, { ...thresholds, costChangePct: 20 })
					: envelope(200, thresholds)
			);
		render(<AlertsSettingsCard />);
		const user = userEvent.setup();
		const pct = await screen.findByLabelText(/Cost change at least/);
		await user.clear(pct);
		await user.type(pct, "20");
		await user.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() =>
			expect(spy.mock.calls.some(([, i]) => i?.method === "PUT")).toBe(true)
		);
		const put = spy.mock.calls.find(([, i]) => i?.method === "PUT")!;
		expect(JSON.parse(String(put[1]!.body))).toEqual({
			...thresholds,
			costChangePct: 20,
		});
		expect(await screen.findByText("Saved.")).toBeInTheDocument();
	});

	it("blocks bad values client-side with plain messages and sends nothing", async () => {
		setRole("admin");
		const spy = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation(async () => envelope(200, thresholds));
		render(<AlertsSettingsCard />);
		const user = userEvent.setup();
		const pct = await screen.findByLabelText(/Cost change at least/);
		await user.clear(pct);
		await user.type(pct, "1.5");
		const days = screen.getByLabelText(/Cost change look-back/);
		await user.clear(days);
		await user.type(days, "5000");
		await user.clear(screen.getByLabelText(/Slow mover: no sale for/));
		await user.click(screen.getByRole("button", { name: "Save" }));
		expect(screen.getByText("Use a whole number.")).toBeInTheDocument();
		expect(screen.getByText("Enter 1 to 3,650.")).toBeInTheDocument();
		expect(screen.getByText("Enter a number.")).toBeInTheDocument();
		expect(spy.mock.calls.some(([, i]) => i?.method === "PUT")).toBe(false);
	});

	it("clears Saved. when a field is edited again", async () => {
		setRole("admin");
		vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
			envelope(200, thresholds)
		);
		render(<AlertsSettingsCard />);
		const user = userEvent.setup();
		await user.click(await screen.findByRole("button", { name: "Save" }));
		expect(await screen.findByText("Saved.")).toBeInTheDocument();
		await user.type(screen.getByLabelText(/Cost change at least/), "1");
		expect(screen.queryByText("Saved.")).not.toBeInTheDocument();
	});

	it("anchors the card for the Alerts page link", async () => {
		setRole("admin");
		vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
			envelope(200, thresholds)
		);
		const { container } = render(<AlertsSettingsCard />);
		await screen.findByRole("button", { name: "Save" });
		expect(container.querySelector("#alerts-settings")).not.toBeNull();
	});

	it("maps a server 400 to a plain message", async () => {
		setRole("admin");
		vi.spyOn(globalThis, "fetch").mockImplementation(async (_u, init) =>
			init?.method === "PUT"
				? envelope(400, null, {
						code: "VALIDATION_ERROR",
						message: "costChangePct: too big",
					})
				: envelope(200, thresholds)
		);
		render(<AlertsSettingsCard />);
		await userEvent.setup().click(await screen.findByRole("button", { name: "Save" }));
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Those values were not accepted"
		);
		expect(screen.queryByText(/costChangePct/)).not.toBeInTheDocument();
	});
	it("labels the money threshold with the base currency, not a symbol", async () => {
		setRole("admin");
		vi.spyOn(globalThis, "fetch").mockResolvedValue(envelope(200, thresholds));
		render(<AlertsSettingsCard />);
		expect(
			await screen.findByLabelText(
				"Slow mover: stock value at least (base currency)"
			)
		).toHaveValue("1000");
	});
});
