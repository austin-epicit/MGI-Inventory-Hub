import { useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Boxes, LayoutDashboard, Settings, ShoppingBag, ShoppingCart } from "lucide-react";
import ToastViewport from "../components/ui/ToastViewport";
import { useAuth } from "../auth/store";
import { useSyncStatus } from "../features/settings/hooks";
import { setFormatContext } from "../lib/format";
import FreshnessIndicator from "./FreshnessIndicator";
import RouteErrorBoundary from "./RouteErrorBoundary";
import SideNavItem from "./SideNavItem";
import UserMenu from "./UserMenu";

const ICON_SIZE = 20;

export default function AppLayout() {
	const [expanded, setExpanded] = useState(false);
	const { pathname } = useLocation();
	const isAdmin = useAuth((s) => s.user?.role === "admin");
	const { data: sync, isLoading: syncLoading } = useSyncStatus();
	const currency = sync?.baseCurrency ?? undefined;
	const timeZone = sync?.timeZone ?? undefined;
	// Set during render, not in an effect: children render after this line, so they format
	// with the account's zone on their first paint. Idempotent, so safe to repeat.
	setFormatContext({ currency, timeZone });

	return (
		<div className="flex h-screen bg-canvas text-text-primary">
			{/* Fixed w-16 rail in the flex row; the inner box widens over the page on hover so nothing reflows. */}
			<aside
				onMouseEnter={() => setExpanded(true)}
				onMouseLeave={() => setExpanded(false)}
				className="relative w-16 flex-shrink-0 z-40"
			>
				<div
					className={`absolute inset-y-0 left-0 flex flex-col bg-base border-r border-border overflow-hidden transition-[width] duration-200 ease-out ${expanded ? "w-40 lg:w-44" : "w-16"}`}
				>
					<nav className="flex-1 min-h-0 py-2 space-y-1 short:space-y-0 overflow-y-auto overflow-x-hidden sidebar-nav">
						<SideNavItem
							expanded={expanded}
							to="/"
							icon={<LayoutDashboard size={ICON_SIZE} />}
							label="Overview"
						/>
						<SideNavItem
							expanded={expanded}
							to="/products"
							end={false}
							icon={<Boxes size={ICON_SIZE} />}
							label="Products"
						/>
						<SideNavItem
							expanded={expanded}
							to="/purchases"
							end={false}
							icon={<ShoppingCart size={ICON_SIZE} />}
							label="Purchases"
						/>
						<SideNavItem
							expanded={expanded}
							to="/sales"
							end={false}
							icon={<ShoppingBag size={ICON_SIZE} />}
							label="Sales"
						/>
					</nav>
					{isAdmin && (
						<div className="shrink-0 border-t border-border py-2">
							<SideNavItem
								expanded={expanded}
								to="/settings"
								icon={<Settings size={ICON_SIZE} />}
								label="Settings"
							/>
						</div>
					)}
				</div>
			</aside>

			<div className="flex flex-col flex-1 min-w-0 overflow-hidden">
				<header
					className="flex justify-between items-center px-6 h-14 bg-base border-b border-border"
					style={{
						paddingLeft: expanded ? 120 : 24,
						transition: "padding-left 200ms ease-out",
					}}
				>
					<div className="font-semibold text-sm whitespace-nowrap text-text-primary">
						MGI Inventory Hub
					</div>
					<div className="flex items-center gap-3">
						<FreshnessIndicator />
						<UserMenu />
					</div>
				</header>

				<main className="flex-1 overflow-hidden bg-canvas">
					{/* Side padding grows past 1920px of content to cap reading width on big monitors. */}
					<div
						data-layout-scroller
						className="p-4 md:py-6 md:px-[max(1.5rem,calc((100%-1920px)/2))] h-full overflow-y-auto"
					>
						{/* Pages wait for the status so they never paint in the browser's zone first; a
						    later change of currency or zone remounts them so they re-format. */}
						{!syncLoading && (
							<div
								key={`${currency}|${timeZone}`}
								className="contents"
							>
								<RouteErrorBoundary
									resetKey={pathname}
								>
									<Outlet />
								</RouteErrorBoundary>
							</div>
						)}
					</div>
				</main>
			</div>

			<ToastViewport />
		</div>
	);
}
