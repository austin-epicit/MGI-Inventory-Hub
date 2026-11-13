import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, within } from "../../test/testUtils";
import WebhooksCard from "./WebhooksCard";

const envelope = (status: number, data: unknown, error: unknown = null) =>
	new Response(JSON.stringify({ success: status < 400, data, error }), {
		status,
		headers: { "Content-Type": "application/json" },
	});

const settings = (over: object = {}) => ({
	registered: false,
	types: [],
	registeredAt: null,
	lastCheckAt: null,
	reactivatedAt: null,
	reactivatedTypes: [],
	lastEventAt: null,
	...over,
});

const status = (webhooks: object = {}) => ({
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
	webhooks: {
		registered: false,
		inactiveTypes: [],
		reactivatedTypes: [],
		lastCheckAt: null,
		lastEventAt: null,
		...webhooks,
	},
});

const route =
	(hooks: unknown, sync: unknown, onRegister?: () => Response) =>
	async (url: RequestInfo | URL, init?: RequestInit) => {
		const u = String(url);
		if (u.endsWith("/webhooks/register") && init?.method === "POST")
			return onRegister?.() ?? envelope(200, hooks);
		if (u.endsWith("/api/sync/status")) return envelope(200, sync);
		return envelope(200, hooks);
	};

afterEach(() => vi.restoreAllMocks());

describe("WebhooksCard", () => {
	it("states the add-on requirement and offers Register when nothing is registered", async () => {
		vi.spyOn(globalThis, "fetch").mockImplementation(route(settings(), status()));
		render(<WebhooksCard />);
		expect(
			await screen.findByText(/Requires Cin7 Advanced Automations/)
		).toBeInTheDocument();
		expect(await screen.findByText("Not registered yet.")).toBeInTheDocument();
		expect(
			await screen.findByRole("button", { name: "Register webhooks" })
		).toBeEnabled();
		expect(
			await screen.findByText(/Last event received: None yet/)
		).toBeInTheDocument();
	});

	it("disables Register with a stated reason while Cin7 is not connected", async () => {
		vi.spyOn(globalThis, "fetch").mockImplementation(
			route(settings(), { ...status(), connected: false })
		);
		render(<WebhooksCard />);
		const button = await screen.findByRole("button", { name: "Register webhooks" });
		expect(button).toBeDisabled();
		expect(button).toHaveAttribute("title", "Connect Cin7 first");
		expect(await screen.findByText(/Connect Cin7 above/)).toBeInTheDocument();
	});

	it("shows an error with retry, not 'Connect Cin7', when the status request fails", async () => {
		let failing = true;
		vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
			if (String(url).endsWith("/api/sync/status") && failing)
				return envelope(500, null, {
					code: "SERVER_ERROR",
					message: "boom",
				});
			return route(settings(), status())(url, init);
		});
		render(<WebhooksCard />);
		const user = userEvent.setup();
		expect(
			await screen.findByText("Couldn't check the Cin7 connection.")
		).toBeInTheDocument();
		expect(screen.queryByText(/Connect Cin7/)).not.toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Register webhooks" })).toHaveAttribute(
			"title",
			"Connection status unavailable"
		);
		failing = false;
		await user.click(screen.getByRole("button", { name: "Try again" }));
		expect(
			await screen.findByRole("button", { name: "Register webhooks" })
		).toBeEnabled();
		expect(
			screen.queryByText("Couldn't check the Cin7 connection.")
		).not.toBeInTheDocument();
	});

	it("lists per-type state, flags a webhook that is off, and shows the last event time", async () => {
		const hooks = settings({
			registered: true,
			types: [
				{ type: "Sale/Voided", active: true },
				{ type: "Product/Updated", active: false },
			],
			lastEventAt: "2026-11-20T12:00:00.000Z",
		});
		vi.spyOn(globalThis, "fetch").mockImplementation(
			route(
				hooks,
				status({ registered: true, inactiveTypes: ["Product/Updated"] })
			)
		);
		render(<WebhooksCard />);
		const voided = (await screen.findByText("Sale/Voided")).closest("li")!;
		expect(within(voided).getByText("Active")).toBeInTheDocument();
		const off = screen.getByText("Product/Updated").closest("li")!;
		expect(within(off).getByText("Off")).toBeInTheDocument();
		expect(await screen.findByRole("alert")).toHaveTextContent(
			/1 webhook is off in Cin7/
		);
		expect(screen.getByRole("button", { name: "Register again" })).toBeInTheDocument();
		expect(screen.queryByText(/None yet/)).not.toBeInTheDocument();
	});

	it("shows Cin7's refusal when the account lacks the add-on", async () => {
		vi.spyOn(globalThis, "fetch").mockImplementation(
			route(settings(), status(), () =>
				envelope(422, null, {
					code: "WEBHOOKS_REFUSED",
					message: "Cin7 refused the webhook registration.",
				})
			)
		);
		render(<WebhooksCard />);
		const user = userEvent.setup();
		await user.click(await screen.findByRole("button", { name: "Register webhooks" }));
		expect(await screen.findByRole("alert")).toHaveTextContent(/refused/);
	});
});
