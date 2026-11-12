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
		await user.type(screen.getByLabelText("Application Key"), "bad");
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
		await user.type(screen.getByLabelText("Application Key"), "key");
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

	it("offers the form and a Remove button when the stored credentials cannot be read", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			envelope(200, conn({ connected: true, unreadable: true }))
		);
		render(<Cin7ConnectionCard />);
		expect(await screen.findByRole("alert")).toHaveTextContent(/can.t be read/i);
		expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
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
