import type { Account } from "@ccflare/types";

export interface TokenRefreshResult {
	accessToken: string;
	expiresAt: number;
	refreshToken: string; // Always required - either new token or existing one
}

export interface RateLimitInfo {
	isRateLimited: boolean;
	resetTime?: number;
	statusHeader?: string;
	remaining?: number;
	// Unified rate-limit utilization windows (Anthropic OAuth accounts).
	// Utilization values are normalized to 0-100; reset times are ms epoch.
	fiveHourUtilization?: number;
	fiveHourResetTime?: number;
	sevenDayUtilization?: number;
	sevenDayResetTime?: number;
	fableUtilization?: number;
	fableResetTime?: number;
	representativeClaim?: string;
}

export interface Provider {
	name: string;
	defaultBaseUrl: string;

	/**
	 * Whether the provider supports websocket upgrades for the given upstream path.
	 */
	supportsWebSocket?(upstreamPath: string): boolean;

	/**
	 * Refresh the access token for an account
	 */
	refreshToken?(
		account: Account,
		clientId: string,
	): Promise<TokenRefreshResult>;

	/**
	 * Build the target URL for the provider
	 */
	buildUrl(upstreamPath: string, query: string, account?: Account): string;

	/**
	 * Prepare headers for the provider request
	 */
	prepareHeaders(headers: Headers, account: Account | null): Headers;

	/**
	 * Parse rate limit information from response
	 */
	parseRateLimit(response: Response): RateLimitInfo;

	/**
	 * Given the body of a response already classified as rate-limited (429),
	 * decide whether it is actually a *request-level* rejection rather than an
	 * *account-level* limit. Request-level rejections (e.g. a 1M long-context
	 * request that needs usage credits) must not back off the whole account,
	 * since normal-size requests to the same account would still succeed.
	 * Returns false/undefined when the 429 is a genuine account-level limit.
	 */
	isRequestLevelRateLimit?(body: string): boolean;

	/**
	 * Process the response before returning to client
	 */
	processResponse(
		response: Response,
		account: Account | null,
	): Promise<Response>;

	/**
	 * Extract usage information from response if available
	 */
	extractUsageInfo?(response: Response): Promise<{
		model?: string;
		promptTokens?: number;
		completionTokens?: number;
		totalTokens?: number;
		costUsd?: number;
		inputTokens?: number;
		cacheReadInputTokens?: number;
		cacheCreationInputTokens?: number;
		outputTokens?: number;
	} | null>;

	/**
	 * Check if the response is a streaming response
	 */
	isStreamingResponse?(response: Response): boolean;
}

// OAuth-specific types
export interface OAuthProviderConfig {
	authorizeUrl: string;
	tokenUrl: string;
	clientId: string;
	scopes: string[];
	redirectUri: string;
}

export interface OAuthProvider {
	getOAuthConfig(): OAuthProviderConfig;
	exchangeCode(
		code: string,
		verifier: string,
		config: OAuthProviderConfig,
	): Promise<TokenResult>;
	generateAuthUrl(config: OAuthProviderConfig, pkce: PKCEChallenge): string;
}

export interface PKCEChallenge {
	verifier: string;
	challenge: string;
}

export interface TokenResult {
	refreshToken: string;
	accessToken: string;
	expiresAt: number;
}
