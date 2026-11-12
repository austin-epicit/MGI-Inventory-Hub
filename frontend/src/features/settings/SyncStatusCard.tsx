import { useState } from "react";
import Card from "../../components/ui/Card";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import { HEADER_BTN_PRIMARY, HEADER_BTN_SECONDARY } from "../../components/ui/headerActions";
import StatCard from "../../components/ui/StatCard";
import { useToast } from "../../hooks/useToast";
import { ApiError } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import { ago } from "../../layout/freshness";
import type { RemapEntity, SyncKind } from "./api";
import { useRemap, useRunSync, useSyncStatus } from "./hooks";

const ENTITY_LABEL: Record<string, string> = {
	suppliers: "Suppliers",
	customers: "Customers",
	products: "Products",
	purchases: "Purchase orders",
	sales: "Sales orders",
};

const REMAPS: { entity: RemapEntity; label: string }[] = [
	{ entity: "product", label: "Products" },
	{ entity: "purchase", label: "Purchase orders" },
	{ entity: "sale", label: "Sales orders" },
];

const message = (err: unknown) =>
	err instanceof ApiError ? err.message : "Could not reach the server";

export default function SyncStatusCard() {
	const { data, isLoading, isError, refetch } = useSyncStatus();
	const run = useRunSync();
	const remap = useRemap();
	const toast = useToast();
	const [pendingRemap, setPendingRemap] = useState<RemapEntity | null>(null);

	const start = (kind: SyncKind) =>
		run.mutate(kind, {
			onSuccess: () => toast.info("Sync started"),
			onError: (err) => toast.error(message(err)),
		});

	if (isLoading) {
		return (
			<Card title="Sync status">
				<p className="text-sm text-text-muted">Loading…</p>
			</Card>
		);
	}
	if (isError || !data) {
		return (
			<Card title="Sync status">
				<div className="flex items-center gap-3 text-sm text-error-text">
					<span role="alert">Could not load the sync status.</span>
					<button
						type="button"
						className={HEADER_BTN_SECONDARY}
						onClick={() => refetch()}
					>
						Try again
					</button>
				</div>
			</Card>
		);
	}

	const last = data.lastRun;
	const busy = data.running || run.isPending;
	const canSync = data.connected && !busy;
	const now = Date.now();

	return (
		<Card
			title="Sync status"
			headerAction={
				<div className="flex gap-2">
					<button
						type="button"
						className={HEADER_BTN_SECONDARY}
						disabled={!canSync}
						onClick={() => start("reconcile")}
					>
						Full re-check
					</button>
					<button
						type="button"
						className={HEADER_BTN_PRIMARY}
						disabled={!canSync}
						onClick={() => start("incremental")}
					>
						{busy ? "Syncing…" : "Sync now"}
					</button>
				</div>
			}
		>
			<div className="space-y-4">
				<div className="grid gap-3 sm:grid-cols-3">
					<StatCard
						label="Last successful sync"
						value={
							data.lastSuccessAt
								? ago(data.lastSuccessAt, now)
								: "Never"
						}
						hint={
							data.lastSuccessAt
								? formatDateTime(data.lastSuccessAt)
								: undefined
						}
					/>
					<StatCard
						label="Last run"
						value={
							data.running
								? "Running"
								: last
									? last.status === "ok"
										? "OK"
										: last.status ===
											  "partial"
											? "Partial"
											: "Failed"
									: "None yet"
						}
						tone={
							!data.running && last?.status === "failed"
								? "error"
								: !data.running &&
									  last?.status === "partial"
									? "warning"
									: undefined
						}
						hint={
							last?.status === "failed"
								? (last.errorMessage ??
									last.errorCode ??
									undefined)
								: last?.finishedAt
									? formatDateTime(
											last.finishedAt
										)
									: undefined
						}
					/>
					<StatCard
						label="Initial load"
						value={
							data.backfill.done
								? "Done"
								: `${data.backfill.progressPct}%`
						}
						hint={
							data.backfill.done
								? undefined
								: "The first sync copies the history; it can take a while."
						}
					/>
				</div>

				<table className="w-full text-sm">
					<thead>
						<tr className="text-left text-xs uppercase tracking-wide text-text-muted">
							<th className="py-1 font-semibold">Data</th>
							<th className="py-1 font-semibold">
								Last synced
							</th>
						</tr>
					</thead>
					<tbody>
						{data.perEntity.map((e) => (
							<tr
								key={e.entity}
								className="border-t border-border-subtle"
							>
								<td className="py-1.5">
									{ENTITY_LABEL[e.entity] ??
										e.entity}
								</td>
								<td className="py-1.5 text-text-muted">
									{e.lastSuccessAt
										? formatDateTime(
												e.lastSuccessAt
											)
										: e.backfillDone
											? "Up to date"
											: "Waiting for the first sync"}
								</td>
							</tr>
						))}
					</tbody>
				</table>

				{data.quarantined.count > 0 && (
					<div>
						<h4 className="mb-1 text-sm font-semibold text-warning-text">
							{data.quarantined.count} record
							{data.quarantined.count === 1
								? ""
								: "s"}{" "}
							skipped after repeated failures
						</h4>
						<p className="mb-2 text-xs text-text-muted">
							These no longer block syncing. Each is
							retried whenever Cin7 reports it changed.
							{data.quarantined.count >
								data.quarantined.items.length &&
								` Showing the ${data.quarantined.items.length} most recent.`}
						</p>
						<ul className="divide-y divide-border-subtle rounded-md border border-border-subtle text-xs">
							{data.quarantined.items.map((q) => (
								<li
									key={`${q.entity}:${q.recordId}`}
									className="flex flex-wrap gap-x-3 gap-y-0.5 px-3 py-1.5"
								>
									<span className="font-medium text-text-primary">
										{ENTITY_LABEL[
											q.entity
										] ?? q.entity}
									</span>
									<span className="font-mono text-text-muted">
										{q.recordId}
									</span>
									<span className="text-text-muted">
										{q.attempts}{" "}
										attempts ·{" "}
										{q.lastCode}
									</span>
									<span className="min-w-0 flex-1 truncate text-text-tertiary">
										{q.lastMessage}
									</span>
								</li>
							))}
						</ul>
					</div>
				)}

				<div>
					<h4 className="mb-1 text-sm font-semibold">
						Rebuild from stored data
					</h4>
					<p className="mb-2 text-xs text-text-muted">
						Re-derives the figures from what was already copied,
						with no Cin7 calls. Use it after a fix to how data
						is read.
					</p>
					<div className="flex flex-wrap gap-2">
						{REMAPS.map((r) => (
							<button
								key={r.entity}
								type="button"
								className={HEADER_BTN_SECONDARY}
								disabled={busy}
								onClick={() =>
									setPendingRemap(r.entity)
								}
							>
								{r.label}
							</button>
						))}
					</div>
				</div>
			</div>

			<ConfirmDialog
				open={pendingRemap !== null}
				title="Rebuild from stored data?"
				body="This re-reads every stored record of this kind. It makes no Cin7 calls and blocks other syncs until it finishes."
				confirmLabel="Rebuild"
				pending={remap.isPending}
				error={remap.isError ? message(remap.error) : null}
				onConfirm={async () => {
					if (!pendingRemap) return;
					const out = await remap
						.mutateAsync(pendingRemap)
						.catch(() => null);
					if (!out) return;
					toast.success(
						`Rebuilt ${out.remapped} records` +
							(out.skipped
								? `, skipped ${out.skipped} unreadable`
								: "")
					);
					setPendingRemap(null);
				}}
				onCancel={() => {
					remap.reset();
					setPendingRemap(null);
				}}
			/>
		</Card>
	);
}
