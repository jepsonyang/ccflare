import { describe, expect, it } from "bun:test";
import {
	createApiKeyAccount,
	expectBuildUrlCases,
	expectNoOAuthSupport,
	expectRemovedHeaders,
	expectUnifiedRateLimit,
} from "../../test-helpers";
import { AnthropicProvider } from "./provider";

describe("AnthropicProvider", () => {
	const provider = new AnthropicProvider();

	it("builds upstream URLs from the stripped Anthropic path", () => {
		expectBuildUrlCases(provider, [
			{
				upstreamPath: "/v1/messages",
				expected: "https://api.anthropic.com/v1/messages",
			},
			{
				upstreamPath: "/v1/models",
				query: "?foo=bar&baz=qux",
				expected: "https://api.anthropic.com/v1/models?foo=bar&baz=qux",
			},
			{
				upstreamPath: "/v1/messages",
				account: createApiKeyAccount("anthropic", {
					base_url: "https://anthropic.internal/",
				}),
				expected: "https://anthropic.internal/v1/messages",
			},
		]);
	});

	it("injects x-api-key for API key accounts", () => {
		const headers = provider.prepareHeaders(
			new Headers({
				host: "localhost:8080",
				"accept-encoding": "gzip",
				"content-encoding": "gzip",
			}),
			createApiKeyAccount("anthropic"),
		);

		expect(headers.get("x-api-key")).toBe("sk-ant-test");
		expect(headers.get("authorization")).toBeNull();
		expectRemovedHeaders(headers, [
			"host",
			"accept-encoding",
			"content-encoding",
		]);
	});

	it("ignores OAuth access tokens and does not expose OAuth helpers", () => {
		const headers = provider.prepareHeaders(
			new Headers({
				host: "localhost:8080",
			}),
			createApiKeyAccount("anthropic", {
				auth_method: "oauth",
				api_key: null,
				access_token: "oauth-access-token",
				refresh_token: "oauth-refresh-token",
				expires_at: Date.now() + 60_000,
			}),
		);

		expect(headers.get("authorization")).toBeNull();
		expectRemovedHeaders(headers, ["x-api-key", "host"]);
		expectNoOAuthSupport(provider);
	});

	it("parses Anthropic unified rate limit headers", () => {
		const resetSeconds = Math.floor((Date.now() + 120_000) / 1000);
		const response = new Response("{}", {
			status: 200,
			headers: {
				"anthropic-ratelimit-unified-status": "allowed",
				"anthropic-ratelimit-unified-reset": String(resetSeconds),
				"anthropic-ratelimit-unified-remaining": "17",
			},
		});

		expectUnifiedRateLimit(provider, response, {
			isRateLimited: false,
			resetTime: resetSeconds * 1000,
			statusHeader: "allowed",
			remaining: 17,
		});
	});

	it("parses unified 5h/7d utilization windows", () => {
		const fiveHourReset = Math.floor((Date.now() + 120_000) / 1000);
		const sevenDayReset = Math.floor((Date.now() + 500_000) / 1000);
		const response = new Response("{}", {
			status: 200,
			headers: {
				"anthropic-ratelimit-unified-status": "allowed",
				// Anthropic reports utilization as a 0-1 fraction (0.42 = 42%).
				"anthropic-ratelimit-unified-5h-utilization": "0.42",
				"anthropic-ratelimit-unified-5h-reset": String(fiveHourReset),
				"anthropic-ratelimit-unified-7d-utilization": "0.85",
				"anthropic-ratelimit-unified-7d-reset": String(sevenDayReset),
				"anthropic-ratelimit-unified-representative-claim": "7d",
			},
		});

		const info = provider.parseRateLimit(response);
		expect(info.fiveHourUtilization).toBe(42);
		expect(info.fiveHourResetTime).toBe(fiveHourReset * 1000);
		expect(info.sevenDayUtilization).toBeCloseTo(85);
		expect(info.sevenDayResetTime).toBe(sevenDayReset * 1000);
		expect(info.representativeClaim).toBe("7d");
	});

	it("clamps an exhausted (>100%) window down to 100", () => {
		const response = new Response("{}", {
			status: 429,
			headers: {
				"anthropic-ratelimit-unified-status": "rejected",
				// Exhausted 7d window: fraction exceeds 1.0 (1.01 = 101%).
				"anthropic-ratelimit-unified-7d-utilization": "1.01",
				"anthropic-ratelimit-unified-representative-claim": "seven_day",
			},
		});

		const info = provider.parseRateLimit(response);
		expect(info.sevenDayUtilization).toBe(100);
	});

	it("parses the Fable (7d_oi) window and normalizes -0.0 to 0", () => {
		const fableReset = Math.floor((Date.now() + 600_000) / 1000);
		const response = new Response("{}", {
			status: 200,
			headers: {
				"anthropic-ratelimit-unified-status": "allowed",
				"anthropic-ratelimit-unified-7d_oi-utilization": "-0.0",
				"anthropic-ratelimit-unified-7d_oi-reset": String(fableReset),
			},
		});

		const info = provider.parseRateLimit(response);
		expect(info.fableUtilization).toBe(0);
		expect(info.fableResetTime).toBe(fableReset * 1000);
	});

	it("omits utilization windows when headers are absent", () => {
		const response = new Response("{}", { status: 200 });
		const info = provider.parseRateLimit(response);
		expect(info.fiveHourUtilization).toBeUndefined();
		expect(info.sevenDayUtilization).toBeUndefined();
		expect(info.representativeClaim).toBeUndefined();
	});

	it("tags a plain 429 without unified headers as a backoff", () => {
		const resetSeconds = Math.floor((Date.now() + 90_000) / 1000);
		const response = new Response("{}", {
			status: 429,
			headers: { "x-ratelimit-reset": String(resetSeconds) },
		});
		const info = provider.parseRateLimit(response);
		expect(info.isRateLimited).toBe(true);
		expect(info.statusHeader).toBe("backoff");
		expect(info.resetTime).toBe(resetSeconds * 1000);
	});

	it("derives backoff reset from the retry-after delay-seconds header", () => {
		const before = Date.now();
		const response = new Response("{}", {
			status: 429,
			headers: { "retry-after": "8" },
		});
		const info = provider.parseRateLimit(response);
		const after = Date.now();
		expect(info.isRateLimited).toBe(true);
		expect(info.statusHeader).toBe("backoff");
		expect(info.resetTime).toBeGreaterThanOrEqual(before + 8_000);
		expect(info.resetTime).toBeLessThanOrEqual(after + 8_000);
	});

	it("derives backoff reset from a retry-after HTTP-date header", () => {
		const resetDate = new Date(Date.now() + 30_000);
		resetDate.setMilliseconds(0); // HTTP-date has second precision
		const response = new Response("{}", {
			status: 429,
			headers: { "retry-after": resetDate.toUTCString() },
		});
		const info = provider.parseRateLimit(response);
		expect(info.resetTime).toBe(resetDate.getTime());
	});

	it("prefers retry-after over x-ratelimit-reset for backoff", () => {
		const before = Date.now();
		const staleReset = Math.floor((Date.now() + 90_000) / 1000);
		const response = new Response("{}", {
			status: 429,
			headers: {
				"retry-after": "5",
				"x-ratelimit-reset": String(staleReset),
			},
		});
		const info = provider.parseRateLimit(response);
		const after = Date.now();
		expect(info.resetTime).toBeGreaterThanOrEqual(before + 5_000);
		expect(info.resetTime).toBeLessThanOrEqual(after + 5_000);
	});

	it("falls back to a 1-minute backoff when no reset headers are present", () => {
		const before = Date.now();
		const response = new Response("{}", { status: 429 });
		const info = provider.parseRateLimit(response);
		const after = Date.now();
		expect(info.isRateLimited).toBe(true);
		expect(info.statusHeader).toBe("backoff");
		expect(info.resetTime).toBeGreaterThanOrEqual(before + 60_000);
		expect(info.resetTime).toBeLessThanOrEqual(after + 60_000);
	});

	it("flags a long-context credits 429 as a request-level rejection", () => {
		const body = JSON.stringify({
			type: "error",
			error: {
				type: "rate_limit_error",
				message: "Usage credits are required for long context requests.",
			},
		});
		expect(provider.isRequestLevelRateLimit(body)).toBe(true);
	});

	it("does not flag a genuine account rate-limit as request-level", () => {
		const body = JSON.stringify({
			type: "error",
			error: {
				type: "rate_limit_error",
				message: "Number of requests has exceeded your rate limit.",
			},
		});
		expect(provider.isRequestLevelRateLimit(body)).toBe(false);
		expect(provider.isRequestLevelRateLimit("")).toBe(false);
	});
});
