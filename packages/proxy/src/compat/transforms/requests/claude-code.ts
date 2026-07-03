import * as nodeCrypto from "node:crypto";
import { isRecord } from "@ccflare/types";
import type { JsonRecord } from "../../types";
import { buildAnthropicTextBlock } from "../content-parts";

const CLAUDE_CODE_VERSION = "2.1.63";
const CLAUDE_CODE_FINGERPRINT_SALT = "59cf53e54c78";
const CLAUDE_CODE_PROMPT = [
	"You are Claude Code, Anthropic's official CLI for Claude.",
	"You help with code changes, debugging, and repo-aware development tasks.",
	"Be concise, direct, and action-oriented.",
].join("\n\n");

const EPHEMERAL_CACHE_CONTROL = { type: "ephemeral" } as const;

function computeClaudeCodeFingerprint(messageText: string, version: string) {
	const chars = [4, 7, 20].map((index) => messageText[index] ?? "0").join("");
	return nodeCrypto
		.createHash("sha256")
		.update(`${CLAUDE_CODE_FINGERPRINT_SALT}${chars}${version}`)
		.digest("hex")
		.slice(0, 3);
}

/**
 * Build the Claude Code billing header text block.
 *
 * The `cch` component is derived from the system text (which is stable across
 * the requests of a session) rather than the full request payload. Hashing the
 * whole payload made this block change on every request, which poisoned the
 * prompt-cache prefix and forced Anthropic to re-bill the entire system + tools
 * on every call. Keeping it stable lets the injected identity blocks and the
 * caller's system stay byte-identical across turns so the cache breakpoint hits.
 */
function buildClaudeCodeBillingHeader(systemText: string) {
	const fingerprint = computeClaudeCodeFingerprint(
		systemText,
		CLAUDE_CODE_VERSION,
	);
	const cch = nodeCrypto
		.createHash("sha256")
		.update(systemText)
		.digest("hex")
		.slice(0, 5);
	return `x-anthropic-billing-header: cc_version=${CLAUDE_CODE_VERSION}.${fingerprint}; cc_entrypoint=cli; cch=${cch};`;
}

/**
 * Normalize the caller's `system` into an array of Anthropic content blocks,
 * preserving any `cache_control` breakpoints the client already set.
 */
function normalizeSystemBlocks(system: unknown): JsonRecord[] {
	if (typeof system === "string") {
		return system ? [buildAnthropicTextBlock(system)] : [];
	}
	if (Array.isArray(system)) {
		return system
			.map((block) => {
				if (typeof block === "string") {
					return block ? buildAnthropicTextBlock(block) : null;
				}
				if (isRecord(block) && typeof block.text === "string") {
					// Preserve the block as-is (keeps any cache_control the client set).
					return block as JsonRecord;
				}
				return null;
			})
			.filter((block): block is JsonRecord => block !== null);
	}
	return [];
}

/** Whether any system block carries a cache_control breakpoint. */
function hasCacheBreakpoint(blocks: JsonRecord[]): boolean {
	return blocks.some((block) => isRecord(block) && "cache_control" in block);
}

/**
 * Shape a request so it is accepted as a Claude Code OAuth call while
 * preserving prompt caching.
 *
 * The upstream requires the Claude Code identity system blocks (a bare
 * `/v1/messages` OAuth request without them is rejected with 429), so we prepend
 * those. The caller's own system is appended *after* the identity blocks (rather
 * than being dropped or moved into the first user message) so its content — and
 * any cache_control breakpoint — reaches Anthropic. If the caller supplied no
 * breakpoint (e.g. requests arriving through the OpenAI compat path, which does
 * not carry cache_control), we add one to the last system block so the whole
 * system prefix becomes cacheable.
 */
export function applyClaudeCodeShaping(request: JsonRecord): JsonRecord {
	const callerSystem = normalizeSystemBlocks(request.system);
	const systemText = callerSystem
		.map((block) => (typeof block.text === "string" ? block.text : ""))
		.join("");
	const billingHeader = buildClaudeCodeBillingHeader(systemText);

	// Ensure the system prefix is cacheable: if the caller did not mark a
	// breakpoint, mark the final system block as ephemeral.
	if (callerSystem.length > 0 && !hasCacheBreakpoint(callerSystem)) {
		const lastIndex = callerSystem.length - 1;
		callerSystem[lastIndex] = {
			...callerSystem[lastIndex],
			cache_control: EPHEMERAL_CACHE_CONTROL,
		};
	}

	const system: JsonRecord[] = [
		buildAnthropicTextBlock(billingHeader),
		buildAnthropicTextBlock(
			"You are Claude Code, Anthropic's official CLI for Claude.",
		),
		buildAnthropicTextBlock(CLAUDE_CODE_PROMPT),
		...callerSystem,
	];

	return {
		...request,
		system,
	};
}
