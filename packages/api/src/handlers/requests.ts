import type { DatabaseOperations } from "@ccflare/database";
import {
	errorResponse,
	InternalServerError,
	jsonResponse,
	NotFound,
} from "@ccflare/http";
import { Logger } from "@ccflare/logger";
import { parseRequestPayload } from "@ccflare/types";
import {
	enrichRequestPayload,
	serializeRequestResponse,
} from "../serializers/request";

const log = new Logger("RequestsHandler");

function parsePayloadRows(
	rows: Array<{ id: string; json: string; account_name: string | null }>,
) {
	return rows.flatMap((r) => {
		try {
			const data = parseRequestPayload({
				id: r.id,
				...JSON.parse(r.json),
			});
			if (!data) {
				log.warn(`Skipping malformed request payload ${r.id}`);
				return [];
			}

			return [
				enrichRequestPayload(
					data.id === r.id ? data : { ...data, id: r.id },
					r.account_name ?? null,
				),
			];
		} catch {
			log.warn(`Skipping unparsable request payload ${r.id}`);
			return [];
		}
	});
}

/**
 * Create a requests summary handler (existing functionality)
 */
export function createRequestsSummaryHandler(dbOps: DatabaseOperations) {
	return (limit: number = 50): Response => {
		try {
			return jsonResponse(
				dbOps.listRequestsWithAccountNames(limit).map(serializeRequestResponse),
			);
		} catch (error) {
			log.error("Failed to load request summaries", error);
			return errorResponse(
				InternalServerError("Failed to load request summaries"),
			);
		}
	};
}

/**
 * Strip the (potentially multi-MB) request/response bodies from a payload,
 * keeping headers and all metadata. The Request History list never renders
 * bodies — they are fetched on demand per row via the single-payload endpoint —
 * so shipping them in the bulk list is pure overhead that stalls the page.
 */
function stripPayloadBodies(
	payload: ReturnType<typeof parsePayloadRows>[number],
): ReturnType<typeof parsePayloadRows>[number] {
	return {
		...payload,
		request: { ...payload.request, body: null },
		response: payload.response
			? { ...payload.response, body: null }
			: payload.response,
	};
}

/**
 * Create a detailed requests handler for the history list. Bodies are stripped
 * (see {@link stripPayloadBodies}); use the single-payload endpoint to fetch a
 * full body on demand.
 */
export function createRequestsDetailHandler(dbOps: DatabaseOperations) {
	return (limit = 100): Response => {
		try {
			return jsonResponse(
				parsePayloadRows(dbOps.listRequestPayloadsWithAccountNames(limit)).map(
					stripPayloadBodies,
				),
			);
		} catch (error) {
			log.error("Failed to load request details", error);
			return errorResponse(
				InternalServerError("Failed to load request details"),
			);
		}
	};
}

/**
 * Create a single-request detail handler returning the full payload WITH
 * bodies. Backs the on-demand fetch when a user opens a request's details or
 * copies it as JSON.
 */
export function createRequestDetailHandler(dbOps: DatabaseOperations) {
	return (requestId: string): Response => {
		try {
			const row = dbOps.getRequestPayloadWithAccountName(requestId);
			if (!row) {
				return errorResponse(NotFound("Request payload not found"));
			}
			const [payload] = parsePayloadRows([row]);
			if (!payload) {
				return errorResponse(NotFound("Request payload not found"));
			}
			return jsonResponse(payload);
		} catch (error) {
			log.error("Failed to load request detail", error);
			return errorResponse(
				InternalServerError("Failed to load request detail"),
			);
		}
	};
}

export function createRequestsConversationHandler(dbOps: DatabaseOperations) {
	return (requestId: string): Response => {
		try {
			const rows = dbOps.listResponseChainPayloadsWithAccountNames(requestId);
			if (rows.length === 0) {
				return errorResponse(NotFound("Request conversation not found"));
			}

			return jsonResponse(parsePayloadRows(rows));
		} catch (error) {
			log.error("Failed to load request conversation", error);
			return errorResponse(
				InternalServerError("Failed to load request conversation"),
			);
		}
	};
}
