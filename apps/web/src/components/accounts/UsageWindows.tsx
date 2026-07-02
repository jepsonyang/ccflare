import type { AccountResponse } from "@ccflare/api";
import { useEffect, useState } from "react";
import { cn } from "../../lib/utils";

type UsageWindow = AccountResponse["usageWindows"]["fiveHour"];

interface UsageWindowsProps {
	usageWindows: AccountResponse["usageWindows"];
	className?: string;
}

/** Wall-clock time in the viewer's local zone, e.g. "02:11 AM". */
function formatClockTime(date: Date): string {
	return date.toLocaleTimeString("en-US", {
		hour: "2-digit",
		minute: "2-digit",
		hour12: true,
	});
}

/**
 * Local date with an English abbreviated weekday, e.g. "2026-07-09 Thu".
 * The weekday is always English (en-US) for a consistent look; only the
 * calendar values come from the viewer's local zone.
 */
function formatLocalDate(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	const weekday = date.toLocaleDateString("en-US", { weekday: "short" });
	return `${year}-${month}-${day} ${weekday}`;
}

/**
 * Format the remaining time until a reset timestamp, followed by the
 * absolute reset time in the viewer's local zone. When `withDate` is set
 * (weekly window) the absolute time also includes the date and weekday.
 */
function formatResetCountdown(
	resetIso: string | null,
	now: number,
	withDate: boolean,
): string {
	if (!resetIso) return "";
	const reset = new Date(resetIso);
	const remainingMs = reset.getTime() - now;
	if (remainingMs <= 0) return "Resets shortly";

	const totalMinutes = Math.ceil(remainingMs / 60000);
	const days = Math.floor(totalMinutes / (60 * 24));
	const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
	const minutes = totalMinutes % 60;

	let relative: string;
	if (days > 0) relative = `${days}d ${hours}h`;
	else if (hours > 0) relative = `${hours}h ${minutes}m`;
	else relative = `${minutes}m`;

	const absolute = withDate
		? `${formatLocalDate(reset)} ${formatClockTime(reset)}`
		: formatClockTime(reset);

	return `Resets in ${relative} (at ${absolute})`;
}

/**
 * Bar fill color by utilization: <70% green, 70-90% yellow, >90% red.
 * Returns a CSS variable for a solid fill (the `.bg-*` utilities in this
 * app are faint 15%-opacity badge backgrounds, unsuitable for a bar).
 */
function utilizationColor(utilization: number): string {
	if (utilization >= 90) return "var(--destructive)";
	if (utilization >= 70) return "var(--warning)";
	return "var(--success)";
}

function UsageBar({
	label,
	window,
	now,
	withDate = false,
	emptyText = "No usage data yet",
}: {
	label: string;
	window: UsageWindow;
	now: number;
	withDate?: boolean;
	emptyText?: string;
}) {
	const { utilization, resetAt, isRepresentative } = window;

	if (utilization == null) {
		return (
			<div className="space-y-1 rounded-md bg-success/7 p-2">
				<span className="text-xs text-muted-foreground">{label}</span>
				<p className="text-xs text-muted-foreground/70">{emptyText}</p>
			</div>
		);
	}

	const pct = Math.min(100, Math.max(0, utilization));
	const countdown = formatResetCountdown(resetAt, now, withDate);

	return (
		<div
			className={cn(
				"space-y-1.5 rounded-md p-2",
				isRepresentative ? "bg-destructive/7" : "bg-success/7",
			)}
		>
			<div className="flex items-center justify-between">
				<span className="flex items-center gap-1.5 text-xs text-muted-foreground">
					{label}
					{isRepresentative && (
						<span
							className="flex items-center gap-1"
							style={{ color: utilizationColor(pct) }}
						>
							<span
								className="h-1.5 w-1.5 rounded-full"
								style={{ backgroundColor: utilizationColor(pct) }}
							/>
							limiting
						</span>
					)}
				</span>
				<span className="text-xs font-medium">{pct.toFixed(0)}% used</span>
			</div>
			<div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
				<div
					className="h-full rounded-full transition-all duration-700 ease-out"
					style={{
						width: `${pct}%`,
						backgroundColor: utilizationColor(pct),
					}}
				/>
			</div>
			{countdown && (
				<span className="text-xs text-muted-foreground">{countdown}</span>
			)}
		</div>
	);
}

export function UsageWindows({ usageWindows, className }: UsageWindowsProps) {
	const [now, setNow] = useState(Date.now());

	useEffect(() => {
		const interval = setInterval(() => setNow(Date.now()), 10000);
		return () => clearInterval(interval);
	}, []);

	const hasAnyData =
		usageWindows.fiveHour.utilization != null ||
		usageWindows.sevenDay.utilization != null;

	return (
		<div className={cn("space-y-3", className)}>
			{hasAnyData ? (
				<>
					<UsageBar
						label="Current session"
						window={usageWindows.fiveHour}
						now={now}
					/>
					<UsageBar
						label="Weekly · All models"
						window={usageWindows.sevenDay}
						now={now}
						withDate
					/>
					<UsageBar
						label="Weekly · Fable"
						window={usageWindows.fable}
						now={now}
						withDate
						emptyText="You haven't used Fable yet"
					/>
				</>
			) : (
				<p className="text-xs text-muted-foreground/70">
					No usage data yet · shown after the first request
				</p>
			)}
		</div>
	);
}
