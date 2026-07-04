import type { AccountResponse } from "@ccflare/api";
import { AlarmClock, AlarmClockCheck, Clock, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useHealth } from "../../hooks/queries";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Switch } from "../ui/switch";

// Keep in sync with MAX_REFRESH_SCHEDULE_TIMES in @ccflare/types.
const MAX_TIMES = 5;
// "Add time" seeds the next entry this far after the last one (5h05m), a handy
// default that keeps refreshes spread across the day.
const ADD_STEP_MINUTES = 5 * 60 + 5;
const MINUTES_PER_DAY = 24 * 60;

const HHMM_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function isValidHhMm(value: string): boolean {
	return HHMM_PATTERN.test(value);
}

function hhmmToMinutes(value: string): number {
	const [h, m] = value.split(":").map(Number);
	return h * 60 + m;
}

function minutesToHhMm(total: number): string {
	const wrapped =
		((total % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
	const h = String(Math.floor(wrapped / 60)).padStart(2, "0");
	const m = String(wrapped % 60).padStart(2, "0");
	return `${h}:${m}`;
}

function sortedTimes(times: string[]): string[] {
	return [...times].sort();
}

/**
 * Zero-pad a loosely-typed "H:M" into "HH:MM" so manual entry like "7:0"
 * becomes "07:00". Leaves anything that isn't digits:digits untouched.
 */
function normalizeTimeInput(value: string): string {
	const match = value.trim().match(/^(\d{1,2}):(\d{1,2})$/);
	if (!match) return value;
	return `${match[1].padStart(2, "0")}:${match[2].padStart(2, "0")}`;
}

/** Format a UTC offset in minutes as "UTC+8" / "UTC-3:30". */
function formatUtcOffset(minutes: number): string {
	const sign = minutes < 0 ? "-" : "+";
	const abs = Math.abs(minutes);
	const h = Math.floor(abs / 60);
	const m = abs % 60;
	return `UTC${sign}${h}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
}

interface RefreshScheduleEditorProps {
	account: AccountResponse;
	onSave: (
		schedule: { enabled: boolean; times: string[] } | null,
	) => Promise<unknown>;
}

export function RefreshScheduleEditor({
	account,
	onSave,
}: RefreshScheduleEditorProps) {
	const [open, setOpen] = useState(false);
	const [enabled, setEnabled] = useState(false);
	const [times, setTimes] = useState<string[]>([]);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const { data: health } = useHealth();

	const timezoneLabel = health
		? `${health.timezone} (${formatUtcOffset(health.utcOffsetMinutes)})`
		: "server local time";

	const configuredCount = account.refreshSchedule?.times.length ?? 0;
	const isConfigured = configuredCount > 0;
	const isEnabledConfigured =
		account.refreshSchedule?.enabled === true && isConfigured;

	// A "configured" alarm swaps to the check variant; the numeric count moves
	// into the tooltip so the trigger reads as a state, not a notification badge.
	const TriggerIcon = isConfigured ? AlarmClockCheck : AlarmClock;
	const triggerTitle = isConfigured
		? `Scheduled refresh · ${configuredCount} time${
				configuredCount === 1 ? "" : "s"
			}${isEnabledConfigured ? "" : " (paused)"}`
		: "Scheduled refresh";

	// Seed the draft from the account each time the popover opens so cancel/reopen
	// always starts from the persisted state.
	const handleOpenChange = (next: boolean) => {
		if (next) {
			setEnabled(account.refreshSchedule?.enabled ?? false);
			setTimes(account.refreshSchedule?.times ?? []);
			setError(null);
		}
		setOpen(next);
	};

	const updateTime = (index: number, value: string) => {
		setTimes((prev) => prev.map((t, i) => (i === index ? value : t)));
	};

	const removeTime = (index: number) => {
		setTimes((prev) => prev.filter((_, i) => i !== index));
	};

	const addTime = () => {
		setTimes((prev) => {
			if (prev.length === 0) return ["07:00"];
			const sorted = sortedTimes(prev);
			const last = sorted[sorted.length - 1];
			const next = isValidHhMm(last)
				? minutesToHhMm(hhmmToMinutes(last) + ADD_STEP_MINUTES)
				: "07:00";
			return [...prev, next];
		});
	};

	const invalidFormat = times.some((t) => !isValidHhMm(t));
	const hasDuplicates = new Set(times).size !== times.length;
	const canSave = !saving && !invalidFormat && !hasDuplicates;

	const handleSave = async () => {
		if (!canSave) return;
		setSaving(true);
		setError(null);
		try {
			const normalized = sortedTimes(times);
			await onSave(
				normalized.length === 0 ? null : { enabled, times: normalized },
			);
			setOpen(false);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to save schedule");
		} finally {
			setSaving(false);
		}
	};

	const display = times.map((value, index) => ({ value, index }));
	// Show rows in chronological order without losing the edit index.
	display.sort((a, b) => a.value.localeCompare(b.value));

	const seen = new Set<string>();
	const duplicateValues = new Set<string>();
	for (const t of times) {
		if (seen.has(t)) duplicateValues.add(t);
		seen.add(t);
	}

	return (
		<Popover open={open} onOpenChange={handleOpenChange}>
			<PopoverTrigger asChild>
				<Button variant="ghost" size="sm" title={triggerTitle}>
					<TriggerIcon
						className={cn(
							"h-4 w-4",
							isEnabledConfigured && "text-primary",
							isConfigured && !isEnabledConfigured && "text-muted-foreground",
						)}
					/>
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-72 space-y-3">
				<div className="flex items-start justify-between gap-2">
					<div>
						<p className="text-sm font-medium">Scheduled Refresh</p>
						<p className="text-xs text-muted-foreground">
							Automatically refresh usage windows at the times below.
						</p>
					</div>
					<Switch checked={enabled} onCheckedChange={setEnabled} />
				</div>

				<div
					className={cn(
						"space-y-2",
						!enabled && "pointer-events-none opacity-50",
					)}
				>
					{display.length === 0 ? (
						<p className="text-xs text-muted-foreground">
							No scheduled times yet.
						</p>
					) : (
						display.map(({ value, index }) => {
							const invalid = value !== "" && !isValidHhMm(value);
							const duplicate = duplicateValues.has(value);
							return (
								<div key={index} className="flex items-center gap-2">
									<Input
										type="text"
										inputMode="numeric"
										placeholder="HH:MM"
										maxLength={5}
										value={value}
										onChange={(e) => updateTime(index, e.target.value)}
										onBlur={(e) =>
											updateTime(index, normalizeTimeInput(e.target.value))
										}
										className={cn(
											"h-8 tabular-nums",
											(invalid || duplicate) && "border-destructive",
										)}
									/>
									<Button
										variant="ghost"
										size="sm"
										className="h-8 w-8 p-0"
										onClick={() => removeTime(index)}
										title="Remove time"
									>
										<Trash2 className="h-4 w-4" />
									</Button>
								</div>
							);
						})
					)}

					<Button
						variant="outline"
						size="sm"
						className="w-full"
						onClick={addTime}
						disabled={times.length >= MAX_TIMES}
					>
						<Plus className="mr-1 h-4 w-4" />
						Add time
					</Button>
				</div>

				<div className="space-y-1">
					{hasDuplicates && (
						<p className="text-xs text-destructive">Duplicate time</p>
					)}
					{error && <p className="text-xs text-destructive">{error}</p>}
					<div
						className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
						title="Scheduled times run in the server's timezone"
					>
						<Clock className="h-3 w-3 shrink-0" />
						<span>{timezoneLabel}</span>
					</div>
				</div>

				<div className="flex justify-end gap-2">
					<Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
						Cancel
					</Button>
					<Button size="sm" onClick={handleSave} disabled={!canSave}>
						{saving ? "Saving…" : "Save"}
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	);
}
