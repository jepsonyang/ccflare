import {
	type Account,
	DEFAULT_GROUP_NAME,
	type RequestMeta,
} from "@ccflare/types";
import type { ResolvedProxyContext } from "./proxy-types";

/**
 * Gets accounts ordered by the load balancing strategy
 * @param meta - Request metadata
 * @param ctx - The proxy context
 * @returns Array of ordered accounts
 */
export function getOrderedAccounts(
	meta: RequestMeta,
	ctx: ResolvedProxyContext,
): Account[] {
	// When the request carries account-groups (via the `x-ccflare-group`
	// header), restrict selection to the union of those groups. The literal
	// "default" (case-insensitive) includes the ungrouped pool. With no header,
	// use the default pool only (groups are exclusive).
	const groups = meta.accountGroups;
	let providerAccounts: Account[];
	if (groups && groups.length > 0) {
		const includeDefault = groups.some(
			(g) => g.toLowerCase() === DEFAULT_GROUP_NAME,
		);
		const explicit = groups.filter(
			(g) => g.toLowerCase() !== DEFAULT_GROUP_NAME,
		);
		providerAccounts = ctx.dbOps.getAvailableAccountsByProviderAndGroups(
			ctx.providerName,
			explicit,
			includeDefault,
		);
	} else {
		providerAccounts = ctx.dbOps.getAvailableAccountsByProvider(
			ctx.providerName,
		);
	}
	return ctx.strategy.select(providerAccounts, meta);
}

/**
 * Selects accounts for a request based on the load balancing strategy
 * @param meta - Request metadata
 * @param ctx - The proxy context
 * @returns Array of selected accounts
 */
export function selectAccountsForRequest(
	meta: RequestMeta,
	ctx: ResolvedProxyContext,
): Account[] {
	return getOrderedAccounts(meta, ctx);
}
