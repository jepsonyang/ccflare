import type { AuthMethod, OAuthProvider } from "./provider-metadata";
import type { HttpMethod } from "./request";
import type { StrategyName } from "./strategy";

export interface RequestMeta {
	id: string;
	method: HttpMethod;
	path: string;
	timestamp: number;
	// Account-group names parsed from the `x-ccflare-group` request header
	// (pipe-separated, e.g. "teamA|teamB"). When set, account selection is
	// restricted to the union of these groups; the literal "default" includes
	// the ungrouped pool. When unset, the default pool is used.
	accountGroups?: string[];
}

/**
 * Standard envelope for all mutation (write) API responses.
 * Every POST/PATCH/DELETE handler returns this shape.
 */
export interface MutationResult<TData = undefined> {
	success: boolean;
	message: string;
	data?: TData;
}

// Retention and maintenance API shapes
export interface RetentionGetResponse {
	payloadDays: number;
	requestDays: number;
}

export interface RetentionSetRequest {
	payloadDays?: number;
	requestDays?: number;
}

export interface CleanupResponse {
	removedRequests: number;
	removedPayloads: number;
	cutoffIso: string;
}

// Auth/OAuth API shapes
export type AuthSessionStatus = "pending" | "completed" | "expired";

export interface AuthSessionStatusResponse {
	status: AuthSessionStatus;
}

export interface AuthInitData {
	authUrl: string;
	sessionId: string;
	provider: OAuthProvider;
}

export interface AuthCompleteData {
	provider: OAuthProvider;
}

// Account mutation data shapes
export interface AccountCreateData {
	accountId: string;
	weight: number;
	authMethod: AuthMethod;
}

export interface AccountUpdateData {
	accountId: string;
	name: string;
	baseUrl: string | null;
}

export interface AccountDeleteData {
	accountId: string;
}

export interface AccountPauseData {
	paused: boolean;
}

export interface AccountRenameData {
	newName: string;
}

// Account-group mutation payloads (mirror the Account* shapes above).
export interface GroupCreateData {
	groupId: string;
	name: string;
}

export interface GroupUpdateData {
	groupId: string;
	name: string;
	description: string | null;
}

export interface GroupDeleteData {
	groupId: string;
}

export interface StrategyResponse {
	strategy: StrategyName;
}
