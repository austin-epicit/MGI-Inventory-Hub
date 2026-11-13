import { useState } from "react";
import Card from "../../components/ui/Card";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import { HEADER_BTN_PRIMARY, HEADER_BTN_SECONDARY } from "../../components/ui/headerActions";
import { useToast } from "../../hooks/useToast";
import { ApiError, errorMessage } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import { inputClass } from "./ui";
import { useCin7Connection, useDisconnectCin7, useSaveCin7 } from "./hooks";

export default function Cin7ConnectionCard() {
	const { data, isLoading, isError, refetch } = useCin7Connection();
	const save = useSaveCin7();
	const disconnect = useDisconnectCin7();
	const toast = useToast();
	const [accountId, setAccountId] = useState("");
	const [applicationKey, setApplicationKey] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [replaceOpen, setReplaceOpen] = useState(false);

	const attempt = async (confirmReplace: boolean) => {
		setError(null);
		try {
			await save.mutateAsync({
				accountId,
				applicationKey,
				...(confirmReplace ? { confirmReplace: true } : {}),
			});
			setReplaceOpen(false);
			setAccountId("");
			setApplicationKey("");
			toast.success(
				"Cin7 connected. Syncing starts within a few minutes, or use Sync now."
			);
		} catch (err) {
			if (err instanceof ApiError && err.code === "ACCOUNT_CHANGED") {
				setReplaceOpen(true);
				return;
			}
			setReplaceOpen(false);
			setError(errorMessage(err));
		}
	};

	const submit = (e: React.FormEvent) => {
		e.preventDefault();
		return attempt(false);
	};

	return (
		<Card title="Cin7 connection">
			{isLoading ? (
				<p className="text-sm text-text-muted">Loading…</p>
			) : isError || !data ? (
				<div className="flex items-center gap-3 text-sm text-error-text">
					<span role="alert">Couldn't load the connection.</span>
					<button
						type="button"
						className={HEADER_BTN_SECONDARY}
						onClick={() => refetch()}
					>
						Try again
					</button>
				</div>
			) : (
				<div className="space-y-4">
					{data.source === "fixture" && (
						<p
							role="note"
							className="rounded-md border border-info-border bg-info-bg px-3 py-2 text-sm text-info-text"
						>
							This app is showing demo data. Live sync
							starts when the server runs with
							CIN7_SOURCE=http, a one-time deploy setting.
							You can save your credentials now.
						</p>
					)}

					{data.unreadable ? (
						<div
							role="alert"
							className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning-border bg-warning-bg px-3 py-2 text-sm text-warning-text"
						>
							<span>
								The saved credentials can&apos;t be
								read (the encryption key may have
								changed). Enter them again below, or
								disconnect.
							</span>
							<button
								type="button"
								className={HEADER_BTN_SECONDARY}
								onClick={() => setConfirmOpen(true)}
							>
								Disconnect
							</button>
						</div>
					) : data.connected ? (
						<div className="flex flex-wrap items-center justify-between gap-3">
							<div className="min-w-0 text-sm">
								<p className="font-medium text-text-primary">
									Connected
									{data.company
										? ` to ${data.company}`
										: ""}
								</p>
								<p className="text-xs text-text-muted">
									Account{" "}
									{data.accountIdMasked}
									{data.verifiedAt
										? ` · verified ${formatDateTime(data.verifiedAt)}`
										: ""}
									{data.baseCurrency
										? ` · ${data.baseCurrency}`
										: ""}
									{data.timeZone
										? ` · ${data.timeZone}`
										: ""}
								</p>
							</div>
							<button
								type="button"
								className={HEADER_BTN_SECONDARY}
								onClick={() => setConfirmOpen(true)}
							>
								Disconnect
							</button>
						</div>
					) : (
						<p className="text-sm text-text-muted">
							Not connected. Enter the Account ID and
							Application key from Cin7 (API access
							settings). They are checked with Cin7 before
							being saved.
						</p>
					)}

					<form
						onSubmit={submit}
						className="grid gap-3 sm:grid-cols-2"
					>
						<label className="text-xs font-medium text-text-secondary">
							Account ID
							<input
								className={`${inputClass} mt-1`}
								value={accountId}
								onChange={(e) =>
									setAccountId(e.target.value)
								}
								maxLength={200}
								autoComplete="off"
								spellCheck={false}
							/>
						</label>
						<label className="text-xs font-medium text-text-secondary">
							Application key
							<input
								type="password"
								className={`${inputClass} mt-1`}
								value={applicationKey}
								onChange={(e) =>
									setApplicationKey(
										e.target.value
									)
								}
								maxLength={200}
								autoComplete="new-password"
								spellCheck={false}
							/>
						</label>
						{error && (
							<p
								role="alert"
								className="text-sm text-error-text sm:col-span-2"
							>
								{error}
							</p>
						)}
						<div className="sm:col-span-2">
							<button
								type="submit"
								className={HEADER_BTN_PRIMARY}
								disabled={
									save.isPending ||
									!accountId.trim() ||
									!applicationKey.trim()
								}
							>
								{save.isPending
									? "Checking with Cin7…"
									: data.connected
										? "Replace credentials"
										: "Save and verify"}
							</button>
						</div>
					</form>
				</div>
			)}

			<ConfirmDialog
				open={replaceOpen}
				title="Replace the Cin7 account?"
				tone="destructive"
				body="This is a different Cin7 account. Replace it and clear all mirrored data?"
				confirmLabel="Replace and clear"
				pending={save.isPending}
				onConfirm={() => attempt(true)}
				onCancel={() => setReplaceOpen(false)}
			/>

			<ConfirmDialog
				open={confirmOpen}
				title="Disconnect Cin7?"
				tone="destructive"
				body="Syncing stops and the saved credentials are deleted. Data already copied stays in place."
				confirmLabel="Disconnect"
				pending={disconnect.isPending}
				error={disconnect.isError ? errorMessage(disconnect.error) : null}
				onConfirm={() =>
					disconnect
						.mutateAsync()
						.then(() => setConfirmOpen(false))
						.catch(() => undefined)
				}
				onCancel={() => {
					disconnect.reset();
					setConfirmOpen(false);
				}}
			/>
		</Card>
	);
}
