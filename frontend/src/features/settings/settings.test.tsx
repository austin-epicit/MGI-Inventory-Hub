import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { act, render, screen, waitFor, within } from "../../test/testUtils";
import { useAuth } from "../../auth/store";
import Cin7ConnectionCard from "./Cin7ConnectionCard";
import UsersCard from "./UsersCard";

const envelope = (status: number, data: unknown, error: unknown = null) =>
	new Response(JSON.stringify({ success: status < 400, data, error }), {
		status,
		headers: { "Content-Type": "application/json" },
	});

const conn = (over: object = {}) => ({
	source: "http",
	connected: false,
	accountIdMasked: null,
	verifiedAt: null,
	company: null,
	baseCurrency: null,
	timeZone: null,
	...over,
});

afterEach(() => {
	vi.restoreAllMocks();
	act(() => useAuth.setState({ user: null }));
});

describe("Cin7ConnectionCard", () => {
	it("says the app shows demo data in fixture mode", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			envelope(200, conn({ source: "fixture" }))
		);
		render(<Cin7ConnectionCard />);
		expect(await screen.findByRole("note")).toHaveTextContent(/demo data/i);
		expect(screen.getByRole("note")).toHaveTextContent("CIN7_SOURCE=http");
	});

	it("shows Cin7's rejection and keeps the form so the admin can fix the key", async () => {
		const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) =>
			init?.method === "PUT"
				? envelope(422, null, {
						code: "CIN7_AUTH",
						message: "Cin7 rejected this Account ID and Application Key",
					})
				: envelope(200, conn())
		);
		render(<Cin7ConnectionCard />);
		const user = userEvent.setup();
		await user.type(await screen.findByLabelText("Account ID"), "acct");
		await user.type(screen.getByLabelText("Application key"), "bad");
		await user.click(screen.getByRole("button", { name: "Save and verify" }));
		expect(await screen.findByRole("alert")).toHaveTextContent(/rejected/);
		expect(screen.getByLabelText("Account ID")).toHaveValue("acct");
		const put = spy.mock.calls.find(([, i]) => i?.method === "PUT")!;
		expect(JSON.parse(String(put[1]!.body))).toEqual({
			accountId: "acct",
			applicationKey: "bad",
		});
	});

	it("a different account asks to replace, then resends with confirmReplace", async () => {
		let puts = 0;
		const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
			if (init?.method !== "PUT") return envelope(200, conn());
			puts += 1;
			return puts === 1
				? envelope(409, null, {
						code: "ACCOUNT_CHANGED",
						message: "different account",
					})
				: envelope(
						200,
						conn({
							connected: true,
							accountIdMasked: "••••2222",
						})
					);
		});
		render(<Cin7ConnectionCard />);
		const user = userEvent.setup();
		await user.type(await screen.findByLabelText("Account ID"), "acct-2");
		await user.type(screen.getByLabelText("Application key"), "key");
		await user.click(screen.getByRole("button", { name: "Save and verify" }));
		const dialog = await screen.findByRole("dialog");
		expect(dialog).toHaveTextContent(
			"This is a different Cin7 account. Replace it and clear all mirrored data?"
		);
		await user.click(within(dialog).getByRole("button", { name: "Replace and clear" }));
		await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
		const bodies = spy.mock.calls
			.filter(([, i]) => i?.method === "PUT")
			.map(([, i]) => JSON.parse(String(i!.body)));
		expect(bodies[0]).toEqual({ accountId: "acct-2", applicationKey: "key" });
		expect(bodies[1]).toEqual({
			accountId: "acct-2",
			applicationKey: "key",
			confirmReplace: true,
		});
	});

	it("shows the masked account once connected, never a key", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			envelope(
				200,
				conn({
					connected: true,
					accountIdMasked: "••••1234",
					company: "MGI",
				})
			)
		);
		render(<Cin7ConnectionCard />);
		expect(await screen.findByText("Connected to MGI")).toBeInTheDocument();
		expect(screen.getByText(/Account ••••1234/)).toBeInTheDocument();
	});

	it("offers the form and a Disconnect button when the stored credentials cannot be read", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			envelope(200, conn({ connected: true, unreadable: true }))
		);
		render(<Cin7ConnectionCard />);
		expect(await screen.findByRole("alert")).toHaveTextContent(/can.t be read/i);
		expect(screen.getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
		expect(screen.getByLabelText("Account ID")).toBeInTheDocument();
	});
});

