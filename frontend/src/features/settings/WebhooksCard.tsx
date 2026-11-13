import Card from "../../components/ui/Card";
import { HEADER_BTN_PRIMARY, HEADER_BTN_SECONDARY } from "../../components/ui/headerActions";
import { useToast } from "../../hooks/useToast";
import { errorMessage } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import { useRegisterWebhooks, useSyncStatus, useWebhooks } from "./hooks";

export default function WebhooksCard() {
	const { data, isLoading, isError, refetch } = useWebhooks();
	const status = useSyncStatus();
	const register = useRegisterWebhooks();
	const toast = useToast();

	const submit = () =>
		register.mutate(undefined, {
			onSuccess: () => toast.success("Webhooks registered in Cin7"),
		});
	const inactive = status.data?.webhooks.inactiveTypes ?? [];
	// A failed status request says nothing about the connection, so it is its own state.
	const statusFailed = status.isError && !status.data;
	const notConnected = !statusFailed && !status.data?.connected;

	return (
		<Card
			title="Cin7 webhooks"
			headerAction={
				<button
					type="button"
					className={
						data?.registered
							? HEADER_BTN_SECONDARY
							: HEADER_BTN_PRIMARY
					}
					disabled={
						register.isPending || notConnected || statusFailed
					}
					title={
						statusFailed
							? "Connection status unavailable"
							: notConnected
								? "Connect Cin7 first"
								: undefined
					}
					onClick={submit}
				>
					{register.isPending
						? "Registering…"
						: data?.registered
							? "Register again"
							: "Register webhooks"}
				</button>
			}
		>
			<div className="space-y-3">
				<p className="text-sm text-text-muted">
					Webhooks make changes in Cin7 show up within about a minute
					instead of at the next 5-minute sync. Requires Cin7 Advanced
					Automations. Without it nothing here is needed: syncing
					works the same.
				</p>

				{notConnected && !status.isLoading && (
					<p className="text-xs text-text-muted">
						Connect Cin7 above before registering webhooks.
					</p>
				)}

				{statusFailed && (
					<div className="flex items-center gap-3 text-sm text-error-text">
						<span role="alert">
							Couldn't check the Cin7 connection.
						</span>
						<button
							type="button"
							className={HEADER_BTN_SECONDARY}
							onClick={() => status.refetch()}
						>
							Try again
						</button>
					</div>
				)}

				{register.isError && (
					<p role="alert" className="text-sm text-error-text">
						{errorMessage(register.error)}
					</p>
				)}

				{inactive.length > 0 && (
					<p
						role="alert"
						className="rounded-md border border-warning-border bg-warning-bg px-3 py-2 text-sm text-warning-text"
					>
						{inactive.length} webhook
						{inactive.length === 1 ? " is" : "s are"} off in
						Cin7. Register again to turn them back on.
					</p>
				)}

				{isLoading ? (
					<p className="text-sm text-text-muted">Loading…</p>
				) : isError || !data ? (
					<div className="flex items-center gap-3 text-sm text-error-text">
						<span role="alert">
							Couldn't load the webhook state.
						</span>
						<button
							type="button"
							className={HEADER_BTN_SECONDARY}
							onClick={() => refetch()}
						>
							Try again
						</button>
					</div>
				) : (
					<>
						{data.reactivatedAt && (
							<p className="text-xs text-text-muted">
								Cin7 switched{" "}
								{data.reactivatedTypes.length}{" "}
								webhook
								{data.reactivatedTypes.length === 1
									? ""
									: "s"}{" "}
								off; they were turned back on{" "}
								{formatDateTime(data.reactivatedAt)}{" "}
								and a full re-check ran.
							</p>
						)}
						{data.registered ? (
							<ul className="divide-y divide-border-subtle rounded-md border border-border-subtle text-sm">
								{data.types.map((t) => (
									<li
										key={t.type}
										className="flex items-center justify-between gap-3 px-3 py-1.5"
									>
										<span className="font-mono text-xs">
											{t.type}
										</span>
										<span
											className={
												t.active
													? "text-success-text"
													: "text-warning-text"
											}
										>
											{t.active
												? "Active"
												: "Off"}
										</span>
									</li>
								))}
							</ul>
						) : (
							<p className="text-sm text-text-muted">
								Not registered yet.
							</p>
						)}
						<p className="text-xs text-text-muted">
							Last event received:{" "}
							{data.lastEventAt
								? formatDateTime(data.lastEventAt)
								: "None yet"}
							{data.lastCheckAt &&
								` · health checked ${formatDateTime(data.lastCheckAt)}`}
						</p>
					</>
				)}
			</div>
		</Card>
	);
}
