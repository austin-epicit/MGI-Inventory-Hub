import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, waitFor, within } from "../../test/testUtils";
import { setFormatContext } from "../../lib/format";
import type { ProductRow } from "./api";
import ProductsPage from "./ProductsPage";

const row = (over: Partial<ProductRow> = {}): ProductRow => ({
	id: "p1",
	sku: "SKU-1",
	name: "Copper pipe",
	category: "Parts",
	brand: "Acme",
	grade: null,
	status: "Active",
	onHand: 12,
	available: 10,
	averageCost: 5.5,
	listPrices: [{ code: 1, name: "Retail", value: 12.5 }],
	lastPurchaseCost: 4.25,
	lastPurchaseDate: "2026-03-01",
	lastSoldPrice: 11,
	lastSoldDate: "2026-02-28",
	thumbUrl: null,
	...over,
});

const reply = (data: unknown, count?: number) =>
	new Response(
		JSON.stringify({
			success: true,
			data,
			error: null,
			meta: count === undefined ? {} : { count },
		}),
		{ status: 200, headers: { "Content-Type": "application/json" } }
	);

let rows: ProductRow[] = [];
let fetchSpy: MockInstance<typeof fetch>;
const listCalls = () =>
	fetchSpy.mock.calls
		.map(([u]) => String(u))
		.filter((u) => u.startsWith("/api/products?"))
		.map((u) => new URL(u, "http://x").searchParams);

beforeEach(() => {
	setFormatContext({ currency: "USD" });
	fetchSpy = vi
		.spyOn(globalThis, "fetch")
		.mockImplementation(async (url) =>
			String(url).startsWith("/api/products/facets")
				? reply({ categories: ["Parts", "Tools"], brands: ["Acme"] })
				: reply(rows, rows.length)
		);
});
afterEach(() => vi.restoreAllMocks());