describe("UsersCard", () => {
	const users = [
		{
			id: "u1",
			email: "boss@x.com",
			name: "Boss",
			role: "admin",
			deactivated: false,
			pendingInvite: false,
			createdAt: "2026-01-01T00:00:00Z",
		},
		{
			id: "u2",
			email: "v@x.com",
			name: "Viv",
			role: "viewer",
			deactivated: false,
			pendingInvite: false,
			createdAt: "2026-01-02T00:00:00Z",
		},
	];

	it("invites a user and shows the link with a copy button", async () => {
		act(() =>
			useAuth.setState({
				user: {
					id: "u1",
					email: "boss@x.com",
					name: "Boss",
					role: "admin",
				},
			})
		);
		const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) =>
			init?.method === "POST"
				? envelope(201, {
						inviteUrl: "http://localhost:5180/invite/tok123",
					})
				: envelope(200, users)
		);
		render(<UsersCard />);
		const user = userEvent.setup();
		const write = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(navigator, "clipboard", {
			value: { writeText: write },
			configurable: true,
		});
		await user.click(await screen.findByRole("button", { name: "Invite user" }));
		await user.type(screen.getByLabelText("Name"), "New Person");
		await user.type(screen.getByLabelText("Email"), "new@x.com");
		await user.click(screen.getByRole("button", { name: "Create invite link" }));
		const box = await screen.findByLabelText("Invite link for new@x.com");
		expect(box).toHaveValue("http://localhost:5180/invite/tok123");
		await user.click(screen.getByRole("button", { name: /Copy/ }));
		await waitFor(() =>
			expect(write).toHaveBeenCalledWith("http://localhost:5180/invite/tok123")
		);
		const post = spy.mock.calls.find(([, i]) => i?.method === "POST")!;
		expect(JSON.parse(String(post[1]!.body))).toEqual({
			name: "New Person",
			email: "new@x.com",
			role: "viewer",
		});
	});

	it("changes a role and confirms before deactivating", async () => {
		const spy = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation(async (_url, init) =>
				init?.method === "PATCH"
					? envelope(200, users[1])
					: envelope(200, users)
			);
		render(<UsersCard />);
		const user = userEvent.setup();
		await user.selectOptions(await screen.findByLabelText("Role for v@x.com"), "admin");
		await waitFor(() => {
			const patch = spy.mock.calls.find(([, i]) => i?.method === "PATCH")!;
			expect(JSON.parse(String(patch[1]!.body))).toEqual({ role: "admin" });
		});
		const patches = () =>
			spy.mock.calls.filter(([, i]) => i?.method === "PATCH").length;
		const before = patches();
		await user.click(screen.getAllByRole("button", { name: "Deactivate" })[1]!);
		expect(patches()).toBe(before); // nothing yet: the dialog asks first
		await user.click(
			within(screen.getByRole("dialog")).getByRole("button", {
				name: "Deactivate",
			})
		);
		await waitFor(() => expect(patches()).toBe(before + 1));
	});
});

type NodeJS = {
	on(e: string, f: () => void): void;
	off(e: string, f: () => void): void;
};

