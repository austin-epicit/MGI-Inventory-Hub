import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render as rtlRender } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { screen } from "../test/testUtils";
import LoginPage from "./LoginPage";
import SetupPage from "./SetupPage";
import SetPasswordForm from "./SetPasswordForm";
import { useAuth } from "./store";

const json = (status: number, body: unknown) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
const ok = (data: unknown) => json(200, { success: true, data, error: null });
const fail = (status: number, code: string, message: string, field?: string) =>
	json(status, { success: false, data: null, error: { code, message, field } });

const mount = (ui: React.ReactElement) =>
	rtlRender(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<MemoryRouter>{ui}</MemoryRouter>
		</QueryClientProvider>
	);

// Routes by URL so setup-status polling never counts as a form request.
const mockApi = (post: () => Response | Promise<Response>, needsSetup = false) =>
	vi
		.spyOn(globalThis, "fetch")
		.mockImplementation(async (input) =>
			String(input).includes("setup-status") ? ok({ needsSetup }) : post()
		);
const posts = (spy: { mock: { calls: unknown[][] } }) =>
	spy.mock.calls.filter((c) => !String(c[0]).includes("setup-status"));

afterEach(() => {
	vi.restoreAllMocks();
	useAuth.setState({ user: null, sessionExpired: false });
});

describe("LoginPage forms", () => {
	it("keeps Sign in disabled until email and password are filled", async () => {
		mockApi(() => ok(null));
		mount(<LoginPage />);
		const btn = screen.getByRole("button", { name: "Sign in" });
		expect(btn).toBeDisabled();
		await userEvent.type(screen.getByLabelText("Email"), "a@b.c");
		expect(btn).toBeDisabled();
		await userEvent.type(screen.getByLabelText("Password"), "x");
		expect(btn).toBeEnabled();
	});

	it("turns a server VALIDATION_ERROR into one plain sentence next to the field", async () => {
		mockApi(() =>
			fail(400, "VALIDATION_ERROR", "body.email: Invalid email address", "email")
		);
		mount(<LoginPage />);
		await userEvent.type(screen.getByLabelText("Email"), "a@b");
		await userEvent.type(screen.getByLabelText("Password"), "x");
		await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
		expect(
			await screen.findByText("Enter a valid email and your password.")
		).toBeInTheDocument();
		expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
	});

	it("shows Signing in… while the request is pending", async () => {
		mockApi(() => new Promise<Response>(() => {}));
		mount(<LoginPage />);
		await userEvent.type(screen.getByLabelText("Email"), "a@b.c");
		await userEvent.type(screen.getByLabelText("Password"), "x");
		await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
		expect(await screen.findByRole("button", { name: "Signing in…" })).toBeDisabled();
	});

	it("keeps the human credential message", async () => {
		mockApi(() => fail(401, "UNAUTHORIZED", "Invalid email or password"));
		mount(<LoginPage />);
		await userEvent.type(screen.getByLabelText("Email"), "a@b.c");
		await userEvent.type(screen.getByLabelText("Password"), "x");
		await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
		expect(await screen.findByText("Invalid email or password")).toBeInTheDocument();
	});

	it("says setup status can't be checked, and retries", async () => {
		let calls = 0;
		vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
			calls += 1;
			return calls === 1
				? fail(500, "INTERNAL", "boom")
				: ok({ needsSetup: true });
		});
		mount(<LoginPage />);
		expect(await screen.findByText("Can't check setup status.")).toBeInTheDocument();
		await userEvent.click(screen.getByRole("button", { name: "Try again" }));
		expect(
			await screen.findByRole("link", { name: /set up the first admin/i })
		).toBeInTheDocument();
	});
});

