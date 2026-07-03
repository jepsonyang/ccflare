import { logError, ProviderError } from "@ccflare/core";
import { Logger } from "@ccflare/logger";
import type { Account, RequestMeta } from "@ccflare/types";
import { forwardToClient } from "../response-handler";
import { ERROR_MESSAGES, type ResolvedProxyContext } from "./proxy-types";
import { makeProxyRequest } from "./request-handler";
import {
	buildRequestLevelErrorResponse,
	handleProxyError,
	processProxyResponse,
} from "./response-processor";
import { getValidAccessToken } from "./token-manager";

const log = new Logger("ProxyOperations");

/**
 * Handles proxy request without authentication
 * @param req - The incoming request
 * @param url - The parsed URL
 * @param requestMeta - Request metadata
 * @param requestBodyBuffer - Buffered request body
 * @param createBodyStream - Function to create body stream
 * @param ctx - The proxy context
 * @returns Promise resolving to the response
 * @throws {ProviderError} If the unauthenticated request fails
 */
export async function proxyUnauthenticated(
	req: Request,
	url: URL,
	requestMeta: RequestMeta,
	requestBodyBuffer: ArrayBuffer | null,
	createBodyStream: () => ReadableStream<Uint8Array> | undefined,
	ctx: ResolvedProxyContext,
): Promise<Response> {
	log.warn(ERROR_MESSAGES.NO_ACCOUNTS);

	const targetUrl = ctx.provider.buildUrl(ctx.upstreamPath, url.search);
	const headers = ctx.provider.prepareHeaders(req.headers, null);

	try {
		const upstreamRequestStartedAt = Date.now();
		const response = await makeProxyRequest(
			targetUrl,
			req.method,
			headers,
			createBodyStream,
			!!req.body,
		);
		const responseHeadersReceivedAt = Date.now();

		return forwardToClient(
			{
				requestId: requestMeta.id,
				method: requestMeta.method,
				path: url.pathname,
				account: null,
				requestHeaders: req.headers,
				requestBody: requestBodyBuffer,
				response,
				timestamp: requestMeta.timestamp,
				upstreamRequestStartedAt,
				responseHeadersReceivedAt,
				retryAttempt: 0,
				failoverAttempts: 0,
			},
			ctx,
		);
	} catch (error) {
		logError(error, log);
		throw new ProviderError(
			ERROR_MESSAGES.UNAUTHENTICATED_FAILED,
			ctx.providerName,
			502,
			{
				originalError: error instanceof Error ? error.message : String(error),
			},
		);
	}
}

/**
 * Attempts to proxy a request with a specific account
 * @param req - The incoming request
 * @param url - The parsed URL
 * @param account - The account to use
 * @param requestMeta - Request metadata
 * @param requestBodyBuffer - Buffered request body
 * @param createBodyStream - Function to create body stream
 * @param failoverAttempts - Number of failover attempts
 * @param ctx - The proxy context
 * @returns Promise resolving to response or null if failed
 */
export async function proxyWithAccount(
	req: Request,
	url: URL,
	account: Account,
	requestMeta: RequestMeta,
	requestBodyBuffer: ArrayBuffer | null,
	createBodyStream: () => ReadableStream<Uint8Array> | undefined,
	failoverAttempts: number,
	ctx: ResolvedProxyContext,
): Promise<Response | null> {
	try {
		log.info(`Attempting request with account: ${account.name}`);

		// Get valid access token
		const accessToken = await getValidAccessToken(account, ctx);

		// Prepare request
		const requestAccount =
			accessToken === account.access_token
				? account
				: { ...account, access_token: accessToken };
		const headers = ctx.provider.prepareHeaders(req.headers, requestAccount);
		const targetUrl = ctx.provider.buildUrl(
			ctx.upstreamPath,
			url.search,
			account,
		);

		// Make the request
		const upstreamRequestStartedAt = Date.now();
		const response = await makeProxyRequest(
			targetUrl,
			req.method,
			headers,
			createBodyStream,
			!!req.body,
		);
		const responseHeadersReceivedAt = Date.now();

		// Process response and check for rate limit
		const outcome = await processProxyResponse(response, account, ctx);
		if (outcome === "rate-limited") {
			// Log the actual upstream body behind the rate-limit decision so a
			// real quota/rate limit can be told apart from a non-limit error that
			// merely shares the 429 status (Anthropic puts the reason in the body).
			const limitBody = await response
				.clone()
				.text()
				.catch(() => "");
			log.warn(
				`Upstream ${ctx.providerName}/${account.name} ${response.status} treated as rate-limit: ${limitBody.slice(0, 500)}`,
			);
			return null; // Signal to try next account
		}

		// A request-level rejection (e.g. 1M long-context needs credits) fails
		// the same way on every account, so don't fail over. Return the reason
		// as a non-retryable 400 rather than the upstream's misleading 429.
		const clientResponse =
			outcome === "request-level-error"
				? buildRequestLevelErrorResponse(response)
				: response;

		// Forward response to client
		return forwardToClient(
			{
				requestId: requestMeta.id,
				method: requestMeta.method,
				path: url.pathname,
				account,
				requestHeaders: req.headers,
				requestBody: requestBodyBuffer,
				response: clientResponse,
				timestamp: requestMeta.timestamp,
				upstreamRequestStartedAt,
				responseHeadersReceivedAt,
				retryAttempt: 0,
				failoverAttempts,
			},
			ctx,
		);
	} catch (err) {
		handleProxyError(err, account, log);
		return null;
	}
}
