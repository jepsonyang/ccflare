import type { Config } from "@ccflare/config";
import type { DatabaseOperations } from "@ccflare/database";
import {
	errorResponse,
	InternalServerError,
	jsonResponse,
} from "@ccflare/http";
import { Logger } from "@ccflare/logger";
import {
	type HealthResponse,
	isAccountProvider,
	type RuntimeHealth,
} from "@ccflare/types";

const log = new Logger("HealthHandler");

/**
 * Create a health check handler
 */
export function createHealthHandler(
	dbOps: DatabaseOperations,
	config: Config,
	getProviders: () => string[],
	getRuntimeHealth?: () => RuntimeHealth,
) {
	return (): Response => {
		try {
			const response: HealthResponse = {
				status: "ok",
				accounts: dbOps.countAccounts(),
				timestamp: new Date().toISOString(),
				strategy: config.getStrategy(),
				providers: getProviders().filter(isAccountProvider),
				runtime: getRuntimeHealth?.(),
				timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
				// getTimezoneOffset returns minutes behind UTC (positive west of UTC);
				// negate so a value like UTC+8 reads as +480.
				utcOffsetMinutes: -new Date().getTimezoneOffset(),
			};

			return jsonResponse(response);
		} catch (error) {
			log.error("Failed to compute health response", error);
			return errorResponse(
				InternalServerError("Failed to compute health response"),
			);
		}
	};
}
