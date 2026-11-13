import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import userEvent from "@testing-library/user-event";
import { act, cleanup, render, screen, waitFor } from "../../test/testUtils";
import { setFormatContext } from "../../lib/format";
import { useAuth } from "../../auth/store";
import type { UserRole } from "../../types/user";
import type { ProductCondition } from "./api";
import ConditionCard from "./ConditionCard";

const ID = "00000000-0000-4000-8000-000000000001";
const condition: ProductCondition = {
	grade: "open_box",
	notes: "Line1\nLine2",
	updatedAt: "2026-03-01T12:00:00.000Z",
	updatedBy: "Ann",
};

const signIn = (role: UserRole) =>
	useAuth.getState().setUser({ id: "u1", email: "a@b.c", name: "Ann", role });

let fetchSpy: MockInstance<typeof fetch>;
const ok = (data: unknown) =>
	new Response(JSON.stringify({ success: true, data, error: null }), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});

beforeEach(() => {
	setFormatContext({ currency: "USD", timeZone: "UTC" });
	signIn("admin");
	fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => ok(null));
});
afterEach(() => {
	vi.restoreAllMocks();
	cleanup(); // unmount before the store clears, or the card re-renders outside act
	act(() => useAuth.getState().clear());
});

const renderCard = (c: ProductCondition | null = condition) =>
	render(<ConditionCard productId={ID} condition={c} />);

describe("ConditionCard", () => {
	it("shows grade, notes and editor", () => {
		renderCard();
		expect(screen.getByText("Open box")).toBeInTheDocument();
		expect(screen.getByText(/Line1/)).toHaveTextContent("Line1 Line2");
		expect(screen.getByText(/Edited by Ann/)).toBeInTheDocument();
	});

	it("shows Not graded when null", () => {
		renderCard(null);
		expect(screen.getByText("Not graded")).toBeInTheDocument();
		expect(screen.queryByText(/Edited/)).not.toBeInTheDocument();
	});

	it("omits the name when the editor is unknown", () => {
		renderCard({ ...condition, updatedBy: null });
		expect(screen.getByText(/^Edited /)).not.toHaveTextContent("by");
	});

	it("viewer has no Edit button", () => {
		signIn("viewer");
		renderCard();
		expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
	});

	it("admin edits and saves", async () => {
		const user = userEvent.setup();
		renderCard();
		await user.click(screen.getByRole("button", { name: "Edit" }));
		await user.selectOptions(screen.getByLabelText("Grade"), "Grade C");
		const notes = screen.getByLabelText("Notes");
		await user.clear(notes);
		await user.type(notes, "Scuffed lid");
		await user.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument()
		);
		const [url, init] = fetchSpy.mock.calls.find(([, i]) => i?.method === "PUT")!;
		expect(url).toBe(`/api/products/${ID}/condition`);
		expect(JSON.parse(String(init?.body))).toEqual({
			grade: "C",
			notes: "Scuffed lid",
		});
	});

	it("sends null for Not graded and empty notes", async () => {
		const user = userEvent.setup();
		renderCard();
		await user.click(screen.getByRole("button", { name: "Edit" }));
		await user.selectOptions(screen.getByLabelText("Grade"), "Not graded");
		await user.clear(screen.getByLabelText("Notes"));
		await user.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() =>
			expect(fetchSpy.mock.calls.some(([, i]) => i?.method === "PUT")).toBe(true)
		);
		const put = fetchSpy.mock.calls.find(([, i]) => i?.method === "PUT")!;
		expect(JSON.parse(String(put[1]?.body))).toEqual({ grade: null, notes: null });
	});

	it("character count and limit", async () => {
		const user = userEvent.setup();
		renderCard();
		await user.click(screen.getByRole("button", { name: "Edit" }));
		expect(screen.getByLabelText("Notes")).toHaveAttribute("maxlength", "2000");
		expect(screen.getByText("11 / 2,000")).toBeInTheDocument();
	});

	it("save error shows inline and keeps the form open", async () => {
		fetchSpy.mockImplementation(
			async () =>
				new Response(
					JSON.stringify({
						success: false,
						data: null,
						error: {
							code: "FORBIDDEN",
							message: "Admins only",
						},
					}),
					{
						status: 403,
						headers: { "Content-Type": "application/json" },
					}
				)
		);
		const user = userEvent.setup();
		renderCard();
		await user.click(screen.getByRole("button", { name: "Edit" }));
		await user.click(screen.getByRole("button", { name: "Save" }));
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Only an admin can change the condition."
		);
		expect(screen.getByLabelText("Notes")).toBeInTheDocument();
	});

	it("cancel discards edits", async () => {
		const user = userEvent.setup();
		renderCard();
		await user.click(screen.getByRole("button", { name: "Edit" }));
		await user.type(screen.getByLabelText("Notes"), " extra");
		await user.click(screen.getByRole("button", { name: "Cancel" }));
		expect(screen.queryByLabelText("Notes")).not.toBeInTheDocument();
		expect(fetchSpy.mock.calls.some(([, i]) => i?.method === "PUT")).toBe(false);
		await user.click(screen.getByRole("button", { name: "Edit" }));
		expect(screen.getByLabelText("Notes")).toHaveValue("Line1\nLine2");
	});
});
