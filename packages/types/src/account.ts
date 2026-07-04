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

/**
 * Per-account scheduled usage-refresh configuration. Each entry in `times` is
 * a daily "HH:MM" in the server's local timezone; the scheduler fires an
 * on-demand usage refresh at each. `enabled` is a master switch that keeps the
 * configured times while suspending the schedule.
 */
export interface AccountRefreshSchedule {
	enabled: boolean;
	times: string[];
}

/** Maximum number of scheduled refresh times allowed per account. */
export const MAX_REFRESH_SCHEDULE_TIMES = 5;

const HHMM_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** True when `value` is a valid "HH:MM" 24-hour clock string. */
export function isValidHhMm(value: string): boolean {
	return HHMM_PATTERN.test(value);
}

export type RefreshScheduleValidation =
	| { ok: true; value: AccountRefreshSchedule }
	| { ok: false; error: string };

/**
 * Validate and normalize a refresh-schedule payload coming from the API/UI.
 * Enforces: valid HH:MM format, at most MAX_REFRESH_SCHEDULE_TIMES entries, and
 * no duplicate times. On success returns the schedule with times sorted
 * ascending. Shared by the frontend editor and the PATCH handler so both apply
 * identical rules.
 */
export function validateRefreshSchedule(
	input: unknown,
): RefreshScheduleValidation {
	if (typeof input !== "object" || input === null) {
		return { ok: false, error: "Schedule must be an object" };
	}

	const obj = input as Record<string, unknown>;
	const enabled = obj.enabled === true;

	if (!Array.isArray(obj.times)) {
		return { ok: false, error: "Schedule times must be an array" };
	}

	const times: string[] = [];
	for (const entry of obj.times) {
		if (typeof entry !== "string" || !isValidHhMm(entry)) {
			return { ok: false, error: `Invalid time: ${String(entry)}` };
		}
		times.push(entry);
	}

	if (times.length > MAX_REFRESH_SCHEDULE_TIMES) {
		return {
			ok: false,
			error: `At most ${MAX_REFRESH_SCHEDULE_TIMES} scheduled times are allowed`,
		};
	}

	if (new Set(times).size !== times.length) {
		return { ok: false, error: "Duplicate time" };
	}

	times.sort();
	return { ok: true, value: { enabled, times } };
}

/**
 * Parse the raw `refresh_schedule` DB column into a schedule object. Returns
 * null when unset or unparseable/invalid, so a corrupt row degrades to "no
 * schedule" rather than throwing.
 */
export function parseRefreshSchedule(
	raw: string | null | undefined,
): AccountRefreshSchedule | null {
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw);
		const result = validateRefreshSchedule(parsed);
		return result.ok ? result.value : null;
	} catch {
		return null;
	}
}

/** Serialize a schedule for storage in the `refresh_schedule` DB column. */
export function serializeRefreshSchedule(
	schedule: AccountRefreshSchedule,
): string {
	return JSON.stringify({ enabled: schedule.enabled, times: schedule.times });
}

/**
 * Whether the schedule should fire a refresh at the given local "HH:MM".
 * Only fires when enabled and the time is one of the configured entries.
 */
export function shouldFireRefresh(
	schedule: AccountRefreshSchedule | null,
	hhmm: string,
): boolean {
	if (!schedule?.enabled) return false;
	return schedule.times.includes(hhmm);
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
	// Per-account scheduled usage-refresh config; null when unconfigured.
	refresh_schedule: AccountRefreshSchedule | null;
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
