import { Route, Routes } from "react-router-dom";
import AcceptInvitePage from "./auth/AcceptInvitePage";
import LoginPage from "./auth/LoginPage";
import RequireAuth from "./auth/RequireAuth";
import ResetPasswordPage from "./auth/ResetPasswordPage";
import SetupPage from "./auth/SetupPage";
import ProductDetailPage from "./features/products/ProductDetailPage";
import ProductsPage from "./features/products/ProductsPage";
import PurchaseDetailPage from "./features/purchases/PurchaseDetailPage";
import PurchasesPage from "./features/purchases/PurchasesPage";
import SaleDetailPage from "./features/sales/SaleDetailPage";
import SalesPage from "./features/sales/SalesPage";
import AlertsPage from "./features/alerts/AlertsPage";
import InsightsPage from "./features/insights/InsightsPage";
import NotFoundPage from "./features/NotFoundPage";
import OverviewPage from "./features/overview/OverviewPage";
import SettingsPage from "./features/settings/SettingsPage";
import AppLayout from "./layout/AppLayout";

export default function AppRoutes() {
	return (
		<Routes>
			<Route path="/login" element={<LoginPage />} />
			<Route path="/setup" element={<SetupPage />} />
			<Route path="/invite/:token" element={<AcceptInvitePage />} />
			<Route path="/reset/:token" element={<ResetPasswordPage />} />
			<Route element={<RequireAuth />}>
				<Route element={<AppLayout />}>
					<Route index element={<OverviewPage />} />
					<Route path="insights" element={<InsightsPage />} />
					<Route path="products" element={<ProductsPage />} />
					<Route
						path="products/:id"
						element={<ProductDetailPage />}
					/>
					<Route path="purchases" element={<PurchasesPage />} />
					<Route
						path="purchases/:id"
						element={<PurchaseDetailPage />}
					/>
					<Route path="sales" element={<SalesPage />} />
					<Route path="sales/:id" element={<SaleDetailPage />} />
					<Route path="alerts" element={<AlertsPage />} />
					<Route element={<RequireAuth role="admin" />}>
						<Route path="settings" element={<SettingsPage />} />
					</Route>
					<Route path="*" element={<NotFoundPage />} />
				</Route>
			</Route>
		</Routes>
	);
}
