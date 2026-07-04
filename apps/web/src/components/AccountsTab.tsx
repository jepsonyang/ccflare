import type { AccountResponse, GroupResponse } from "@ccflare/api";
import { AlertCircle, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useAccountsPageModel } from "../hooks/useAccountsPageModel";
import {
	AccountAddForm,
	AccountList,
	DeleteConfirmationDialog,
	EditAccountGroupsDialog,
	GroupBar,
	RenameAccountDialog,
} from "./accounts";
import { Button } from "./ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "./ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "./ui/dialog";

export function AccountsTab() {
	const model = useAccountsPageModel();

	const [adding, setAdding] = useState(false);
	const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
	const [confirmDelete, setConfirmDelete] = useState<{
		show: boolean;
		accountId: string;
		accountName: string;
		confirmInput: string;
	}>({
		show: false,
		accountId: "",
		accountName: "",
		confirmInput: "",
	});
	const [renameDialog, setRenameDialog] = useState<{
		isOpen: boolean;
		account: AccountResponse | null;
	}>({
		isOpen: false,
		account: null,
	});
	const [groupsDialog, setGroupsDialog] = useState<{
		isOpen: boolean;
		account: AccountResponse | null;
	}>({
		isOpen: false,
		account: null,
	});
	const [deleteGroupConfirm, setDeleteGroupConfirm] = useState<{
		isOpen: boolean;
		group: GroupResponse | null;
	}>({
		isOpen: false,
		group: null,
	});

	const allAccounts = useMemo(() => model.accounts ?? [], [model.accounts]);

	// Single-select group filter. "default" (the system group) matches accounts
	// with no explicit membership; a named group matches by inclusion.
	const filteredAccounts = useMemo(() => {
		if (selectedGroup === null) return allAccounts;
		if (selectedGroup === "default") {
			return allAccounts.filter((a) => a.groups.length === 0);
		}
		return allAccounts.filter((a) => a.groups.includes(selectedGroup));
	}, [allAccounts, selectedGroup]);

	const handleRemoveAccount = (account: AccountResponse) => {
		setConfirmDelete({
			show: true,
			accountId: account.id,
			accountName: account.name,
			confirmInput: "",
		});
	};

	const handleConfirmDelete = async () => {
		if (confirmDelete.confirmInput !== confirmDelete.accountName) {
			return;
		}
		await model.removeAccount(confirmDelete.accountId);
		setConfirmDelete({
			show: false,
			accountId: "",
			accountName: "",
			confirmInput: "",
		});
	};

	const handleConfirmRename = async (newName: string) => {
		if (!renameDialog.account) return;
		await model.renameAccount(renameDialog.account.id, newName);
		setRenameDialog({ isOpen: false, account: null });
	};

	const handleRenameGroup = async (group: GroupResponse, newName: string) => {
		await model.renameGroup(group.id, newName);
		if (selectedGroup === group.name) setSelectedGroup(newName);
	};

	const handleConfirmDeleteGroup = async () => {
		const group = deleteGroupConfirm.group;
		if (!group) return;
		await model.deleteGroup(group.id);
		if (selectedGroup === group.name) setSelectedGroup(null);
		setDeleteGroupConfirm({ isOpen: false, group: null });
	};

	if (model.loading) {
		return (
			<Card>
				<CardContent className="pt-6">
					<p className="text-muted-foreground">Loading accounts...</p>
				</CardContent>
			</Card>
		);
	}

	return (
		<div className="space-y-4">
			{model.error && (
				<Card className="border-destructive">
					<CardContent className="pt-6">
						<div className="flex items-center gap-2">
							<AlertCircle className="h-4 w-4 text-destructive" />
							<p className="text-destructive">{model.error}</p>
						</div>
					</CardContent>
				</Card>
			)}

			<Card>
				<CardHeader>
					<div className="flex items-center justify-between">
						<div>
							<CardTitle>Accounts</CardTitle>
							<CardDescription>
								Manage provider accounts and their group assignments
							</CardDescription>
						</div>
						{!adding && (
							<Button onClick={() => setAdding(true)} size="sm">
								<Plus className="mr-2 h-4 w-4" />
								Add Account
							</Button>
						)}
					</div>
				</CardHeader>
				<CardContent className="space-y-4">
					<GroupBar
						groups={model.groups}
						accounts={allAccounts}
						selectedGroup={selectedGroup}
						onSelect={setSelectedGroup}
						onCreate={(name) => model.createGroup({ name })}
						onRename={handleRenameGroup}
						onDeleteRequest={(group) =>
							setDeleteGroupConfirm({ isOpen: true, group })
						}
					/>

					{adding && (
						<AccountAddForm
							onCreateApiKeyAccount={async (params) => {
								await model.createApiKeyAccount(params);
								setAdding(false);
							}}
							onStartOAuth={model.startOAuth}
							onCompleteOAuth={model.completeOAuth}
							onGetSessionStatus={model.getSessionStatus}
							onOAuthCompleted={model.onOAuthCompleted}
							onCancel={() => {
								setAdding(false);
								model.clearError();
							}}
							onSuccess={() => {
								setAdding(false);
							}}
							onError={() => {}}
						/>
					)}

					{selectedGroup !== null && (
						<p className="text-sm text-muted-foreground">
							Filtered by <span className="font-medium">{selectedGroup}</span> ·
							showing {filteredAccounts.length} / {allAccounts.length}
						</p>
					)}

					<AccountList
						accounts={filteredAccounts}
						onPauseToggle={(account) => model.togglePause(account)}
						onRemove={handleRemoveAccount}
						onRename={(account) => setRenameDialog({ isOpen: true, account })}
						onEditGroups={(account) =>
							setGroupsDialog({ isOpen: true, account })
						}
						onSelectGroup={setSelectedGroup}
						onRefresh={(account) => model.refreshAccount(account.id)}
						onSaveSchedule={(account, schedule) =>
							model.updateRefreshSchedule(account.id, schedule)
						}
					/>
				</CardContent>
			</Card>

			{confirmDelete.show && (
				<DeleteConfirmationDialog
					accountName={confirmDelete.accountName}
					confirmInput={confirmDelete.confirmInput}
					onConfirmInputChange={(value) =>
						setConfirmDelete({
							...confirmDelete,
							confirmInput: value,
						})
					}
					onConfirm={handleConfirmDelete}
					onCancel={() => {
						setConfirmDelete({
							show: false,
							accountId: "",
							accountName: "",
							confirmInput: "",
						});
						model.clearError();
					}}
				/>
			)}

			{renameDialog.isOpen && renameDialog.account && (
				<RenameAccountDialog
					isOpen={renameDialog.isOpen}
					currentName={renameDialog.account.name}
					onClose={() => setRenameDialog({ isOpen: false, account: null })}
					onRename={handleConfirmRename}
					isLoading={model.isRenaming}
				/>
			)}

			{groupsDialog.isOpen && groupsDialog.account && (
				<EditAccountGroupsDialog
					isOpen={groupsDialog.isOpen}
					account={groupsDialog.account}
					groups={model.groups}
					onClose={() => setGroupsDialog({ isOpen: false, account: null })}
					onSave={(groupIds) =>
						model.setAccountGroups(
							(groupsDialog.account as AccountResponse).id,
							groupIds,
						)
					}
				/>
			)}

			{deleteGroupConfirm.isOpen && deleteGroupConfirm.group && (
				<Dialog
					open={deleteGroupConfirm.isOpen}
					onOpenChange={(open) =>
						!open && setDeleteGroupConfirm({ isOpen: false, group: null })
					}
				>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>
								Delete group "{deleteGroupConfirm.group.name}"?
							</DialogTitle>
							<DialogDescription>
								Member accounts leave this group; those left in no other group
								return to the default pool. This does not delete any account.
							</DialogDescription>
						</DialogHeader>
						<DialogFooter>
							<Button
								variant="outline"
								onClick={() =>
									setDeleteGroupConfirm({ isOpen: false, group: null })
								}
							>
								Cancel
							</Button>
							<Button variant="destructive" onClick={handleConfirmDeleteGroup}>
								Delete
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			)}
		</div>
	);
}
