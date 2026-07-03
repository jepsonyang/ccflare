import { describe, expect, it } from "bun:test";
import {
	formatAccountRateLimitStatus,
	getAccountRateLimitSeverity,
} from "./account-display";

const NOW = 1_000_000_000_000;
const FUTURE = NOW + 120_000;

describe("formatAccountRateLimitStatus", () => {
	it("labels a healthy account as Allowed for both ok and allowed codes", () => {
		expect(
			formatAccountRateLimitStatus({ code: "ok", isLimited: false }, NOW),
		).toBe("Allowed");
		expect(
			formatAccountRateLimitStatus({ code: "allowed", isLimited: false }, NOW),
		).toBe("Allowed");
	});

	it("shows Rate limited while inside a quota window", () => {
		expect(
			formatAccountRateLimitStatus(
				{ code: "allowed", isLimited: true, until: FUTURE },
				NOW,
			),
		).toBe("Rate limited");
	});

	it("shows a Backoff countdown for a plain 429 backoff", () => {
		expect(
			formatAccountRateLimitStatus(
				{ code: "backoff", isLimited: true, until: NOW + 45_000 },
				NOW,
			),
		).toBe("Backoff (45s)");
	});

	it("capitalizes native soft-warning codes", () => {
		expect(
			formatAccountRateLimitStatus(
				{ code: "allowed_warning", isLimited: false },
				NOW,
			),
		).toBe("Allowed_warning");
	});

	it("shows Paused for a paused account", () => {
		expect(
			formatAccountRateLimitStatus({ code: "paused", isLimited: false }, NOW),
		).toBe("Paused");
	});
});

describe("getAccountRateLimitSeverity", () => {
	// Regression: an account inside a rate-limit window whose last-seen status
	// code is still "allowed" must render critical, not a stale green normal.
	it("is critical while rate-limited even when the code says allowed", () => {
		expect(
			getAccountRateLimitSeverity(
				{ code: "allowed", isLimited: true, until: FUTURE },
				NOW,
			),
		).toBe("critical");
	});

	it("is normal for a healthy account", () => {
		expect(
			getAccountRateLimitSeverity({ code: "allowed", isLimited: false }, NOW),
		).toBe("normal");
		expect(
			getAccountRateLimitSeverity({ code: "ok", isLimited: false }, NOW),
		).toBe("normal");
	});

	it("is warning for soft-warning and backoff statuses", () => {
		expect(
			getAccountRateLimitSeverity(
				{ code: "allowed_warning", isLimited: false },
				NOW,
			),
		).toBe("warning");
		expect(
			getAccountRateLimitSeverity(
				{ code: "backoff", isLimited: true, until: FUTURE },
				NOW,
			),
		).toBe("warning");
	});

	it("is critical for hard-limit codes", () => {
		for (const code of [
			"rate_limited",
			"blocked",
			"queueing_hard",
			"payment_required",
		]) {
			expect(getAccountRateLimitSeverity({ code, isLimited: false }, NOW)).toBe(
				"critical",
			);
		}
	});
});
