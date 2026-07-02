import type { AccountProvider, AuthMethod } from "./provider-metadata";

/**
 * Synthetic rate-limit status used for a plain HTTP 429 that carries no
 * unified window headers — i.e. a short-lived request-rate backoff rather
 * than a 5h/7d quota exhaustion. Stored in `rate_limit_status` so the UI
 * can show the remaining backoff time instead of a generic "Rate limited".
 */
export const RATE_LIMIT_BACKOFF_STATUS = "backoff";

export interface AccountRateLimitInfo {
	code: string;
	isLimited: boolean;
	until: number | null;
	resetAt: number | null;
	remaining: number | null;
}

export interface AccountSessionInfo {
	active: boolean;
	startedAt: number | null;
	requestCount: number;
}

export interface AccountUsageWindow {
	// Percentage of the window's quota consumed, 0-100. Null until the
	// account has received a response carrying the utilization headers.
	utilization: number | null;
	// Window reset time as ms epoch, or null when unknown.
	resetAt: number | null;
	// True when this window is the current binding constraint.
	isRepresentative: boolean;
}

export interface AccountUsageWindows {
	fiveHour: AccountUsageWindow;
	sevenDay: AccountUsageWindow;
	// Fable weekly bucket. utilization stays null until Fable is used.
	fable: AccountUsageWindow;
}

// Domain model - used throughout the application
export interface Account {
	id: string;
	name: string;
	provider: AccountProvider;
	auth_method: AuthMethod;
	base_url: string | null;
	api_key: string | null;
	refresh_token: string | null;
	access_token: string | null;
	expires_at: number | null;
	request_count: number;
	total_requests: number;
	last_used: number | null;
	created_at: number;
	rate_limited_until: number | null;
	session_start: number | null;
	session_request_count: number;
	weight: number;
	paused: boolean;
	rate_limit_reset: number | null;
	rate_limit_status: string | null;
	rate_limit_remaining: number | null;
	// Unified utilization windows (Anthropic OAuth). Utilization is 0-100,
	// reset times are ms epoch, claim identifies the binding window.
	unified_5h_utilization: number | null;
	unified_5h_reset: number | null;
	unified_7d_utilization: number | null;
	unified_7d_reset: number | null;
	unified_fable_utilization: number | null;
	unified_fable_reset: number | null;
	unified_representative_claim: string | null;
}

// Account creation types
export interface AddAccountOptions {
	name: string;
	provider: AccountProvider;
}

export interface AccountDeleteRequest {
	confirm: string;
}

function normalizeRateLimitCode(account: Account, now: number): string {
	if (account.paused) {
		return "paused";
	}

	if (account.rate_limit_status) {
		return account.rate_limit_status;
	}

	if (account.rate_limited_until && account.rate_limited_until > now) {
		return "rate_limited";
	}

	return "ok";
}

export function getAccountRateLimitInfo(
	account: Account,
	now: number = Date.now(),
): AccountRateLimitInfo {
	const limitedUntil =
		account.rate_limited_until && account.rate_limited_until > now
			? account.rate_limited_until
			: null;

	return {
		code: normalizeRateLimitCode(account, now),
		isLimited: account.paused ? false : limitedUntil !== null,
		until: limitedUntil,
		resetAt: account.rate_limit_reset ?? null,
		remaining: account.rate_limit_remaining ?? null,
	};
}

export function getAccountSessionInfo(account: Account): AccountSessionInfo {
	return {
		active: account.session_start !== null,
		startedAt: account.session_start ?? null,
		requestCount: account.session_request_count,
	};
}

/**
 * Whether the representative-claim header refers to a given window.
 * Observed claim tokens: "five_hour" (5h) and "7d_oi" (Fable); "seven_day"
 * is inferred for the plain weekly window. Matching stays tolerant on
 * substrings to survive minor wording changes.
 */
function claimMatchesWindow(
	claim: string | null,
	window: "5h" | "7d" | "fable",
): boolean {
	if (!claim) return false;
	const c = claim.toLowerCase();
	if (window === "5h") {
		return c.includes("5h") || c.includes("hour") || c.includes("session");
	}
	if (window === "fable") {
		// Fable bucket header is "7d_oi"; a binding claim would name it.
		return c.includes("oi") || c.includes("fable");
	}
	// Plain weekly ("All models"); exclude the Fable-specific "7d_oi" claim.
	if (c.includes("oi") || c.includes("fable")) {
		return false;
	}
	return (
		c.includes("7d") ||
		c.includes("day") ||
		c.includes("week") ||
		c.includes("weekly")
	);
}

export function getAccountUsageWindows(account: Account): AccountUsageWindows {
	const claim = account.unified_representative_claim;
	return {
		fiveHour: {
			utilization: account.unified_5h_utilization ?? null,
			resetAt: account.unified_5h_reset ?? null,
			isRepresentative: claimMatchesWindow(claim, "5h"),
		},
		sevenDay: {
			utilization: account.unified_7d_utilization ?? null,
			resetAt: account.unified_7d_reset ?? null,
			isRepresentative: claimMatchesWindow(claim, "7d"),
		},
		fable: {
			utilization: account.unified_fable_utilization ?? null,
			resetAt: account.unified_fable_reset ?? null,
			isRepresentative: claimMatchesWindow(claim, "fable"),
		},
	};
}

export function getAccountTokenStatus(
	account: Pick<Account, "access_token" | "expires_at">,
	now: number = Date.now(),
): "valid" | "expired" {
	if (account.expires_at !== null) {
		return account.expires_at > now ? "valid" : "expired";
	}

	return account.access_token ? "valid" : "expired";
}
