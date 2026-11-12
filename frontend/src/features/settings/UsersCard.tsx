import { useState } from "react";
import { Copy } from "lucide-react";
import Card from "../../components/ui/Card";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import Dropdown from "../../components/ui/Dropdown";
import { HEADER_BTN_PRIMARY, HEADER_BTN_SECONDARY } from "../../components/ui/headerActions";
import { useAuth } from "../../auth/store";
import { useToast } from "../../hooks/useToast";
import { ApiError } from "../../lib/api";
import type { UserRole } from "../../types/user";
import type { UserRow } from "./api";
import { inputClass } from "./ui";
import { useInviteUser, useResetLink, useUpdateUser, useUsers } from "./hooks";

const message = (err: unknown) =>
	err instanceof ApiError ? err.message : "Could not reach the server";

function LinkBox({ title, url, onClose }: { title: string; url: string; onClose: () => void }) {
	const toast = useToast();
	const copy = async () => {
		try {
			await navigator.clipboard.writeText(url);
			toast.success("Link copied");
		} catch {
			toast.error("Couldn't copy. Select the link and copy it by hand.");
		}
	};
	return (
		<div className="mb-4 rounded-md border border-primary-border bg-primary-bg-subtle p-3">
			<p className="mb-1.5 text-sm font-medium">{title}</p>
			<div className="flex gap-2">
				<input
					readOnly
					aria-label={title}
					value={url}
					onFocus={(e) => e.currentTarget.select()}
					className={inputClass}
				/>
				<button type="button" className={HEADER_BTN_PRIMARY} onClick={copy}>
					<Copy size={13} />
					Copy
				</button>
				<button
					type="button"
					className={HEADER_BTN_SECONDARY}
					onClick={onClose}
				>
					Done
				</button>
			</div>
			<p className="mt-1.5 text-xs text-text-muted">
				Anyone with this link can set a password for the account, so send it
				only to that person. It expires.
			</p>
		</div>
	);
}

