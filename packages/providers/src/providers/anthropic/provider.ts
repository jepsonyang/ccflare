import { BUFFER_SIZES } from "@ccflare/core";
import {
	type Account,
	getProviderDefaultBaseUrl,
	isRecord,
	RATE_LIMIT_BACKOFF_STATUS,
} from "@ccflare/types";
import { BaseProvider, deleteTransportHeaders } from "../../base";
import type { RateLimitInfo } from "../../types";

// Hard rate limit statuses that should block account usage
const HARD_LIMIT_STATUSES = new Set([
	"rate_limited",
	"blocked",
	"queueing_hard",
	"payment_required",
]);

// Soft warning statuses that should not block account usage
const _SOFT_WARNING_STATUSES = new Set(["allowed_warning", "queueing_soft"]);
const PROVIDER_NAME = "anthropic" as const;
const DEFAULT_BASE_URL = getProviderDefaultBaseUrl(PROVIDER_NAME);

/**
 * Normalize a unified utilization header to a 0-100 percentage.
 * Accepts both fractional (0.0-1.0) and percentage (0-100) scales.
 */
function parseUtilization(raw: string | null): number | undefined {
	if (raw == null) return undefined;
	const n = Number(raw);
	if (!Number.isFinite(n)) return undefined;
	const pct = n <= 1 ? n * 100 : n;
	return Math.min(100, Math.max(0, pct));
}

/** Convert a unix-seconds reset header to ms epoch. */
function parseResetSeconds(raw: string | null): number | undefined {
	if (raw == null) return undefined;
	const n = Number(raw);
	return Number.isFinite(n) ? n * 1000 : undefined;
}

/**
 * Parse an HTTP `Retry-After` header to an absolute ms epoch reset time.
 * Supports both the delay-seconds form (e.g. "12") and the HTTP-date form.
 * Returns undefined when the header is absent or unparseable.
 */
function parseRetryAfter(raw: string | null): number | undefined {
	if (raw == null) return undefined;
	const trimmed = raw.trim();
	if (trimmed === "") return undefined;

	// delay-seconds form: a non-negative integer number of seconds from now.
	if (/^\d+$/.test(trimmed)) {
		return Date.now() + Number(trimmed) * 1000;
	}

	// HTTP-date form: an absolute timestamp.
	const dateMs = Date.parse(trimmed);
	return Number.isNaN(dateMs) ? undefined : dateMs;
}

/** Read the unified utilization windows from response headers. */
function parseUnifiedWindows(response: Response): {
	fiveHourUtilization?: number;
	fiveHourResetTime?: number;
	sevenDayUtilization?: number;
	sevenDayResetTime?: number;
	// Fable weekly bucket (per-model). Only returned when Fable is actually
	// used, mirroring the official "You haven't used Fable yet" state.
	fableUtilization?: number;
	fableResetTime?: number;
	representativeClaim?: string;
} {
	return {
		...(() => {
			const v = parseUtilization(
				response.headers.get("anthropic-ratelimit-unified-5h-utilization"),
			);
			return v !== undefined ? { fiveHourUtilization: v } : {};
		})(),
		...(() => {
			const v = parseResetSeconds(
				response.headers.get("anthropic-ratelimit-unified-5h-reset"),
			);
			return v !== undefined ? { fiveHourResetTime: v } : {};
		})(),
		...(() => {
			const v = parseUtilization(
				response.headers.get("anthropic-ratelimit-unified-7d-utilization"),
			);
			return v !== undefined ? { sevenDayUtilization: v } : {};
		})(),
		...(() => {
			const v = parseResetSeconds(
				response.headers.get("anthropic-ratelimit-unified-7d-reset"),
			);
			return v !== undefined ? { sevenDayResetTime: v } : {};
		})(),
		...(() => {
			const v = parseUtilization(
				response.headers.get("anthropic-ratelimit-unified-7d_oi-utilization"),
			);
			return v !== undefined ? { fableUtilization: v } : {};
		})(),
		...(() => {
			const v = parseResetSeconds(
				response.headers.get("anthropic-ratelimit-unified-7d_oi-reset"),
			);
			return v !== undefined ? { fableResetTime: v } : {};
		})(),
		...(() => {
			const v = response.headers.get(
				"anthropic-ratelimit-unified-representative-claim",
			);
			return v ? { representativeClaim: v } : {};
		})(),
	};
}

