import type { AccountResponse } from "@ccflare/api";
import { AccountPresenter } from "@ccflare/ui";
import {
	AlertCircle,
	CheckCircle,
	Edit2,
	Layers,
	Pause,
	Play,
	RefreshCw,
	Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "../../lib/utils";
import { ProviderBadge } from "../ProviderBadge";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { AccountGroupChips } from "./AccountGroupChips";
import { RefreshScheduleEditor } from "./RefreshScheduleEditor";
import { UsageWindows } from "./UsageWindows";

function getAuthMethodLabel(authMethod: string): string {
	switch (authMethod) {
		case "oauth":
			return "OAuth";
		case "api_key":
			return "API Key";
		default:
			return authMethod
				.split("_")
				.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
				.join(" ");
	}
}

interface AccountListItemProps {
	account: AccountResponse;
	isActive?: boolean;
	onPauseToggle: (account: AccountResponse) => void;
	onRemove: (account: AccountResponse) => void;
	onRename: (account: AccountResponse) => void;
	onEditGroups: (account: AccountResponse) => void;
	onSelectGroup?: (groupName: string) => void;
	onRefresh: (account: AccountResponse) => Promise<unknown>;
	onSaveSchedule: (
		account: AccountResponse,
		schedule: { enabled: boolean; times: string[] } | null,
	) => Promise<unknown>;
}

// Keep in sync with the server-side REFRESH_MIN_INTERVAL_MS cooldown.
const REFRESH_COOLDOWN_MS = 60_000;

export function AccountListItem({
	account,
	isActive = false,
	onPauseToggle,
	onRemove,
	onRename,
	onEditGroups,
	onSelectGroup,
	onRefresh,
	onSaveSchedule,
}: AccountListItemProps) {
	const presenter = new AccountPresenter(account);

	const isOAuth = account.auth_method === "oauth";
	const [refreshing, setRefreshing] = useState(false);
	const [cooldownUntil, setCooldownUntil] = useState(0);
	const [nowTs, setNowTs] = useState(() => Date.now());

	// While cooling down, tick once a second so the button re-enables on time.
	useEffect(() => {
		if (cooldownUntil <= Date.now()) return;
		const id = setInterval(() => setNowTs(Date.now()), 1000);
		return () => clearInterval(id);
	}, [cooldownUntil]);

	const cooling = nowTs < cooldownUntil;
	const refreshDisabled = refreshing || cooling;

	const handleRefresh = async () => {
		if (refreshDisabled) return;
		setRefreshing(true);
		try {
			const result = (await onRefresh(account)) as
				| { retryAfterMs?: number }
				| undefined;
			setCooldownUntil(
				Date.now() + (result?.retryAfterMs ?? REFRESH_COOLDOWN_MS),
			);
		} catch {
			// Error is surfaced by the page model; allow an immediate retry.
		} finally {
			setRefreshing(false);
			setNowTs(Date.now());
		}
	};

	const refreshTitle = refreshing
		? "Refreshing usage…"
		: cooling
			? `Available in ${Math.ceil((cooldownUntil - nowTs) / 1000)}s`
			: "Refresh usage";

	return (
		<div
			className={`p-4 border rounded-lg transition-colors space-y-4 ${
				isActive
					? "border-primary bg-primary/5 shadow-sm"
					: "border-border hover:border-muted-foreground/50"
			}`}
		>
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-4">
					<div>
						<div className="flex items-center gap-2">
							<p className="font-medium">{account.name}</p>
							{isActive && (
								<span
									className="px-2 py-0.5 text-xs font-medium bg-primary text-primary-foreground rounded-full"
									title="Most recently used account"
								>
									Last used
								</span>
							)}
						</div>
						<div className="mt-1 flex flex-wrap items-center gap-2">
							<ProviderBadge provider={account.provider} />
							<Badge
								variant={
									account.auth_method === "oauth" ? "secondary" : "outline"
								}
							>
								{getAuthMethodLabel(account.auth_method)}
							</Badge>
							<AccountGroupChips
								groups={account.groups}
								onSelect={onSelectGroup}
							/>
						</div>
					</div>
					<div className="flex items-center gap-2">
						{presenter.isRateLimited ? (
							<AlertCircle className="h-4 w-4 text-warning" />
						) : (
							<CheckCircle className="h-4 w-4 text-success" />
						)}
						<span className="text-sm">{presenter.requestCount} requests</span>
						{presenter.isPaused && (
							<span className="text-sm text-muted-foreground">Paused</span>
						)}
						{!presenter.isPaused && (
							<span
								className={`text-sm ${
									presenter.rateLimitSeverity === "critical"
										? "text-destructive"
										: presenter.rateLimitSeverity === "warning"
											? "text-warning"
											: "text-success"
								}`}
							>
								{presenter.rateLimitStatus}
							</span>
						)}
					</div>
				</div>
				<div className="flex items-center gap-2">
					{isOAuth && (
						<RefreshScheduleEditor
							account={account}
							onSave={(schedule) => onSaveSchedule(account, schedule)}
						/>
					)}
					{isOAuth && (
						<Button
							variant="ghost"
							size="sm"
							onClick={handleRefresh}
							disabled={refreshDisabled}
							title={refreshTitle}
						>
							<RefreshCw
								className={cn("h-4 w-4", refreshing && "animate-spin")}
							/>
						</Button>
					)}
					<Button
						variant="ghost"
						size="sm"
						onClick={() => onRename(account)}
						title="Rename account"
					>
						<Edit2 className="h-4 w-4" />
					</Button>
					<Button
						variant="ghost"
						size="sm"
						onClick={() => onEditGroups(account)}
						title="Edit groups"
					>
						<Layers className="h-4 w-4" />
					</Button>
					<Button
						variant="ghost"
						size="sm"
						onClick={() => onPauseToggle(account)}
						title={account.paused ? "Resume account" : "Pause account"}
					>
						{account.paused ? (
							<Play className="h-4 w-4" />
						) : (
							<Pause className="h-4 w-4" />
						)}
					</Button>
					<Button
						variant="ghost"
						size="sm"
						onClick={() => onRemove(account)}
						title="Delete account"
					>
						<Trash2 className="h-4 w-4" />
					</Button>
				</div>
			</div>
			<UsageWindows usageWindows={account.usageWindows} />
		</div>
	);
}
