import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import AppRoutes from "./AppRoutes";
import { useApplyTheme } from "./hooks/useApplyTheme";
import { queryClient } from "./lib/queryClient";

export default function App() {
	useApplyTheme();
	return (
		<QueryClientProvider client={queryClient}>
			<BrowserRouter>
				<AppRoutes />
			</BrowserRouter>
		</QueryClientProvider>
	);
}
