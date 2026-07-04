import type { Config } from "@ccflare/config";
import type { DatabaseOperations } from "@ccflare/database";
import type { Logger } from "@ccflare/logger";

const DAY_MS = 24 * 60 * 60 * 1000;
// Rows deleted per statement. Kept small so each DELETE is a short, quickly
// committed write transaction — the write lock is held only briefly and the JS
// main thread (bun:sqlite is synchronous) is never blocked for long, even when
// a large backlog is drained on the first run after enabling cleanup.
const BATCH_SIZE = 500;

/** Yield to the event loop so request handling interleaves between batches. */
function yieldToLoop(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Delete every row older than `cutoffTs` in `BATCH_SIZE` chunks, awaiting a
 * macrotask between chunks. Returns the total number of rows removed.
 */
async function drainOlderThan(
	deleteBatch: (cutoffTs: number, batchSize: number) => number,
	cutoffTs: number,
): Promise<number> {
	let total = 0;
	while (true) {
		const removed = deleteBatch(cutoffTs, BATCH_SIZE);
		total += removed;
		if (removed < BATCH_SIZE) break;
		await yieldToLoop();
	}
	return total;
}

/**
 * Run one cleanup pass: expire payloads first (payload retention), then request
 * metadata (metadata retention, cascading to any remaining payload), then sweep
 * orphans. All deletes are batched with yields so the proxy keeps serving.
 */
async function runCleanup(
	dbOps: DatabaseOperations,
	config: Config,
	log: Logger,
): Promise<void> {
	const now = Date.now();
	const payloadCutoff = now - config.getDataRetentionDays() * DAY_MS;
	const requestCutoff = now - config.getRequestRetentionDays() * DAY_MS;

	const removedPayloads = await drainOlderThan(
		(cutoff, size) => dbOps.deletePayloadsOlderThanBatch(cutoff, size),
		payloadCutoff,
	);
	const removedRequests = await drainOlderThan(
		(cutoff, size) => dbOps.deleteRequestsOlderThanBatch(cutoff, size),
		requestCutoff,
	);
	const removedOrphans = dbOps.deleteOrphanedPayloads();

	if (removedPayloads || removedRequests || removedOrphans) {
		log.info(
			`Scheduled cleanup removed ${removedRequests} requests and ${removedPayloads + removedOrphans} payloads`,
		);
		// Light maintenance only — never VACUUM here (it locks the whole DB).
		dbOps.optimize();
	}
}

/**
 * Start the periodic retention-cleanup scheduler. Fires every
 * `config.getCleanupIntervalMinutes()` minutes; deliberately does NOT run at
 * startup (a large first sweep would slow boot). Deletes are batched and yield
 * between batches so requests keep flowing. Returns a stop function.
 */
export function startCleanupScheduler(
	dbOps: DatabaseOperations,
	config: Config,
	log: Logger,
): () => void {
	const intervalMs = config.getCleanupIntervalMinutes() * 60 * 1000;
	let running = false;

	const tick = () => {
		// Skip if a previous pass is still draining a large backlog.
		if (running) return;
		running = true;
		void runCleanup(dbOps, config, log)
			.catch((err) => log.error(`Cleanup scheduler tick error: ${err}`))
			.finally(() => {
				running = false;
			});
	};

	const interval = setInterval(tick, intervalMs);

	log.info(
		`Cleanup scheduler started (every ${config.getCleanupIntervalMinutes()}m; payload=${config.getDataRetentionDays()}d, requests=${config.getRequestRetentionDays()}d)`,
	);

	return () => {
		clearInterval(interval);
	};
}

// Exported for unit testing the drain/cleanup logic without real timers.
export { BATCH_SIZE as _CLEANUP_BATCH_SIZE, runCleanup as _runCleanupForTest };
