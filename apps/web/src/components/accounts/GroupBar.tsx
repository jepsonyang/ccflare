import type { AccountResponse, GroupResponse } from "@ccflare/api";
import { Check, Info, Pencil, Plus, X } from "lucide-react";
import { useState } from "react";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";

const GROUP_NAME_PATTERN = /^[a-zA-Z0-9_]+$/;

interface GroupBarProps {
	groups: GroupResponse[];
	accounts: AccountResponse[] | undefined;
	// Currently selected group name, or null for "All".
	selectedGroup: string | null;
	onSelect: (groupName: string | null) => void;
	onCreate: (name: string) => Promise<unknown>;
	onRename: (group: GroupResponse, newName: string) => Promise<unknown>;
	onDeleteRequest: (group: GroupResponse) => void;
}

/**
 * Compact group bar shown at the top of the Accounts card. Groups double as a
 * single-select filter ("All" clears it). The trailing "+" button creates a
 * group; the pencil button toggles an edit mode in which clicking a chip
 * renames it inline and the × deletes it.
 */
export function GroupBar({
	groups,
	accounts,
	selectedGroup,
	onSelect,
	onCreate,
	onRename,
	onDeleteRequest,
}: GroupBarProps) {
	const [adding, setAdding] = useState(false);
	const [editing, setEditing] = useState(false);
	const [name, setName] = useState("");
	const [busy, setBusy] = useState(false);
	// Inline rename: id of the chip being edited and its working value.
	const [renamingId, setRenamingId] = useState<string | null>(null);
	const [renameValue, setRenameValue] = useState("");

	const cancelRename = () => {
		setRenamingId(null);
		setRenameValue("");
	};

	const startRename = (group: GroupResponse) => {
		setRenamingId(group.id);
		setRenameValue(group.name);
	};

	const commitRename = async (group: GroupResponse) => {
		const trimmed = renameValue.trim();
		if (busy) return;
		// No-op or invalid input silently cancels rather than erroring.
		if (!GROUP_NAME_PATTERN.test(trimmed) || trimmed === group.name) {
			cancelRename();
			return;
		}
		setBusy(true);
		try {
			await onRename(group, trimmed);
			cancelRename();
		} catch {
			// Error surfaced by the page model; keep the field open to retry.
		} finally {
			setBusy(false);
		}
	};

	const countFor = (group: GroupResponse): number => {
		if (!accounts) return 0;
		return accounts.filter((a) => a.groups.includes(group.name)).length;
	};

	const nameValid = GROUP_NAME_PATTERN.test(name.trim());

	const handleCreate = async () => {
		const trimmed = name.trim();
		if (!nameValid || busy) return;
		setBusy(true);
		try {
			await onCreate(trimmed);
			setName("");
			setAdding(false);
		} catch {
			// Error surfaced by the page model.
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="space-y-1.5">
			<div className="flex flex-wrap items-center gap-2">
				<span className="inline-flex items-center gap-1 text-sm text-muted-foreground mr-1">
					Groups:
					<Popover>
						<PopoverTrigger asChild>
							<button
								type="button"
								className="text-muted-foreground/70 hover:text-foreground"
								title="How groups work"
							>
								<Info className="h-3.5 w-3.5" />
							</button>
						</PopoverTrigger>
						<PopoverContent
							align="start"
							className="w-[28rem] max-w-[90vw] text-sm"
						>
							<p className="font-medium">How account groups work</p>
							<p className="mt-1 text-muted-foreground">
								Groups are optional tags. A request carrying a matching{" "}
								<code className="rounded bg-muted px-1 py-0.5 text-xs">
									x-ccflare-group
								</code>{" "}
								header is restricted to that group's accounts. A request without
								the header may use any account.
							</p>
							<p className="mt-2 text-muted-foreground">
								Target multiple groups by pipe-separating names, e.g.{" "}
								<code className="rounded bg-muted px-1 py-0.5 text-xs">
									teamA|teamB
								</code>
								.
							</p>
						</PopoverContent>
					</Popover>
				</span>

				<button
					type="button"
					onClick={() => onSelect(null)}
					className={cn(
						"rounded-full border px-3 py-1 text-sm transition-colors",
						selectedGroup === null
							? "border-primary bg-primary text-primary-foreground"
							: "border-border hover:border-muted-foreground/50",
					)}
				>
					All
				</button>

				{groups.map((group) => {
					const isSelected = selectedGroup === group.name;
					// In edit mode, chips become rename/delete affordances.
					const editable = editing;

					// Inline rename: swap the chip for an input in place.
					if (renamingId === group.id) {
						return (
							<Input
								key={group.id}
								value={renameValue}
								onChange={(e) => setRenameValue(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter") commitRename(group);
									if (e.key === "Escape") cancelRename();
								}}
								onBlur={() => commitRename(group)}
								disabled={busy}
								autoFocus
								className="h-8 w-40"
							/>
						);
					}

					return (
						<div
							key={group.id}
							className={cn(
								"inline-flex items-center rounded-full border text-sm transition-colors",
								editable
									? "border-dashed border-muted-foreground/50"
									: isSelected
										? "border-primary bg-primary text-primary-foreground"
										: "border-border hover:border-muted-foreground/50",
							)}
						>
							<button
								type="button"
								onClick={() =>
									editable ? startRename(group) : onSelect(group.name)
								}
								className="px-3 py-1"
								title={
									editable ? "Rename group" : (group.description ?? undefined)
								}
							>
								{group.name}{" "}
								<span className="opacity-70">{countFor(group)}</span>
							</button>
							{editable && (
								<button
									type="button"
									onClick={() => onDeleteRequest(group)}
									className="pr-2 pl-0.5 py-1 text-muted-foreground hover:text-destructive"
									title="Delete group"
								>
									<X className="h-3.5 w-3.5" />
								</button>
							)}
						</div>
					);
				})}

				{adding ? (
					<div className="inline-flex items-center gap-1">
						<Input
							value={name}
							onChange={(e) => setName(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter") handleCreate();
								if (e.key === "Escape") {
									setAdding(false);
									setName("");
								}
							}}
							placeholder="group_name"
							autoFocus
							className="h-8 w-40"
						/>
						<Button
							size="sm"
							onClick={handleCreate}
							disabled={busy || !nameValid}
						>
							Create
						</Button>
						<Button
							size="sm"
							variant="ghost"
							onClick={() => {
								setAdding(false);
								setName("");
							}}
						>
							<X className="h-4 w-4" />
						</Button>
					</div>
				) : (
					<div className="inline-flex items-center gap-2">
						<Button
							size="icon"
							variant="outline"
							className="h-8 w-8"
							onClick={() => setAdding(true)}
							title="Create group"
						>
							<Plus className="h-4 w-4" />
						</Button>
						<Button
							size="icon"
							variant={editing ? "secondary" : "outline"}
							className="h-8 w-8"
							onClick={() => {
								cancelRename();
								setEditing((v) => !v);
							}}
							title={editing ? "Done editing" : "Edit groups"}
						>
							{editing ? (
								<Check className="h-4 w-4" />
							) : (
								<Pencil className="h-4 w-4" />
							)}
						</Button>
					</div>
				)}
			</div>

			{editing && (
				<p className="text-xs text-muted-foreground">
					Click a group to rename it inline, or × to delete it (members simply
					lose the tag and stay in the shared pool).
				</p>
			)}
		</div>
	);
}
