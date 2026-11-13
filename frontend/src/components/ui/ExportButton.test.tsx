import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ExportButton from "./ExportButton";
import { localYmd } from "../../lib/csv";

const toast = vi.hoisted(() => ({
	success: vi.fn(),
	error: vi.fn(),
	warning: vi.fn(),
	info: vi.fn(),
}));
vi.mock("../../hooks/useToast", () => ({ useToast: () => toast }));

function csvResponse(disposition?: string) {
	return new Response("a,b\r\n1,2\r\n", {
		status: 200,
		headers: {
			"Content-Type": "text/csv",
			...(disposition ? { "Content-Disposition": disposition } : {}),
		},
	});
}

describe("ExportButton (server export)", () => {
	let createUrl: ReturnType<typeof vi.fn>;
	let downloads: string[];

	beforeEach(() => {
		createUrl = vi.fn(() => "blob:fake");
		URL.createObjectURL = createUrl as unknown as typeof URL.createObjectURL;
		URL.revokeObjectURL = vi.fn();
		downloads = [];
		vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
			this: HTMLAnchorElement
		) {
			downloads.push(this.download);
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		toast.error.mockClear();
	});

	it("saves the file under the name the server sent", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				csvResponse('attachment; filename="products-2026-11-13.csv"')
			)
		);
		render(<ExportButton href="/api/products/export.csv?search=a" />);
		fireEvent.click(screen.getByRole("button", { name: /export csv/i }));
		await waitFor(() => expect(downloads).toEqual(["products-2026-11-13.csv"]));
		expect(createUrl).toHaveBeenCalledTimes(1);
		expect(fetch).toHaveBeenCalledWith(
			"/api/products/export.csv?search=a",
			expect.objectContaining({ credentials: "same-origin" })
		);
	});

	it("falls back to mgi-<name>-<date>.csv when the header is missing", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => csvResponse())
		);
		render(<ExportButton href="/api/sales/export.csv" />);
		fireEvent.click(screen.getByRole("button", { name: /export csv/i }));
		await waitFor(() => expect(downloads).toEqual([`mgi-sales-${localYmd()}.csv`]));
	});

	it("shows the server's message and saves nothing on a 422", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							success: false,
							data: null,
							error: {
								code: "TOO_MANY_ROWS",
								message: "Too many rows to export. Narrow the filters.",
							},
						}),
						{
							status: 422,
							headers: {
								"Content-Type": "application/json",
							},
						}
					)
			)
		);
		render(<ExportButton href="/api/purchases/export.csv" />);
		fireEvent.click(screen.getByRole("button", { name: /export csv/i }));
		await waitFor(() =>
			expect(toast.error).toHaveBeenCalledWith(
				"Too many rows to export. Narrow the filters."
			)
		);
		expect(createUrl).not.toHaveBeenCalled();
		expect(downloads).toEqual([]);
	});

	it("is disabled and reads Exporting… while the request is pending", async () => {
		let release!: (r: Response) => void;
		vi.stubGlobal(
			"fetch",
			vi.fn(() => new Promise<Response>((resolve) => (release = resolve)))
		);
		render(<ExportButton href="/api/products/export.csv" />);
		fireEvent.click(screen.getByRole("button", { name: /export csv/i }));
		const pending = await screen.findByRole("button", { name: /exporting…/i });
		expect(pending).toBeDisabled();
		release(csvResponse());
		await waitFor(() =>
			expect(screen.getByRole("button", { name: /export csv/i })).toBeEnabled()
		);
	});
});