describe("SetPasswordForm", () => {
	const form = () => (
		<SetPasswordForm
			title="Reset"
			endpoint="/api/auth/reset"
			token="t"
			cta="Save password"
		/>
	);
	const fill = async (pw: string, confirm = pw) => {
		await userEvent.type(screen.getByLabelText("New password"), pw);
		await userEvent.type(screen.getByLabelText("Confirm password"), confirm);
		await userEvent.click(screen.getByRole("button", { name: "Save password" }));
	};

	it("rejects an 11-character password inline without a request", async () => {
		const spy = mockApi(() => ok(null));
		mount(form());
		await fill("a".repeat(11));
		expect(screen.getByText("Use at least 12 characters.")).toBeInTheDocument();
		expect(screen.getByLabelText("New password")).toHaveAttribute(
			"aria-invalid",
			"true"
		);
		expect(posts(spy)).toHaveLength(0);
	});

	it("rejects more than 72 UTF-8 bytes inline without a request", async () => {
		const spy = mockApi(() => ok(null));
		mount(form());
		await fill("é".repeat(40)); // 40 chars, 80 bytes
		expect(
			screen.getByText("Use at most 72 bytes (fewer if you use symbols).")
		).toBeInTheDocument();
		expect(posts(spy)).toHaveLength(0);
	});

	it("flags a mismatch under the confirm field", async () => {
		const spy = mockApi(() => ok(null));
		mount(form());
		await fill("a".repeat(12), "b".repeat(12));
		expect(screen.getByLabelText("Confirm password")).toHaveAttribute(
			"aria-invalid",
			"true"
		);
		expect(posts(spy)).toHaveLength(0);
	});

	it("replaces the form with the expired-link message and a sign-in link", async () => {
		mockApi(() => fail(400, "INVALID_TOKEN", "This link is invalid or has expired"));
		mount(form());
		await fill("a".repeat(12));
		expect(
			await screen.findByText(
				"This link has expired or was already used. Ask an admin for a new link."
			)
		).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "Go to sign in" })).toHaveAttribute(
			"href",
			"/login"
		);
		expect(screen.queryByLabelText("New password")).toBeNull();
	});

	it("shows Saving password… while pending", async () => {
		mockApi(() => new Promise<Response>(() => {}));
		mount(form());
		await fill("a".repeat(12));
		expect(
			await screen.findByRole("button", { name: "Saving password…" })
		).toBeDisabled();
	});
});

describe("SetupPage", () => {
	const fillValid = async () => {
		await userEvent.type(await screen.findByLabelText("Setup token"), "tok");
		await userEvent.type(screen.getByLabelText("Name"), "Ann");
		await userEvent.type(screen.getByLabelText("Email"), "a@b.co");
		await userEvent.type(screen.getByLabelText("Password"), "a".repeat(12));
		await userEvent.click(
			screen.getByRole("button", { name: /create admin|creating/i })
		);
	};

	it("shows per-field messages on an empty submit and sends nothing", async () => {
		const spy = mockApi(() => ok(null), true);
		mount(<SetupPage />);
		await userEvent.click(await screen.findByRole("button", { name: "Create admin" }));
		expect(screen.getByText("Enter the setup token.")).toBeInTheDocument();
		expect(screen.getByText("Enter your name.")).toBeInTheDocument();
		expect(screen.getByText("Enter your email.")).toBeInTheDocument();
		expect(screen.getByText("Use at least 12 characters.")).toBeInTheDocument();
		expect(screen.getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");
		expect(posts(spy)).toHaveLength(0);
	});

	it("shows Creating admin… while pending", async () => {
		mockApi(() => new Promise<Response>(() => {}), true);
		mount(<SetupPage />);
		await fillValid();
		expect(
			await screen.findByRole("button", { name: "Creating admin…" })
		).toBeDisabled();
	});

	it("puts the wrong-token message under the token field", async () => {
		mockApi(
			() => fail(403, "FORBIDDEN", "Setup token is incorrect", "setupToken"),
			true
		);
		mount(<SetupPage />);
		await fillValid();
		expect(await screen.findByText("Setup token is incorrect")).toBeInTheDocument();
		expect(screen.getByLabelText("Setup token")).toHaveAttribute(
			"aria-invalid",
			"true"
		);
	});

	it("says setup status can't be checked, with Try again", async () => {
		vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
			fail(500, "INTERNAL", "boom")
		);
		mount(<SetupPage />);
		expect(await screen.findByText("Can't check setup status.")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
	});
});
