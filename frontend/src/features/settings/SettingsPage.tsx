import PageHeader from "../../components/ui/PageHeader";
import Cin7ConnectionCard from "./Cin7ConnectionCard";
import SyncStatusCard from "./SyncStatusCard";
import UsersCard from "./UsersCard";
import WebhooksCard from "./WebhooksCard";

export default function SettingsPage() {
	return (
		<>
			<PageHeader title="Settings" />
			<div className="grid gap-4 xl:grid-cols-2">
				<div className="space-y-4">
					<Cin7ConnectionCard />
					<UsersCard />
				</div>
				<div className="space-y-4">
					<SyncStatusCard />
					<WebhooksCard />
				</div>
			</div>
		</>
	);
}
