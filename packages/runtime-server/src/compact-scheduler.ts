import type { Config } from "@ccflare/config";
import type { DatabaseOperations } from "@ccflare/database";
import type { Logger } from "@ccflare/logger";

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Current local wall-clock time formatted as "HH:MM". */
function localHhMm(now: Date): string {
	const hh = String(now.getHours()).padStart(2, "0");
	const mm = String(now.getMinutes()).padStart(2, "0");
	return `${hh}:${mm}`;
}

/**
 * Whether the monthly maintenance should fire at `now` for the given schedule.
 * Pure so it can be unit-tested without real timers. Matches on day-of-month
 * (1-28) and the exact local "HH:MM"; the per-minute tick guarantees this is
 * evaluated at most once per minute.
 */
export function shouldFireCompact(
	now: Date,
	enabled: boolean,
	day: number,
	time: string,
): boolean {
	return enabled && now.getDate() === day && localHhMm(now) === time;
}

/**
 * Run the monthly heavy maintenance: expire old data, then VACUUM to actually
 * shrink the database file on disk. VACUUM locks the DB and blocks the (single,
 * synchronous) SQLite connection for its duration — that is why this runs on a
 * monthly, off-peak schedule rather than in the frequent cleanup tick.
 */
function runMaintenance(
	dbOps: DatabaseOperations,
	config: Config,
	log: Logger,
) {
	const now = Date.now();
	const payloadMs = config.getDataRetentionDays() * DAY_MS;
	const requestMs = config.getRequestRetentionDays() * DAY_MS;
	const { removedRequests, removedPayloads } = dbOps.cleanupOldRequests(
		payloadMs,
		requestMs,
	);
	dbOps.compact(); // wal_checkpoint(TRUNCATE) + VACUUM
	log.info(
		`Monthly maintenance removed ${removedRequests} requests and ${removedPayloads} payloads, then compacted the database (elapsed ${Date.now() - now}ms)`,
	);
}

/**
 * Start the monthly compact scheduler. Ticks once per minute (aligned to the
 * wall-clock minute boundary) and fires the heavy maintenance when the current
 * local date/time matches the configured day and time. Config is read every
 * tick so schedule changes take effect without a restart. Returns a stop
 * function that cancels the scheduler.
 */
export function startCompactScheduler(
	dbOps: DatabaseOperations,
	config: Config,
	log: Logger,
): () => void {
	let interval: ReturnType<typeof setInterval> | null = null;
	let alignTimeout: ReturnType<typeof setTimeout> | null = null;
	let running = false;

	const tick = () => {
		if (running) return; // a long VACUUM from a prior tick is still in flight
		if (
			!shouldFireCompact(
				new Date(),
				config.getCompactScheduleEnabled(),
				config.getCompactScheduleDay(),
				config.getCompactScheduleTime(),
			)
		) {
			return;
		}
		running = true;
		try {
			runMaintenance(dbOps, config, log);
		} catch (err) {
			log.error(`Compact scheduler error: ${err}`);
		} finally {
			running = false;
		}
	};

	const msToNextMinute = MINUTE_MS - (Date.now() % MINUTE_MS);
	alignTimeout = setTimeout(() => {
		alignTimeout = null;
		tick();
		interval = setInterval(tick, MINUTE_MS);
	}, msToNextMinute);

	log.info(
		`Compact scheduler started (enabled=${config.getCompactScheduleEnabled()}, day=${config.getCompactScheduleDay()}, time=${config.getCompactScheduleTime()}, server local time)`,
	);

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

// Exported for unit testing the fire decision without real timers.
export { shouldFireCompact as _shouldFireCompactForTest };
