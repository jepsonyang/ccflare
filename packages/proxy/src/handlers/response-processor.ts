import { logError, RateLimitError } from "@ccflare/core";
import { sanitizeProxyHeaders } from "@ccflare/http";
import { Logger } from "@ccflare/logger";
import type { RateLimitInfo } from "@ccflare/providers";
import type { Account } from "@ccflare/types";
import type { ResolvedProxyContext } from "./proxy-types";

const log = new Logger("ResponseProcessor");

/**
 * Outcome of inspecting an upstream response for rate-limit handling.
 * - `ok`: forward the response to the client normally.
 * - `rate-limited`: a genuine account-level limit; the account was backed off
 *   and the caller should fail over to the next account.
 * - `request-level-error`: a 429 that is really a request-level rejection
 *   (e.g. a 1M long-context request that needs usage credits). The account was
 *   NOT backed off; the caller should return the error to the client instead
 *   of failing over, since retrying the same request elsewhere would also fail.
 */
export type ProxyResponseOutcome =
	| "ok"
	| "rate-limited"
	| "request-level-error";

// A request-level rejection is the caller's problem, not a transient limit, so
// surface it as 400 (non-retryable) rather than the upstream's misleading 429,
// which most SDKs auto-retry with backoff.
const REQUEST_LEVEL_ERROR_STATUS = 400;

/**
 * Rewrite a request-level rejection (upstream 429) as a non-retryable 400 while
 * preserving the upstream error body so the client sees the real reason.
 */
export function buildRequestLevelErrorResponse(response: Response): Response {
	return new Response(response.body, {
		status: REQUEST_LEVEL_ERROR_STATUS,
		statusText: "Bad Request",
		headers: sanitizeProxyHeaders(response.headers),
	});
}

/**
 * Handles rate limit response for an account
 * @param account - The rate-limited account
 * @param rateLimitInfo - Parsed rate limit information
 * @param ctx - The proxy context
 */
export function handleRateLimitResponse(
	account: Account,
	rateLimitInfo: RateLimitInfo,
	ctx: ResolvedProxyContext,
): void {
	if (!rateLimitInfo.resetTime) return;

	log.warn(
		`Account ${account.name} rate-limited until ${new Date(
			rateLimitInfo.resetTime,
		).toISOString()}`,
	);

	const resetTime = rateLimitInfo.resetTime;
	ctx.asyncWriter.enqueue(() =>
		ctx.dbOps.markAccountRateLimited(account.id, resetTime),
	);

	const rateLimitError = new RateLimitError(
		account.id,
		rateLimitInfo.resetTime,
		rateLimitInfo.remaining,
	);
	logError(rateLimitError, log);
}

/**
 * Updates account rate-limit metadata in the background.
 * Usage counters are owned by the worker after it processes the full response.
 * Accepts pre-parsed rate limit info to avoid re-parsing headers.
 */
export function updateAccountMetadata(
	account: Account,
	rateLimitInfo: RateLimitInfo,
	ctx: ResolvedProxyContext,
): void {
	// Utilization windows are returned on normal responses (not just when a
	// rate-limit status header is present), so persist when we have either.
	const hasWindows =
		rateLimitInfo.fiveHourUtilization !== undefined ||
		rateLimitInfo.sevenDayUtilization !== undefined ||
		rateLimitInfo.fiveHourResetTime !== undefined ||
		rateLimitInfo.sevenDayResetTime !== undefined ||
		rateLimitInfo.fableUtilization !== undefined ||
		rateLimitInfo.fableResetTime !== undefined ||
		rateLimitInfo.representativeClaim !== undefined;

	if (rateLimitInfo.statusHeader || hasWindows) {
		const status = rateLimitInfo.statusHeader ?? "ok";
		ctx.asyncWriter.enqueue(() =>
			ctx.dbOps.updateAccountRateLimitMeta(
				account.id,
				status,
				rateLimitInfo.resetTime ?? null,
				rateLimitInfo.remaining,
				{
					fiveHourUtilization: rateLimitInfo.fiveHourUtilization,
					fiveHourResetTime: rateLimitInfo.fiveHourResetTime,
					sevenDayUtilization: rateLimitInfo.sevenDayUtilization,
					sevenDayResetTime: rateLimitInfo.sevenDayResetTime,
					fableUtilization: rateLimitInfo.fableUtilization,
					fableResetTime: rateLimitInfo.fableResetTime,
					representativeClaim: rateLimitInfo.representativeClaim,
				},
			),
		);
	}
}

/**
 * Processes a successful proxy response
 * @param response - The provider response
 * @param account - The account used
 * @param ctx - The proxy context
 * @returns Whether the response is rate-limited
 */
export async function processProxyResponse(
	response: Response,
	account: Account,
	ctx: ResolvedProxyContext,
): Promise<ProxyResponseOutcome> {
	const isStream = ctx.provider.isStreamingResponse?.(response) ?? false;
	// Parse rate-limit headers once and pass the result through
	const rateLimitInfo = ctx.provider.parseRateLimit(response);

	// Handle rate limit
	if (!isStream && rateLimitInfo.isRateLimited) {
		// Some 429s are request-level rejections, not account-level limits
		// (e.g. a 1M long-context request that needs usage credits). Backing off
		// the whole account for those is wrong: normal-size requests to the same
		// account would still succeed. The reason lives in the body, so peek at
		// it and skip the backoff when the provider flags it as request-level.
		if (ctx.provider.isRequestLevelRateLimit) {
			const limitBody = await response
				.clone()
				.text()
				.catch(() => "");
			if (ctx.provider.isRequestLevelRateLimit(limitBody)) {
				log.warn(
					`Account ${account.name} returned a request-level 429 (not backing off): ${limitBody.slice(0, 200)}`,
				);
				return "request-level-error";
			}
		}

		handleRateLimitResponse(account, rateLimitInfo, ctx);
		updateAccountMetadata(account, rateLimitInfo, ctx);
		return "rate-limited";
	}

	// Update account metadata in background
	updateAccountMetadata(account, rateLimitInfo, ctx);
	return "ok";
}

/**
 * Handles errors that occur during proxy operations
 * @param error - The error that occurred
 * @param account - The account that failed (optional)
 * @param logger - Logger instance
 */
export function handleProxyError(
	error: unknown,
	account: Account | null,
	logger: Logger,
): void {
	logError(error, logger);
	if (account) {
		logger.error(`Failed to proxy request with account ${account.name}`);
	} else {
		logger.error("Failed to proxy request");
	}
}
