import {
	type Account,
	type AccountProvider,
	type AccountRateLimitInfo,
	type AccountSessionInfo,
	type AuthMethod,
	getAccountRateLimitInfo,
	getAccountSessionInfo,
	getAccountTokenStatus,
	RATE_LIMIT_BACKOFF_STATUS,
} from "@ccflare/types";

export interface AccountRateLimitStatusView {
	code: string;
	isLimited: boolean;
	until: string | null;
}

export interface AccountSessionInfoView {
	active: boolean;
	startedAt: string | null;
	requestCount: number;
}

export interface AccountDisplay {
	id: string;
	name: string;
	provider: AccountProvider;
	auth_method: AuthMethod;
	base_url: string | null;
	weightDisplay: string;
	created: Date;
	lastUsed: Date | null;
	requestCount: number;
	totalRequests: number;
	tokenStatus: "valid" | "expired";
	rateLimitStatus: string;
	sessionInfo: string;
	paused: boolean;
	weight?: number;
	rateLimit: AccountRateLimitInfo;
	session: AccountSessionInfo;
}

function toTimestamp(value: number | string | null | undefined): number | null {
	if (value === null || value === undefined) {
		return null;
	}

	if (typeof value === "number") {
		return value;
	}

	const timestamp = Date.parse(value);
	return Number.isNaN(timestamp) ? null : timestamp;
}

/** Compact h/m/s backoff duration, e.g. "45s", "1m30s", "10h10m10s". */
function formatBackoffDuration(ms: number): string {
	const totalSeconds = Math.ceil(ms / 1000);
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;

	let out = "";
	if (hours > 0) out += `${hours}h`;
	if (hours > 0 || minutes > 0) out += `${minutes}m`;
	out += `${seconds}s`;
	return out;
}

export function formatAccountRateLimitStatus(
	rateLimit:
		| AccountRateLimitInfo
		| AccountRateLimitStatusView
		| {
				code: string;
				isLimited: boolean;
				until?: number | string | null;
		  },
	now: number = Date.now(),
): string {
	if (rateLimit.code === "paused") {
		return "Paused";
	}

	const untilTs = toTimestamp(rateLimit.until ?? null);

	// Short request-rate backoff (plain 429): show the remaining time, since
	// it is not reflected in the 5h/7d usage windows below.
	if (rateLimit.code === RATE_LIMIT_BACKOFF_STATUS) {
		if (rateLimit.isLimited && untilTs && untilTs > now) {
			return `backoff (${formatBackoffDuration(untilTs - now)})`;
		}
		return "OK";
	}

	// Quota-window rate limit: the reset time is already shown by the usage
	// windows below, so keep this to a plain status without a countdown.
	if (rateLimit.isLimited && untilTs && untilTs > now) {
		return "Rate limited";
	}

	if (rateLimit.code !== "ok") {
		return rateLimit.code;
	}

	return "OK";
}

export type RateLimitSeverity = "normal" | "warning" | "critical";

/**
 * Severity bucket for a rate-limit status code, for color coding.
 * - warning: soft/temporary pressure (soft warning, soft queue, 429 backoff)
 * - critical: hard limits that block usage
 * - normal: allowed / ok / anything else
 */
export function getAccountRateLimitSeverity(code: string): RateLimitSeverity {
	switch (code) {
		case "allowed_warning":
		case "queueing_soft":
		case RATE_LIMIT_BACKOFF_STATUS:
			return "warning";
		case "rate_limited":
		case "blocked":
		case "queueing_hard":
		case "payment_required":
			return "critical";
		default:
			return "normal";
	}
}

export function formatAccountSessionInfo(
	session:
		| AccountSessionInfo
		| AccountSessionInfoView
		| {
				active: boolean;
				startedAt?: number | string | null;
				requestCount: number;
		  },
	now: number = Date.now(),
): string {
	const startedAt = toTimestamp(session.startedAt ?? null);
	if (!session.active || startedAt === null) {
		return "-";
	}

	const sessionAgeMinutes = Math.max(0, Math.floor((now - startedAt) / 60000));
	return `${session.requestCount} reqs, ${sessionAgeMinutes}m ago`;
}

export function toAccountDisplay(
	account: Account,
	now: number = Date.now(),
): AccountDisplay {
	const rateLimit = getAccountRateLimitInfo(account, now);
	const session = getAccountSessionInfo(account);

	return {
		id: account.id,
		name: account.name,
		provider: account.provider,
		auth_method: account.auth_method,
		base_url: account.base_url,
		weightDisplay: `${account.weight}x`,
		created: new Date(account.created_at),
		lastUsed: account.last_used ? new Date(account.last_used) : null,
		requestCount: account.request_count,
		totalRequests: account.total_requests,
		tokenStatus: getAccountTokenStatus(account, now),
		rateLimitStatus: formatAccountRateLimitStatus(rateLimit, now),
		sessionInfo: formatAccountSessionInfo(session, now),
		paused: account.paused,
		weight: account.weight,
		rateLimit,
		session,
	};
}
