import { describe, expect, it, vi } from "vitest";
import { render, screen } from "../test/testUtils";
import RouteErrorBoundary from "./RouteErrorBoundary";

function Boom({ fail }: { fail: boolean }) {
	if (fail) throw new RangeError("Invalid time zone");
	return <p>page ok</p>;
}

describe("RouteErrorBoundary", () => {
	it("shows a fallback instead of blanking, and recovers when the route changes", () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		const { rerender } = render(
			<RouteErrorBoundary resetKey="/a">
				<Boom fail />
			</RouteErrorBoundary>
		);
		expect(screen.getByText("This page could not be displayed")).toBeInTheDocument();
		rerender(
			<RouteErrorBoundary resetKey="/b">
				<Boom fail={false} />
			</RouteErrorBoundary>
		);
		expect(screen.getByText("page ok")).toBeInTheDocument();
		spy.mockRestore();
	});
});
