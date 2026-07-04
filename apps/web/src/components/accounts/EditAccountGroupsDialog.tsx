import type { AccountResponse, GroupResponse } from "@ccflare/api";
import { Check } from "lucide-react";
import { useState } from "react";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "../ui/dialog";

interface EditAccountGroupsDialogProps {
	isOpen: boolean;
	account: AccountResponse;
	groups: GroupResponse[];
	onClose: () => void;
	// Persist the selected group ids as the account's membership.
	onSave: (groupIds: string[]) => Promise<unknown>;
}

/**
 * Toggle which groups an account belongs to. Selection is by group id;
 * the account's current membership (by group name) seeds the initial state.
 */
export function EditAccountGroupsDialog({
	isOpen,
	account,
	groups,
	onClose,
	onSave,
}: EditAccountGroupsDialogProps) {
	// The synthetic default group is derived (no explicit membership), so it is
	// never a selectable toggle here.
	const selectableGroups = groups.filter((g) => !g.system);
	const initialSelected = new Set(
		selectableGroups
			.filter((g) => account.groups.includes(g.name))
			.map((g) => g.id),
	);
	const [selected, setSelected] = useState<Set<string>>(initialSelected);
	const [saving, setSaving] = useState(false);

	const toggle = (groupId: string) => {
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(groupId)) {
				next.delete(groupId);
			} else {
				next.add(groupId);
			}
			return next;
		});
	};

	const handleSave = async () => {
		setSaving(true);
		try {
			await onSave([...selected]);
			onClose();
		} catch {
			// Error surfaced by the page model.
		} finally {
			setSaving(false);
		}
	};

	return (
		<Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Groups for "{account.name}"</DialogTitle>
					<DialogDescription>
						Accounts in one or more groups leave the default pool and only serve
						requests carrying a matching <code>x-ccflare-group</code> header.
					</DialogDescription>
				</DialogHeader>
				<div className="flex flex-wrap gap-2 py-4">
					{selectableGroups.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							No groups defined yet. Create one first.
						</p>
					) : (
						selectableGroups.map((group) => {
							const isSelected = selected.has(group.id);
							return (
								<button
									key={group.id}
									type="button"
									onClick={() => toggle(group.id)}
									className={cn(
										"inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm transition-colors",
										isSelected
											? "border-primary bg-primary text-primary-foreground"
											: "border-border hover:border-muted-foreground/50",
									)}
								>
									{isSelected && <Check className="h-3 w-3" />}
									{group.name}
								</button>
							);
						})
					)}
				</div>
				<DialogFooter>
					<Button
						type="button"
						variant="outline"
						onClick={onClose}
						disabled={saving}
					>
						Cancel
					</Button>
					<Button type="button" onClick={handleSave} disabled={saving}>
						{saving ? "Saving..." : "Save"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
