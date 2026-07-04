import { describe, expect, it } from "bun:test";
import { type AccountRow, toAccount } from "./account-row";

describe("toAccount", () => {
	it("maps weight, auth_method, base_url, and nullable refresh_token", () => {
		const row: AccountRow = {
			id: "account-1",
			name: "OpenAI API Key",
			provider: "openai",
			auth_method: "api_key",
			base_url: "https://example.com/v1",
			api_key: "sk-test",
			refresh_token: null,
			access_token: null,
			expires_at: null,
			created_at: 123,
			last_used: 456,
			request_count: 2,
			total_requests: 9,
			rate_limited_until: null,
			session_start: null,
			session_request_count: 0,
			weight: 5,
			paused: 0,
			rate_limit_reset: null,
			rate_limit_status: null,
			rate_limit_remaining: null,
		};

		expect(toAccount(row)).toEqual({
			id: "account-1",
			name: "OpenAI API Key",
			provider: "openai",
			auth_method: "api_key",
			base_url: "https://example.com/v1",
			api_key: "sk-test",
			refresh_token: null,
			access_token: null,
			expires_at: null,
			created_at: 123,
			last_used: 456,
			request_count: 2,
			total_requests: 9,
			rate_limited_until: null,
			session_start: null,
			session_request_count: 0,
			weight: 5,
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
		});
	});

	it("parses a stored refresh_schedule JSON column", () => {
		const row: AccountRow = {
			id: "account-2",
			name: "Claude",
			provider: "anthropic",
			auth_method: "oauth",
			base_url: null,
			api_key: null,
			refresh_token: "r",
			access_token: "a",
			expires_at: null,
			created_at: 1,
			last_used: null,
			request_count: 0,
			total_requests: 0,
			weight: 1,
			refresh_schedule: JSON.stringify({
				enabled: true,
				times: ["17:30", "05:00"],
			}),
		};

		expect(toAccount(row).refresh_schedule).toEqual({
			enabled: true,
			times: ["05:00", "17:30"],
		});
	});
});
