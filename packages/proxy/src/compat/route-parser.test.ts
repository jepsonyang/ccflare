import { describe, expect, it } from "bun:test";
import { parseCompatibilityRoute } from "./route-parser";

describe("parseCompatibilityRoute", () => {
	it("maps the anthropic messages path", () => {
		expect(parseCompatibilityRoute("/v1/ccflare/anthropic/messages")).toEqual({
			kind: "anthropic-messages",
		});
	});

	it("maps the LiteLLM passthrough alias (.../anthropic/v1/messages)", () => {
		// LiteLLM's Anthropic passthrough appends `/v1/messages` to api_base.
		expect(
			parseCompatibilityRoute("/v1/ccflare/anthropic/v1/messages"),
		).toEqual({ kind: "anthropic-messages" });
	});

	it("maps the openai chat + responses paths", () => {
		expect(
			parseCompatibilityRoute("/v1/ccflare/openai/chat/completions"),
		).toEqual({ kind: "openai-chat-completions" });
		expect(parseCompatibilityRoute("/v1/ccflare/openai/responses")).toEqual({
			kind: "openai-responses",
		});
	});

	it("returns null for unknown paths", () => {
		expect(parseCompatibilityRoute("/v1/ccflare/anthropic")).toBeNull();
		expect(parseCompatibilityRoute("/v1/messages")).toBeNull();
	});
});
