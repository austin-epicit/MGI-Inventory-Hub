import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { render as plainRender } from "@testing-library/react";
import { createTestQueryClient } from "../../test/testUtils";
import SettingsPage from "./SettingsPage";

vi.mock("./Cin7ConnectionCard", () => ({ default: () => null }));
vi.mock("./UsersCard", () => ({ default: () => null }));
vi.mock("./SyncStatusCard", () => ({ default: () => null }));
vi.mock("./WebhooksCard", () => ({ default: () => null }));
vi.mock("../alerts/AlertsSettingsCard", () => ({
	default: () => <div id="alerts-settings" />,
}));

afterEach(() => vi.restoreAllMocks());

const renderAt = (path: string) =>
	plainRender(
		<QueryClientProvider client={createTestQueryClient()}>
			<MemoryRouter initialEntries={[path]}>
				<SettingsPage />
			</MemoryRouter>
		</QueryClientProvider>
	);

describe("SettingsPage hash scroll", () => {
	it("scrolls the Alerts card into view for #alerts-settings", () => {
		const spy = vi.spyOn(Element.prototype, "scrollIntoView");
		renderAt("/settings#alerts-settings");
		expect(spy).toHaveBeenCalledTimes(1);
		expect(spy.mock.contexts[0]).toHaveProperty("id", "alerts-settings");
	});

	it("does not scroll without a hash", () => {
		const spy = vi.spyOn(Element.prototype, "scrollIntoView");
		renderAt("/settings");
		expect(spy).not.toHaveBeenCalled();
	});
});
