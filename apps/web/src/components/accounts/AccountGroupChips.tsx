import { Layers } from "lucide-react";
import { Badge } from "../ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";

// Show at most this many group chips inline before collapsing the rest into a
// "+N" popover.
const MAX_INLINE = 3;

interface AccountGroupChipsProps {
	groups: string[];
	// Optional: clicking a group chip can drive the list filter.
	onSelect?: (groupName: string) => void;
}

function GroupChip({
	name,
	onSelect,
}: {
	name: string;
	onSelect?: (groupName: string) => void;
}) {
	return (
		<Badge
			variant="outline"
			className="gap-1 cursor-pointer"
			onClick={onSelect ? () => onSelect(name) : undefined}
		>
			<Layers className="h-3 w-3" />
			{name}
		</Badge>
	);
}

/**
 * Renders an account's group tags as chips. Accounts with no tag render
 * nothing. When an account belongs to more than MAX_INLINE groups, the overflow
 * collapses into a "+N" popover to keep the row compact.
 */
export function AccountGroupChips({
	groups,
	onSelect,
}: AccountGroupChipsProps) {
	if (groups.length === 0) {
		return null;
	}

	if (groups.length <= MAX_INLINE) {
		return (
			<>
				{groups.map((g) => (
					<GroupChip key={g} name={g} onSelect={onSelect} />
				))}
			</>
		);
	}

	const inline = groups.slice(0, MAX_INLINE - 1);
	const overflow = groups.slice(MAX_INLINE - 1);

	return (
		<>
			{inline.map((g) => (
				<GroupChip key={g} name={g} onSelect={onSelect} />
			))}
			<Popover>
				<PopoverTrigger asChild>
					<Badge variant="secondary" className="cursor-pointer">
						+{overflow.length}
					</Badge>
				</PopoverTrigger>
				<PopoverContent align="start" className="w-auto max-w-xs">
					<div className="flex flex-wrap gap-1.5">
						{overflow.map((g) => (
							<GroupChip key={g} name={g} onSelect={onSelect} />
						))}
					</div>
				</PopoverContent>
			</Popover>
		</>
	);
}