export default function UsersCard() {
	const { data: users, isLoading, isError, refetch } = useUsers();
	const me = useAuth((s) => s.user);
	const invite = useInviteUser();
	const update = useUpdateUser();
	const reset = useResetLink();
	const toast = useToast();
	const [form, setForm] = useState<{ name: string; email: string; role: UserRole } | null>(
		null
	);
	const [error, setError] = useState<string | null>(null);
	const [link, setLink] = useState<{ title: string; url: string } | null>(null);
	const [deactivating, setDeactivating] = useState<UserRow | null>(null);

	const submitInvite = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!form) return;
		setError(null);
		try {
			const out = await invite.mutateAsync(form);
			setLink({ title: `Invite link for ${form.email}`, url: out.inviteUrl });
			setForm(null);
		} catch (err) {
			setError(message(err));
		}
	};

	const changeRole = (u: UserRow, role: UserRole) =>
		update.mutate({ id: u.id, role }, { onError: (err) => toast.error(message(err)) });

	const showReset = (u: UserRow) =>
		reset.mutate(u.id, {
			onSuccess: (out) =>
				setLink({
					title: `Password reset link for ${u.email}`,
					url: out.resetUrl,
				}),
			onError: (err) => toast.error(message(err)),
		});

	const reactivate = (u: UserRow) =>
		update.mutate(
			{ id: u.id, deactivated: false },
			{ onError: (err) => toast.error(message(err)) }
		);

	return (
		<Card
			title="Users"
			headerAction={
				!form && (
					<button
						type="button"
						className={HEADER_BTN_PRIMARY}
						onClick={() =>
							setForm({
								name: "",
								email: "",
								role: "viewer",
							})
						}
					>
						Invite user
					</button>
				)
			}
		>
			{link && <LinkBox {...link} onClose={() => setLink(null)} />}

			{form && (
				<form
					onSubmit={submitInvite}
					className="mb-4 grid gap-3 rounded-md border border-border-subtle p-3 sm:grid-cols-[1fr_1fr_auto]"
				>
					<label className="text-xs font-medium text-text-secondary">
						Name
						<input
							className={`${inputClass} mt-1`}
							value={form.name}
							onChange={(e) =>
								setForm({
									...form,
									name: e.target.value,
								})
							}
						/>
					</label>
					<label className="text-xs font-medium text-text-secondary">
						Email
						<input
							type="email"
							className={`${inputClass} mt-1`}
							value={form.email}
							onChange={(e) =>
								setForm({
									...form,
									email: e.target.value,
								})
							}
						/>
					</label>
					<label className="text-xs font-medium text-text-secondary">
						Role
						<div className="mt-1">
							<Dropdown
								value={form.role}
								onChange={(role) =>
									setForm({
										...form,
										role: role as UserRole,
									})
								}
								entries={[
									<option
										key="viewer"
										value="viewer"
									>
										Viewer
									</option>,
									<option
										key="admin"
										value="admin"
									>
										Admin
									</option>,
								]}
							/>
						</div>
					</label>
					{error && (
						<p
							role="alert"
							className="text-sm text-error-text sm:col-span-3"
						>
							{error}
						</p>
					)}
					<div className="flex gap-2 sm:col-span-3">
						<button
							type="submit"
							className={HEADER_BTN_PRIMARY}
							disabled={
								invite.isPending ||
								!form.name.trim() ||
								!form.email.trim()
							}
						>
							{invite.isPending
								? "Creating…"
								: "Create invite link"}
						</button>
						<button
							type="button"
							className={HEADER_BTN_SECONDARY}
							onClick={() => {
								setForm(null);
								setError(null);
							}}
						>
							Cancel
						</button>
					</div>
				</form>
			)}

			{isLoading ? (
				<p className="text-sm text-text-muted">Loading…</p>
			) : isError || !users ? (
				<div className="flex items-center gap-3 text-sm text-error-text">
					<span role="alert">Could not load users.</span>
					<button
						type="button"
						className={HEADER_BTN_SECONDARY}
						onClick={() => refetch()}
					>
						Try again
					</button>
				</div>
			) : (
				<ul className="divide-y divide-border-subtle">
					{users.map((u) => (
						<li
							key={u.id}
							className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5"
						>
							<div className="min-w-0 flex-1 basis-48">
								<p
									className={`truncate text-sm font-medium ${u.deactivated ? "text-text-muted line-through" : "text-text-primary"}`}
								>
									{u.name}
									{u.id === me?.id && (
										<span className="ml-1.5 text-xs font-normal text-text-muted no-underline">
											(you)
										</span>
									)}
								</p>
								<p className="truncate text-xs text-text-muted">
									{u.email}
									{u.pendingInvite &&
										" · invite pending"}
									{u.deactivated &&
										" · deactivated"}
								</p>
							</div>
							<div className="w-28">
								<Dropdown
									aria-label={`Role for ${u.email}`}
									value={u.role}
									disabled={
										u.deactivated ||
										update.isPending
									}
									onChange={(role) =>
										changeRole(
											u,
											role as UserRole
										)
									}
									entries={[
										<option
											key="viewer"
											value="viewer"
										>
											Viewer
										</option>,
										<option
											key="admin"
											value="admin"
										>
											Admin
										</option>,
									]}
								/>
							</div>
							<div className="flex gap-2">
								<button
									type="button"
									className={
										HEADER_BTN_SECONDARY
									}
									disabled={
										u.deactivated ||
										reset.isPending
									}
									onClick={() => showReset(u)}
								>
									{u.pendingInvite
										? "New invite link"
										: "Reset link"}
								</button>
								{u.deactivated ? (
									<button
										type="button"
										className={
											HEADER_BTN_SECONDARY
										}
										onClick={() =>
											reactivate(
												u
											)
										}
									>
										Reactivate
									</button>
								) : (
									<button
										type="button"
										className={
											HEADER_BTN_SECONDARY
										}
										onClick={() =>
											setDeactivating(
												u
											)
										}
									>
										Deactivate
									</button>
								)}
							</div>
						</li>
					))}
				</ul>
			)}

			<ConfirmDialog
				open={deactivating !== null}
				title="Deactivate this user?"
				tone="destructive"
				body={`${deactivating?.email ?? ""} will be signed out and unable to sign in. You can reactivate them later.`}
				confirmLabel="Deactivate"
				pending={update.isPending}
				error={update.isError ? message(update.error) : null}
				onConfirm={async () => {
					if (!deactivating) return;
					const ok = await update
						.mutateAsync({
							id: deactivating.id,
							deactivated: true,
						})
						.then(() => true)
						.catch(() => false);
					if (ok) setDeactivating(null);
				}}
				onCancel={() => {
					update.reset();
					setDeactivating(null);
				}}
			/>
		</Card>
	);
}