function parseAnthropicUsage(value: unknown):
	| {
			input_tokens?: number;
			output_tokens?: number;
			cache_creation_input_tokens?: number;
			cache_read_input_tokens?: number;
	  }
	| undefined {
	if (!isRecord(value)) {
		return undefined;
	}

	const parsedUsage = {
		...(typeof value.input_tokens === "number" && {
			input_tokens: value.input_tokens,
		}),
		...(typeof value.output_tokens === "number" && {
			output_tokens: value.output_tokens,
		}),
		...(typeof value.cache_creation_input_tokens === "number" && {
			cache_creation_input_tokens: value.cache_creation_input_tokens,
		}),
		...(typeof value.cache_read_input_tokens === "number" && {
			cache_read_input_tokens: value.cache_read_input_tokens,
		}),
	};

	return Object.keys(parsedUsage).length > 0 ? parsedUsage : undefined;
}

function parseAnthropicMessageEnvelope(value: unknown): {
	message?: {
		model?: string;
		usage?: {
			input_tokens?: number;
			output_tokens?: number;
			cache_creation_input_tokens?: number;
			cache_read_input_tokens?: number;
		};
	};
} | null {
	if (!isRecord(value)) {
		return null;
	}

	const usage = parseAnthropicUsage(
		value.message && isRecord(value.message) ? value.message.usage : undefined,
	);
	return {
		...(isRecord(value.message) && {
			message: {
				...(typeof value.message.model === "string" && {
					model: value.message.model,
				}),
				...(usage && { usage }),
			},
		}),
	};
}

export class AnthropicProvider extends BaseProvider {
	name: string = PROVIDER_NAME;
	defaultBaseUrl: string = DEFAULT_BASE_URL;

	prepareHeaders(headers: Headers, account: Account | null): Headers {
		const newHeaders = new Headers(headers);

		if (account?.api_key) {
			newHeaders.set("x-api-key", account.api_key);
		}

		deleteTransportHeaders(newHeaders);

		return newHeaders;
	}

	parseRateLimit(response: Response): RateLimitInfo {
		// Unified utilization windows are returned on normal responses too,
		// so always read them and merge into whichever branch we return.
		const windows = parseUnifiedWindows(response);

		// Check for unified rate limit headers
		const statusHeader = response.headers.get(
			"anthropic-ratelimit-unified-status",
		);
		const resetHeader = response.headers.get(
			"anthropic-ratelimit-unified-reset",
		);
		const remainingHeader = response.headers.get(
			"anthropic-ratelimit-unified-remaining",
		);

		if (statusHeader || resetHeader) {
			const resetTime = resetHeader ? Number(resetHeader) * 1000 : undefined; // Convert to ms
			const remaining = remainingHeader ? Number(remainingHeader) : undefined;

			// Only mark as rate limited for hard limit statuses or 429
			const isRateLimited =
				HARD_LIMIT_STATUSES.has(statusHeader || "") || response.status === 429;

			return {
				isRateLimited,
				resetTime,
				statusHeader: statusHeader || undefined,
				remaining,
				...windows,
			};
		}

		// Fall back to 429 status with x-ratelimit-reset header
		if (response.status !== 429) {
			return { isRateLimited: false, ...windows };
		}

		// Prefer the standard `retry-after` header Anthropic returns for short
		// request-rate backoffs (relative seconds, or an HTTP-date). Fall back to
		// the absolute `x-ratelimit-reset` header, then to a 1-minute default.
		const resetTime =
			parseRetryAfter(response.headers.get("retry-after")) ??
			parseResetSeconds(response.headers.get("x-ratelimit-reset")) ??
			Date.now() + 60000; // Default to 1 minute

		// A plain 429 with no unified window headers is a short request-rate
		// backoff, not a 5h/7d quota exhaustion. Tag it so the UI can surface
		// the remaining backoff time.
		return {
			isRateLimited: true,
			resetTime,
			statusHeader: RATE_LIMIT_BACKOFF_STATUS,
			...windows,
		};
	}

	isRequestLevelRateLimit(body: string): boolean {
		if (!body) return false;

		// Anthropic reuses the 429 status + `rate_limit_error` type for
		// request-level rejections such as a 1M long-context request that
		// requires usage credits ("Usage credits are required for long context
		// requests."). These are not account-level limits, so the reason lives
		// in the body message rather than in any ratelimit header.
		let message = body;
		try {
			const parsed = JSON.parse(body);
			if (isRecord(parsed) && isRecord(parsed.error)) {
				const m = parsed.error.message;
				if (typeof m === "string") message = m;
			}
		} catch {
			// Not JSON; fall back to scanning the raw body text.
		}

		return /long context/i.test(message);
	}

