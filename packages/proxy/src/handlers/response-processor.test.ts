import { describe, expect, it } from "bun:test";
import type { Account } from "@ccflare/types";
import type { ResolvedProxyContext } from "./proxy-types";
import {
	buildRequestLevelErrorResponse,
	processProxyResponse,
} from "./response-processor";

function createAccount(): Account {
	return {
		id: "account-1",
		name: "primary",
		provider: "openai",
		auth_method: "api_key",
		base_url: null,
		api_key: "sk-test",
		refresh_token: null,
		access_token: null,
		expires_at: null,
		request_count: 0,
		total_requests: 0,
		last_used: null,
		created_at: 0,
		rate_limited_until: null,
		session_start: null,
		session_request_count: 0,
		weight: 1,
		paused: false,
		rate_limit_reset: null,
		rate_limit_status: null,
		rate_limit_remaining: null,
		unified_5h_utilization: null,
		unified_5h_reset: null,
		unified_7d_utilization: null,
		unified_7d_reset: null,
		unified_fable_utilization: null,
		unified_fable_reset: null,
		unified_representative_claim: null,
		refresh_schedule: null,
	};
}

function createContext(rateLimitInfo: {
	isRateLimited: boolean;
	statusHeader?: string;
	resetTime?: number | null;
	remaining?: number | null;
}) {
	const calls: string[] = [];
	const queued: Array<() => void> = [];
	const ctx = {
		provider: {
			name: "openai",
			defaultBaseUrl: "https://api.openai.com/v1",
			buildUrl() {
				return "https://api.openai.com/v1/chat/completions";
			},
			prepareHeaders(headers: Headers) {
				return new Headers(headers);
			},
			parseRateLimit() {
				return rateLimitInfo;
			},
			async processResponse(response: Response) {
				return response;
			},
		},
		asyncWriter: {
			enqueue(task: () => void) {
				queued.push(task);
			},
		},
		dbOps: {
			updateAccountUsage() {
				calls.push("updateAccountUsage");
			},
			updateAccountRateLimitMeta() {
				calls.push("updateAccountRateLimitMeta");
			},
			markAccountRateLimited() {
				calls.push("markAccountRateLimited");
			},
		},
	} as unknown as ResolvedProxyContext;

	return {
		ctx,
		calls,
		flush() {
			for (const task of queued) {
				task();
			}
		},
	};
}

describe("processProxyResponse", () => {
	it("keeps successful response processing limited to rate-limit metadata updates", async () => {
		const account = createAccount();
		const { ctx, calls, flush } = createContext({
			isRateLimited: false,
			statusHeader: "allowed",
			resetTime: 1_710_000_000_000,
			remaining: 17,
		});

		const outcome = await processProxyResponse(
			new Response("ok", { status: 200 }),
			account,
			ctx,
		);
		flush();

		expect(outcome).toBe("ok");
		expect(calls).toEqual(["updateAccountRateLimitMeta"]);
	});

	it("does not increment account usage when rejecting a rate-limited response", async () => {
		const account = createAccount();
		const { ctx, calls, flush } = createContext({
			isRateLimited: true,
			statusHeader: "rate_limited",
			resetTime: 1_710_000_000_000,
			remaining: 0,
		});

		const outcome = await processProxyResponse(
			new Response("rate limited", { status: 429 }),
			account,
			ctx,
		);
		flush();

		expect(outcome).toBe("rate-limited");
		expect(calls).toEqual([
			"markAccountRateLimited",
			"updateAccountRateLimitMeta",
		]);
	});

	it("does not back off the account for a request-level 429", async () => {
		const account = createAccount();
		const { ctx, calls, flush } = createContext({
			isRateLimited: true,
			statusHeader: "backoff",
			resetTime: 1_710_000_000_000,
			remaining: 0,
		});
		// Flag this 429 body as a request-level rejection.
		(
			ctx.provider as unknown as {
				isRequestLevelRateLimit: (body: string) => boolean;
			}
		).isRequestLevelRateLimit = (body: string) => body.includes("long context");

		const outcome = await processProxyResponse(
			new Response(
				JSON.stringify({
					type: "error",
					error: {
						type: "rate_limit_error",
						message: "Usage credits are required for long context requests.",
					},
				}),
				{ status: 429 },
			),
			account,
			ctx,
		);
		flush();

		expect(outcome).toBe("request-level-error");
		expect(calls).toEqual([]);
	});
});

describe("buildRequestLevelErrorResponse", () => {
	it("rewrites an upstream 429 as a non-retryable 400 preserving the body", async () => {
		const body = JSON.stringify({
			type: "error",
			error: {
				type: "rate_limit_error",
				message: "Usage credits are required for long context requests.",
			},
		});
		const rewritten = buildRequestLevelErrorResponse(
			new Response(body, { status: 429 }),
		);

		expect(rewritten.status).toBe(400);
		expect(await rewritten.text()).toBe(body);
	});
});
