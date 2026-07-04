import type { Account, RequestMeta } from "@ccflare/types";
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
	// header), restrict selection to the union of those groups. With no header,
	// use every available account (groups are opt-in subsets, not an exclusive
	// partition).
	const groups = meta.accountGroups;
	const providerAccounts =
		groups && groups.length > 0
			? ctx.dbOps.getAvailableAccountsByProviderAndGroups(
					ctx.providerName,
					groups,
				)
			: ctx.dbOps.getAvailableAccountsByProvider(ctx.providerName);
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
