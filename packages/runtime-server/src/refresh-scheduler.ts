import { refreshAccountUsage } from "@ccflare/api";
import type { Config } from "@ccflare/config";
import type { DatabaseOperations } from "@ccflare/database";
import type { Logger } from "@ccflare/logger";
import { shouldFireRefresh } from "@ccflare/types";

const MINUTE_MS = 60_000;

/** Current local wall-clock time formatted as "HH:MM". */
function localHhMm(now: Date): string {
	const hh = String(now.getHours()).padStart(2, "0");
	const mm = String(now.getMinutes()).padStart(2, "0");
	return `${hh}:${mm}`;
}

/**
 * Run one scheduler tick: fire an on-demand usage refresh for every account
 * whose schedule names the current local minute. Accounts are processed
 * serially and independently — one failure only logs and never blocks the rest.
 * Scheduled refreshes intentionally bypass the manual-refresh cooldown.
 */
async function runTick(
	dbOps: DatabaseOperations,
	config: Config,
	log: Logger,
	now: Date = new Date(),
): Promise<void> {
	const hhmm = localHhMm(now);
	for (const account of dbOps.getAllAccounts()) {
		if (!shouldFireRefresh(account.refresh_schedule, hhmm)) continue;
		try {
			const result = await refreshAccountUsage(account, dbOps, config);
			if (result.ok) {
				log.info(
					`Scheduled refresh for account ${account.name} at ${hhmm} succeeded`,
				);
			} else {
				log.warn(
					`Scheduled refresh for account ${account.name} at ${hhmm} failed: ${result.message}`,
				);
			}
		} catch (err) {
			log.error(`Scheduled refresh error for account ${account.name}: ${err}`);
		}
	}
}

/**
 * Start the per-account usage-refresh scheduler. Ticks once per minute, aligned
 * to the wall-clock minute boundary so a schedule entry like "05:00" fires at
 * the top of that minute. Returns a stop function that cancels the scheduler.
 */
export function startRefreshScheduler(
	dbOps: DatabaseOperations,
	config: Config,
	log: Logger,
): () => void {
	let interval: ReturnType<typeof setInterval> | null = null;
	let alignTimeout: ReturnType<typeof setTimeout> | null = null;

	const tick = () => {
		void runTick(dbOps, config, log).catch((err) =>
			log.error(`Refresh scheduler tick error: ${err}`),
		);
	};

	const msToNextMinute = MINUTE_MS - (Date.now() % MINUTE_MS);
	alignTimeout = setTimeout(() => {
		alignTimeout = null;
		tick();
		interval = setInterval(tick, MINUTE_MS);
	}, msToNextMinute);

	log.info("Refresh scheduler started (per-minute tick, server local time)");

	return () => {
		if (alignTimeout) {
			clearTimeout(alignTimeout);
			alignTimeout = null;
		}
		if (interval) {
			clearInterval(interval);
			interval = null;
		}
	};
}

// Exported for unit testing the per-tick firing decision without real timers.
export { localHhMm as _localHhMmForTest, runTick as _runTickForTest };
