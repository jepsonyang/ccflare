import { describe, expect, it } from "bun:test";
import { applyClaudeCodeShaping } from "./claude-code";

type TextBlock = { type: string; text: string; cache_control?: unknown };

function systemBlocks(request: Record<string, unknown>): TextBlock[] {
	return Array.isArray(request.system) ? (request.system as TextBlock[]) : [];
}

describe("applyClaudeCodeShaping", () => {
	it("prepends the identity blocks with billing header first", () => {
		const shaped = applyClaudeCodeShaping({
			model: "claude-sonnet-4-6",
			system: "Follow the repo conventions.",
			messages: [{ role: "user", content: "hi" }],
		});

		const blocks = systemBlocks(shaped);
		expect(blocks[0].text.startsWith("x-anthropic-billing-header:")).toBe(true);
		expect(blocks[1].text).toBe(
			"You are Claude Code, Anthropic's official CLI for Claude.",
		);
	});

	it("keeps the caller's system content instead of moving it into the first user message", () => {
		const shaped = applyClaudeCodeShaping({
			model: "claude-sonnet-4-6",
			system: "Follow the repo conventions.",
			messages: [{ role: "user", content: "hi" }],
		});

		const blocks = systemBlocks(shaped);
		expect(blocks.some((b) => b.text === "Follow the repo conventions.")).toBe(
			true,
		);
		// The first user message must be untouched (no prefixed system text).
		const messages = shaped.messages as Array<{ content: unknown }>;
		expect(messages[0].content).toBe("hi");
	});

	it("adds a cache_control breakpoint to the last system block when none is present", () => {
		const shaped = applyClaudeCodeShaping({
			model: "claude-sonnet-4-6",
			system: "Follow the repo conventions.",
			messages: [{ role: "user", content: "hi" }],
		});

		const blocks = systemBlocks(shaped);
		const last = blocks[blocks.length - 1];
		expect(last.text).toBe("Follow the repo conventions.");
		expect(last.cache_control).toEqual({ type: "ephemeral" });
		// Only one breakpoint should exist.
		expect(blocks.filter((b) => b.cache_control !== undefined).length).toBe(1);
	});

	it("preserves a cache_control breakpoint the caller already set", () => {
		const shaped = applyClaudeCodeShaping({
			model: "claude-sonnet-4-6",
			system: [
				{ type: "text", text: "block A" },
				{
					type: "text",
					text: "block B",
					cache_control: { type: "ephemeral" },
				},
				{ type: "text", text: "block C" },
			],
			messages: [{ role: "user", content: "hi" }],
		});

		const blocks = systemBlocks(shaped);
		// The caller's breakpoint stays on block B; we do not add another.
		const withCache = blocks.filter((b) => b.cache_control !== undefined);
		expect(withCache.length).toBe(1);
		expect(withCache[0].text).toBe("block B");
	});

	it("produces a stable billing header across identical system text", () => {
		const build = (payloadTail: string) =>
			applyClaudeCodeShaping({
				model: "claude-sonnet-4-6",
				system: "Follow the repo conventions.",
				// Different message bodies must NOT change the billing header, since
				// the cch is derived from system text, not the whole payload.
				messages: [{ role: "user", content: payloadTail }],
			});

		const first = systemBlocks(build("question one"))[0].text;
		const second = systemBlocks(build("a completely different question"))[0]
			.text;
		expect(first).toBe(second);
	});
});
