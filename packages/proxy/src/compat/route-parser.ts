import type { AccountProvider } from "@ccflare/types";
import type { ModelFamilyAlias } from "./model-id";
import type { CompatibilityRouteKind } from "./types";

export const COMPAT_PROVIDER_ORDER: Record<
	ModelFamilyAlias,
	AccountProvider[]
> = {
	openai: ["codex", "openai"],
	anthropic: ["claude-code", "anthropic"],
};

export type ParsedCompatibilityRoute = {
	kind: CompatibilityRouteKind;
};

export function parseCompatibilityRoute(
	pathname: string,
): ParsedCompatibilityRoute | null {
	switch (pathname) {
		case "/v1/ccflare/anthropic/messages":
		// Alias: LiteLLM's Anthropic passthrough adapter appends `/v1/messages`
		// to the configured api_base, so an api_base of
		// `.../v1/ccflare/anthropic` yields this path. Accept it so callers can
		// point straight at the anthropic compat entry without a rewrite.
		case "/v1/ccflare/anthropic/v1/messages":
			return { kind: "anthropic-messages" };
		case "/v1/ccflare/openai/chat/completions":
			return { kind: "openai-chat-completions" };
		case "/v1/ccflare/openai/responses":
			return { kind: "openai-responses" };
		default:
			return null;
	}
}