describe("Cin7ConnectionCard hardening", () => {
	it("caps both credential inputs at 200 characters", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(envelope(200, conn()));
		render(<Cin7ConnectionCard />);
		expect(await screen.findByLabelText("Account ID")).toHaveAttribute(
			"maxlength",
			"200"
		);
		expect(screen.getByLabelText("Application key")).toHaveAttribute(
			"maxlength",
			"200"
		);
	});

	it("announces a failed disconnect in the dialog without an unhandled rejection", async () => {
		const unhandled = vi.fn();
		const proc = (globalThis as unknown as { process: NodeJS }).process;
		proc.on("unhandledRejection", unhandled);
		vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) =>
			init?.method === "DELETE"
				? envelope(500, null, { code: "INTERNAL", message: "boom" })
				: envelope(200, conn({ connected: true, accountIdMasked: "1234" }))
		);
		render(<Cin7ConnectionCard />);
		const user = userEvent.setup();
		await user.click(await screen.findByRole("button", { name: "Disconnect" }));
		await user.click(
			within(screen.getByRole("dialog")).getByRole("button", {
				name: "Disconnect",
			})
		);
		expect(
			await within(screen.getByRole("dialog")).findByRole("alert")
		).toBeInTheDocument();
		await new Promise((r) => setTimeout(r, 20));
		proc.off("unhandledRejection", unhandled);
		expect(unhandled).not.toHaveBeenCalled();
	});
});