describe("ProductsPage", () => {
	it("shows list prices per tier, last purchase/sold with calendar dates, and average cost", async () => {
		rows = [row()];
		render(<ProductsPage />);
		const tr = (await screen.findByText("Copper pipe")).closest("tr")!;
		expect(within(tr).getByText("Retail")).toBeInTheDocument();
		expect(within(tr).getByText("$12.50")).toBeInTheDocument();
		expect(within(tr).getByText("$5.50")).toBeInTheDocument();
		expect(within(tr).getByText("Mar 1, 2026")).toBeInTheDocument();
		expect(within(tr).getByText("$4.25")).toBeInTheDocument();
		expect(within(tr).getByText("Feb 28, 2026")).toBeInTheDocument();
	});

	it("shows 'Not set' without list prices and em dashes without orders", async () => {
		rows = [
			row({
				listPrices: [],
				lastPurchaseCost: null,
				lastPurchaseDate: null,
				lastSoldPrice: null,
				lastSoldDate: null,
			}),
		];
		render(<ProductsPage />);
		const tr = (await screen.findByText("Copper pipe")).closest("tr")!;
		expect(within(tr).getByText("Not set")).toBeInTheDocument();
		expect(within(tr).getAllByText("—")).toHaveLength(3); // last purchase, last sold, grade
	});

	it("renders a lazy 40x40 thumbnail, and a placeholder box when there is no picture", async () => {
		rows = [
			row({ id: "a", name: "With pic", thumbUrl: "/api/images/x/thumb" }),
			row({ id: "b", name: "No pic", thumbUrl: null }),
		];
		render(<ProductsPage />);
		const img = await screen.findByRole("img", { name: "With pic" });
		expect(img).toHaveAttribute("loading", "lazy");
		expect(img).toHaveAttribute("src", "/api/images/x/thumb");
		expect(img).toHaveAttribute("width", "40");
		expect(img.parentElement).toHaveClass("h-10", "w-10");
		const bare = (await screen.findByText("No pic")).closest("tr")!;
		expect(within(bare).queryByRole("img")).toBeNull();
		expect(bare.querySelector(".h-10.w-10")).not.toBeNull();
	});

	it("clicking a sortable header asks the API to sort, and again flips the direction", async () => {
		rows = [row()];
		render(<ProductsPage />);
		await screen.findByText("Copper pipe");
		const user = userEvent.setup();
		await user.click(screen.getByRole("columnheader", { name: /Last sold/ }));
		await waitFor(() => expect(listCalls().at(-1)!.get("sort")).toBe("lastSoldDate"));
		expect(listCalls().at(-1)!.get("dir")).toBe("asc");
		await user.click(screen.getByRole("columnheader", { name: /Last sold/ }));
		await waitFor(() => expect(listCalls().at(-1)!.get("dir")).toBe("desc"));
	});

	it("filters by status and goes back to page 1; the chip clears it", async () => {
		rows = [row()];
		render(<ProductsPage />);
		await screen.findByText("Copper pipe");
		const user = userEvent.setup();
		await user.click(screen.getByRole("button", { name: /^Status/ }));
		await user.click(screen.getByRole("option", { name: "Deprecated" }));
		await waitFor(() => expect(listCalls().at(-1)!.get("status")).toBe("Deprecated"));
		expect(screen.getAllByText("Status: Deprecated")).toHaveLength(2); // trigger + chip
		await user.click(screen.getByRole("button", { name: "Clear filter" }));
		await waitFor(() => expect(listCalls().at(-1)!.get("status")).toBeNull());
	});

	it("sends the typed search to the API after the debounce", async () => {
		rows = [row()];
		render(<ProductsPage />);
		await screen.findByText("Copper pipe");
		await userEvent.setup().type(screen.getByPlaceholderText(/Search by SKU/), "abc");
		await waitFor(() => expect(listCalls().at(-1)!.get("search")).toBe("abc"));
	});

	it("never wraps the SKU, truncates it with a title, and shows money to 2 decimals", async () => {
		rows = [row({ sku: "CIS-ASA-5516-X-FIREWALL-A", averageCost: 512.1726 })];
		render(<ProductsPage />);
		const sku = (await screen.findAllByTitle("CIS-ASA-5516-X-FIREWALL-A")).at(-1)!;
		const td = sku.closest("td")!;
		expect(td).toHaveClass("whitespace-nowrap");
		expect(td.firstElementChild).toHaveClass("truncate");
		expect(screen.getByText("$512.17")).toBeInTheDocument();
		expect(screen.queryByText(/512\.1726/)).toBeNull();
	});

	it("shows the grade badge, and a dash when the product is not graded", async () => {
		rows = [
			row({ id: "g", name: "Graded", grade: "A" }),
			row({ id: "n", name: "Plain", grade: null }),
		];
		render(<ProductsPage />);
		const graded = (await screen.findByText("Graded")).closest("tr")!;
		expect(within(graded).getByText("Grade A")).toBeInTheDocument();
		const plain = screen.getByText("Plain").closest("tr")!;
		expect(within(plain).queryByText("Not graded")).toBeNull();
		expect(within(plain).getAllByText("—").length).toBeGreaterThan(0);
	});

	it("seeds the grade filter from the URL and shows its chip", async () => {
		rows = [row()];
		window.history.replaceState(null, "", "/products?grade=none");
		render(<ProductsPage />);
		await waitFor(() => expect(listCalls()[0]?.get("grade")).toBe("none"));
		expect(await screen.findAllByText("Grade: Not graded")).toHaveLength(2); // trigger + chip
		window.history.replaceState(null, "", "/");
	});

	it("choosing a grade sends it to the API", async () => {
		rows = [row()];
		render(<ProductsPage />);
		await screen.findByText("Copper pipe");
		const user = userEvent.setup();
		await user.click(screen.getByRole("button", { name: /^Grade/ }));
		await user.click(screen.getByRole("option", { name: "Grade B" }));
		await waitFor(() => expect(listCalls().at(-1)!.get("grade")).toBe("B"));
	});

	it("says so when nothing matches", async () => {
		rows = [];
		render(<ProductsPage />);
		expect(await screen.findByText("No products yet")).toBeInTheDocument();
	});
});

describe("ProductsPage export", () => {
	it("links the server export with the active filters and sort, and no paging", async () => {
		rows = [row()];
		render(<ProductsPage />);
		await screen.findByText("Copper pipe");
		const user = userEvent.setup();
		await user.click(screen.getByRole("button", { name: /^Category/ }));
		await user.click(await screen.findByRole("option", { name: "Parts" }));
		await user.click(screen.getByRole("button", { name: /^Grade/ }));
		await user.click(await screen.findByRole("option", { name: "Not graded" }));
		await user.click(screen.getByRole("columnheader", { name: /^SKU/ }));
		await waitFor(() => expect(listCalls().at(-1)!.get("sort")).toBe("sku"));
		const link = await screen.findByRole("link", { name: "Export CSV" });
		const url = new URL(link.getAttribute("href")!, "http://x");
		expect(url.pathname).toBe("/api/products/export.csv");
		expect(url.searchParams.get("category")).toBe("Parts");
		expect(url.searchParams.get("grade")).toBe("none");
		expect(url.searchParams.get("sort")).toBe("sku");
		expect(url.searchParams.get("dir")).toBe("asc");
		expect(url.searchParams.has("page")).toBe(false);
		expect(url.searchParams.has("limit")).toBe(false);
		expect(link).toHaveAttribute("download");
	});

	it("has no export link while there are no rows to export", async () => {
		rows = [];
		render(<ProductsPage />);
		await screen.findByText("No products yet");
		expect(screen.getByRole("button", { name: "Export CSV" })).toBeDisabled();
	});
});