	async extractUsageInfo(response: Response): Promise<{
		model?: string;
		promptTokens?: number;
		completionTokens?: number;
		totalTokens?: number;
		costUsd?: number;
		inputTokens?: number;
		cacheReadInputTokens?: number;
		cacheCreationInputTokens?: number;
		outputTokens?: number;
	} | null> {
		try {
			const clone = response.clone();
			const contentType = response.headers.get("content-type");

			// Handle streaming responses (SSE)
			if (contentType?.includes("text/event-stream")) {
				// Use bounded reader to avoid consuming entire stream
				const reader = clone.body?.getReader();
				if (!reader) return null;

				let buffered = "";
				const maxBytes = BUFFER_SIZES.ANTHROPIC_STREAM_CAP_BYTES;
				const decoder = new TextDecoder();
				let foundMessageStart = false;

				try {
					while (buffered.length < maxBytes) {
						const { value, done } = await reader.read();
						if (done) break;

						buffered += decoder.decode(value, { stream: true });

						// Check if we have the message_start event
						if (buffered.includes("event: message_start")) {
							foundMessageStart = true;
							// Read a bit more to ensure we get the data line
							const { value: nextValue, done: nextDone } = await reader.read();
							if (!nextDone && nextValue) {
								buffered += decoder.decode(nextValue, { stream: true });
							}
							break;
						}
					}
				} finally {
					// Cancel the reader to prevent hanging
					reader.cancel().catch(() => {});
				}

				if (!foundMessageStart) return null;

				// Parse the buffered content
				const lines = buffered.split("\n");

				// Parse SSE events
				for (let i = 0; i < lines.length; i++) {
					const line = lines[i];
					if (line.startsWith("event: message_start")) {
						// Next line should be the data
						const dataLine = lines[i + 1];
						if (dataLine?.startsWith("data: ")) {
							try {
								const jsonStr = dataLine.slice(6); // Remove "data: " prefix
								const data = parseAnthropicMessageEnvelope(JSON.parse(jsonStr));

								if (data?.message?.usage) {
									const usage = data.message.usage;
									const inputTokens = usage.input_tokens ?? 0;
									const cacheCreationInputTokens =
										usage.cache_creation_input_tokens ?? 0;
									const cacheReadInputTokens =
										usage.cache_read_input_tokens ?? 0;
									const outputTokens = usage.output_tokens ?? 0;
									const promptTokens =
										inputTokens +
										cacheCreationInputTokens +
										cacheReadInputTokens;
									const completionTokens = outputTokens;
									const totalTokens = promptTokens + completionTokens;

									// Extract cost from header if available
									const costHeader = response.headers.get(
										"anthropic-billing-cost",
									);
									const costUsd = costHeader
										? parseFloat(costHeader)
										: undefined;

									return {
										model: data.message.model,
										promptTokens,
										completionTokens,
										totalTokens,
										costUsd,
										inputTokens,
										cacheReadInputTokens,
										cacheCreationInputTokens,
										outputTokens,
									};
								}
							} catch {
								// Ignore parse errors
							}
						}
					}
				}

				// For streaming responses, we only extract initial usage
				// Output tokens will be accumulated during streaming but we can't capture that here
				return null;
			} else {
				// Handle non-streaming JSON responses
				const rawJson = await clone.json();
				const json = isRecord(rawJson)
					? {
							model:
								typeof rawJson.model === "string" ? rawJson.model : undefined,
							usage: parseAnthropicUsage(rawJson.usage),
						}
					: null;

				if (!json?.usage) return null;

				const inputTokens = json.usage.input_tokens ?? 0;
				const cacheCreationInputTokens =
					json.usage.cache_creation_input_tokens ?? 0;
				const cacheReadInputTokens = json.usage.cache_read_input_tokens ?? 0;
				const outputTokens = json.usage.output_tokens ?? 0;
				const promptTokens =
					inputTokens + cacheCreationInputTokens + cacheReadInputTokens;
				const completionTokens = outputTokens;
				const totalTokens = promptTokens + completionTokens;

				// Extract cost from header if available
				const costHeader = response.headers.get("anthropic-billing-cost");
				const costUsd = costHeader ? parseFloat(costHeader) : undefined;

				return {
					model: json.model,
					promptTokens,
					completionTokens,
					totalTokens,
					costUsd,
					inputTokens,
					cacheReadInputTokens,
					cacheCreationInputTokens,
					outputTokens,
				};
			}
		} catch {
			// Ignore parsing errors
			return null;
		}
	}
}
