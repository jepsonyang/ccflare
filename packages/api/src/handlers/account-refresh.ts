import type { Config } from "@ccflare/config";
import type { DatabaseOperations } from "@ccflare/database";
import {
	BadRequest,
	errorResponse,
	InternalServerError,
	jsonResponse,
	NotFound,
} from "@ccflare/http";
import { Logger } from "@ccflare/logger";
import { providerRegistry, type RateLimitInfo } from "@ccflare/providers";
import type { Account } from "@ccflare/types";

const log = new Logger("AccountRefreshHandler");

// Per-account cooldown between manual usage refreshes. Each refresh sends a real
// (tiny) upstream request, so we rate-limit here on the server — a client that
// bypasses the UI's cooldown still can't spam the upstream. In-memory is fine:
// ccflare runs single-instance, and losing the map on restart only permits one
// extra refresh.
const lastRefreshAt = new Map<string, number>();
const REFRESH_MIN_INTERVAL_MS = 60_000;

// Refresh the token if it expires within this window, mirroring the proxy's
// TOKEN_SAFETY_WINDOW_MS so a probe never goes out with a near-dead token.
const TOKEN_SAFETY_WINDOW_MS = 60_000;

// Cheapest model this OAuth path can call; verified to return the unified
// utilization headers. The alias (no date suffix) avoids model-retirement drift.
const PROBE_MODEL = "claude-haiku-4-5";

// Headers the Claude Code OAuth path requires. Kept in sync with
// packages/proxy/src/compat/handler.ts (REQUIRED_ANTHROPIC_BETAS / version).
const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_BETA =
	"claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,prompt-caching-scope-2026-01-05,token-efficient-tools-2026-03-28";

const PROBE_TIMEOUT_MS = 15_000;

/** True when the parsed rate-limit info carries at least one usage window. */
function hasUsageWindows(info: RateLimitInfo): boolean {
	return (
		info.fiveHourUtilization !== undefined ||
		info.fiveHourResetTime !== undefined ||
		info.sevenDayUtilization !== undefined ||
		info.sevenDayResetTime !== undefined ||
		info.fableUtilization !== undefined ||
		info.fableResetTime !== undefined ||
		info.representativeClaim !== undefined
	);
}

/**
 * Ensure the account has a usable access token, refreshing via the provider
 * when it is missing, expired, or about to expire. Persists and mutates the
 * in-memory account object so the probe below picks up the new token.
 */
async function ensureAccessToken(
	account: Account,
	provider: NonNullable<ReturnType<typeof providerRegistry.getProvider>>,
	dbOps: DatabaseOperations,
	config: Config,
): Promise<void> {
	const fresh =
		account.access_token &&
		account.expires_at &&
		account.expires_at - Date.now() > TOKEN_SAFETY_WINDOW_MS;
	if (fresh) return;

	if (!provider.refreshToken) {
		throw new Error(
			`Provider ${provider.name} does not support OAuth token refresh`,
		);
	}

	const result = await provider.refreshToken(
		account,
		config.getRuntime().clientId,
	);
	dbOps.updateAccountTokens(
		account.id,
		result.accessToken,
		result.expiresAt,
		result.refreshToken,
	);
	account.access_token = result.accessToken;
	account.expires_at = result.expiresAt;
	if (result.refreshToken) account.refresh_token = result.refreshToken;
}

/**
 * Create a handler that actively refreshes one OAuth account's usage windows.
 *
 * ccflare only learns an account's utilization from the `anthropic-ratelimit-
 * unified-*` headers on real responses, so an idle account's bars go stale.
 * This sends a minimal `max_tokens:1` probe with the account's OAuth token,
 * reads the fresh headers, and persists them — the same path a normal proxied
 * request takes, just triggered on demand.
 */
export function createAccountRefreshHandler(
	dbOps: DatabaseOperations,
	config: Config,
) {
	return async (_req: Request, accountId: string): Promise<Response> => {
		const account = dbOps.getAccount(accountId);
		if (!account) {
			return errorResponse(NotFound("Account not found"));
		}

		if (account.auth_method !== "oauth") {
			return errorResponse(
				BadRequest("Only OAuth accounts support usage refresh"),
			);
		}

		// Server-side cooldown: a real (billable) probe per refresh, so throttle.
		const last = lastRefreshAt.get(accountId);
		const now = Date.now();
		if (last && now - last < REFRESH_MIN_INTERVAL_MS) {
			return jsonResponse({
				success: true,
				skipped: true,
				retryAfterMs: REFRESH_MIN_INTERVAL_MS - (now - last),
			});
		}

		const provider = providerRegistry.getProvider(account.provider);
		if (!provider) {
			return errorResponse(
				InternalServerError(`No provider registered for ${account.provider}`),
			);
		}
		if (!provider.refreshToken) {
			return errorResponse(
				BadRequest(`Provider ${account.provider} does not support OAuth`),
			);
		}

		try {
			await ensureAccessToken(account, provider, dbOps, config);

			const baseUrl = account.base_url ?? provider.defaultBaseUrl;
			const headers = provider.prepareHeaders(
				new Headers({
					"content-type": "application/json",
					"anthropic-version": ANTHROPIC_VERSION,
					"anthropic-beta": ANTHROPIC_BETA,
				}),
				account,
			);

			const response = await fetch(`${baseUrl}/v1/messages`, {
				method: "POST",
				headers,
				body: JSON.stringify({
					model: PROBE_MODEL,
					max_tokens: 1,
					messages: [{ role: "user", content: "." }],
				}),
				signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
			});

			const info = provider.parseRateLimit(response);

			// Only persist when the probe actually returned usage windows. On a
			// failure (e.g. an unavailable model) there are no unified headers, and
			// writing would overwrite rate_limit_status/reset with stale defaults.
			if (!hasUsageWindows(info)) {
				log.warn(
					`Usage refresh for ${account.name} returned no usage windows (status ${response.status})`,
				);
				return errorResponse(
					InternalServerError(
						`Refresh probe returned no usage data (HTTP ${response.status})`,
					),
				);
			}

			dbOps.updateAccountRateLimitMeta(
				account.id,
				info.statusHeader ?? "ok",
				info.resetTime ?? null,
				info.remaining,
				{
					fiveHourUtilization: info.fiveHourUtilization,
					fiveHourResetTime: info.fiveHourResetTime,
					sevenDayUtilization: info.sevenDayUtilization,
					sevenDayResetTime: info.sevenDayResetTime,
					fableUtilization: info.fableUtilization,
					fableResetTime: info.fableResetTime,
					representativeClaim: info.representativeClaim,
				},
			);

			lastRefreshAt.set(accountId, Date.now());
			log.info(`Refreshed usage windows for account ${account.name}`);
			return jsonResponse({ success: true, skipped: false });
		} catch (error) {
			log.error(`Usage refresh failed for ${account.name}:`, error);
			return errorResponse(
				error instanceof Error ? error : new Error("Failed to refresh usage"),
			);
		}
	};
}