describe("UsersCard safeguards", () => {
	const row = (id: string, email: string, role: string, deactivated = false) => ({
		id,
		email,
		name: id,
		role,
		deactivated,
		pendingInvite: false,
		createdAt: "2026-01-01T00:00:00Z",
	});
	const all = [
		row("u1", "boss@x.com", "admin"),
		row("u2", "v@x.com", "viewer"),
		row("u3", "other@x.com", "admin"),
		row("u4", "gone@x.com", "viewer", true),
	];
	const signIn = () =>
		act(() =>
			useAuth.setState({
				user: {
					id: "u1",
					email: "boss@x.com",
					name: "Boss",
					role: "admin",
				},
			})
		);
	const patchCount = (spy: { mock: { calls: unknown[][] } }) =>
		spy.mock.calls.filter(([, i]) => (i as RequestInit | undefined)?.method === "PATCH")
			.length;

	it("does not leak a failed role change into the Deactivate dialog", async () => {
		signIn();
		vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) =>
			init?.method === "PATCH"
				? envelope(409, null, {
						code: "LAST_ADMIN",
						message: "At least one active admin is required",
					})
				: envelope(200, all)
		);
		render(<UsersCard />);
		const user = userEvent.setup();
		await user.selectOptions(await screen.findByLabelText("Role for v@x.com"), "admin");
		await waitFor(() =>
			expect(screen.getByLabelText("Role for v@x.com")).toBeEnabled()
		);
		await user.click(screen.getAllByRole("button", { name: "Deactivate" })[0]!);
		expect(within(screen.getByRole("dialog")).queryByText(/active admin/)).toBeNull();
	});

	it("asks before demoting another admin and leaves the role when cancelled", async () => {
		signIn();
		const spy = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation(async () => envelope(200, all));
		render(<UsersCard />);
		const user = userEvent.setup();
		await user.selectOptions(
			await screen.findByLabelText("Role for other@x.com"),
			"viewer"
		);
		const dialog = screen.getByRole("dialog");
		expect(dialog).not.toHaveTextContent("You'll lose access to Settings.");
		expect(patchCount(spy)).toBe(0);
		await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(screen.getByLabelText("Role for other@x.com")).toHaveValue("admin");
		expect(patchCount(spy)).toBe(0);
	});

	it("warns a self-demotion about losing Settings and sends it only on confirm", async () => {
		signIn();
		const spy = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation(async (_url, init) =>
				init?.method === "PATCH"
					? envelope(200, all[0])
					: envelope(200, all)
			);
		render(<UsersCard />);
		const user = userEvent.setup();
		await user.selectOptions(
			await screen.findByLabelText("Role for boss@x.com"),
			"viewer"
		);
		const dialog = screen.getByRole("dialog");
		expect(dialog).toHaveTextContent("You'll lose access to Settings.");
		expect(patchCount(spy)).toBe(0);
		await user.click(within(dialog).getByRole("button", { name: "Change role" }));
		await waitFor(() => expect(patchCount(spy)).toBe(1));
	});

	it("after a confirmed self-demotion, the store says viewer and you leave Settings", async () => {
		signIn();
		window.history.pushState({}, "", "/settings");
		vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) =>
			init?.method === "PATCH" ? envelope(200, all[0]) : envelope(200, all)
		);
		render(<UsersCard />);
		const user = userEvent.setup();
		await user.selectOptions(
			await screen.findByLabelText("Role for boss@x.com"),
			"viewer"
		);
		await user.click(
			within(screen.getByRole("dialog")).getByRole("button", {
				name: "Change role",
			})
		);
		await waitFor(() => expect(window.location.pathname).toBe("/"));
		expect(useAuth.getState().user?.role).toBe("viewer");
	});

	it("offers no Deactivate on your own row", async () => {
		signIn();
		vi.spyOn(globalThis, "fetch").mockImplementation(async () => envelope(200, all));
		render(<UsersCard />);
		await screen.findByLabelText("Role for boss@x.com");
		// Active rows are boss (you), v, other; only the last two can be deactivated.
		expect(screen.getAllByRole("button", { name: "Deactivate" })).toHaveLength(2);
	});

	it("disables Reactivate while the request is pending", async () => {
		signIn();
		let release: () => void = () => undefined;
		vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
			if (init?.method === "PATCH") {
				await new Promise<void>((r) => (release = r));
				return envelope(200, all[3]);
			}
			return envelope(200, all);
		});
		render(<UsersCard />);
		const user = userEvent.setup();
		await user.click(await screen.findByRole("button", { name: "Reactivate" }));
		expect(screen.getByRole("button", { name: "Reactivate" })).toBeDisabled();
		release();
	});

	it.each(["a@b", "no at", "a b@c.d", "x@y."])(
		"shows the inline error and sends nothing for %j",
		async (bad) => {
			signIn();
			const spy = vi
				.spyOn(globalThis, "fetch")
				.mockImplementation(async () => envelope(200, all));
			render(<UsersCard />);
			const user = userEvent.setup();
			await user.click(
				await screen.findByRole("button", { name: "Invite user" })
			);
			await user.type(screen.getByLabelText("Name"), "New");
			await user.type(screen.getByLabelText("Email"), bad);
			await user.click(
				screen.getByRole("button", { name: "Create invite link" })
			);
			expect(
				await screen.findByText("Enter a valid email address.")
			).toBeInTheDocument();
			expect(screen.getByLabelText("Email")).toHaveAttribute(
				"aria-invalid",
				"true"
			);
			expect(
				spy.mock.calls.filter(
					([, i]) => (i as RequestInit | undefined)?.method === "POST"
				)
			).toHaveLength(0);
		}
	);

	it.each(["user@example.com", "sales@mgi.test"])(
		"submits a valid email %j",
		async (good) => {
			signIn();
			const spy = vi
				.spyOn(globalThis, "fetch")
				.mockImplementation(async (_url, init) =>
					init?.method === "POST"
						? envelope(201, { inviteUrl: "http://x/invite/t" })
						: envelope(200, all)
				);
			render(<UsersCard />);
			const user = userEvent.setup();
			await user.click(
				await screen.findByRole("button", { name: "Invite user" })
			);
			await user.type(screen.getByLabelText("Name"), "New");
			await user.type(screen.getByLabelText("Email"), good);
			await user.click(
				screen.getByRole("button", { name: "Create invite link" })
			);
			expect(
				await screen.findByLabelText(`Invite link for ${good}`)
			).toBeInTheDocument();
			expect(screen.queryByText("Enter a valid email address.")).toBeNull();
			expect(
				spy.mock.calls.filter(
					([, i]) => (i as RequestInit | undefined)?.method === "POST"
				)
			).toHaveLength(1);
		}
	);
});
