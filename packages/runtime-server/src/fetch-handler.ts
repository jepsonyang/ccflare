import type { APIRouter } from "@ccflare/api";
import { HTTP_STATUS } from "@ccflare/core";
import { errorResponse } from "@ccflare/http";
import {
	handleCompatibilityProxy,
	handleProxy,
	handleWebSocketUpgradeRequest,
	isWebSocketUpgradeRequest,
	type ProxyContext,
	type WebSocketProxyData,
} from "@ccflare/proxy";
import { serveDashboardRoute } from "./dashboard-assets";

type ServerFetchHandlerDependencies = {
	apiRouter: Pick<APIRouter, "handleRequest">;
	proxyContext: ProxyContext;
	withDashboard: boolean;
	basePath?: string;
	handleProxyRequest?: typeof handleProxy;
	handleCompatibilityRequest?: typeof handleCompatibilityProxy;
	handleWebSocketUpgrade?: typeof handleWebSocketUpgradeRequest;
	serveDashboardAsset?: (url: URL, basePath: string) => Response | null;
};

function notFound(): Response {
	return new Response("Not Found", { status: HTTP_STATUS.NOT_FOUND });
}

function isProxyPath(pathname: string): boolean {
	return pathname === "/v1" || pathname.startsWith("/v1/");
}

/**
 * Resolve the URL used for dashboard + management-API routing.
 *
 * - When no base path is configured, the dashboard/API live at the root and the
 *   original URL is returned unchanged.
 * - When a base path is configured, only requests under that prefix are eligible;
 *   the prefix is stripped so downstream routing stays root-relative. Requests
 *   outside the prefix return `null` so the dashboard/API are not exposed at root.
 */
function resolveDashboardUrl(url: URL, basePath: string): URL | null {
	if (!basePath) {
		return url;
	}
	if (url.pathname === basePath || url.pathname.startsWith(`${basePath}/`)) {
		const stripped = new URL(url);
		stripped.pathname = url.pathname.slice(basePath.length) || "/";
		return stripped;
	}
	return null;
}

export function createServerFetchHandler({
	apiRouter,
	proxyContext,
	withDashboard,
	basePath = "",
	handleProxyRequest = handleProxy,
	handleCompatibilityRequest = handleCompatibilityProxy,
	handleWebSocketUpgrade = handleWebSocketUpgradeRequest,
	serveDashboardAsset = serveDashboardRoute,
}: ServerFetchHandlerDependencies) {
	return async (
		req: Request,
		server?: Bun.Server<WebSocketProxyData>,
	): Promise<Response | undefined> => {
		const url = new URL(req.url);

		// ---- Dashboard + management API, served under the (optional) base path ----
		// The LLM proxy is never reachable here: `/v1/*` is excluded so that
		// `/{basePath}/v1/*` returns 404 instead of forwarding upstream.
		const dashUrl = resolveDashboardUrl(url, basePath);
		if (dashUrl && !isProxyPath(dashUrl.pathname)) {
			const apiResponse = await apiRouter.handleRequest(dashUrl, req);
			if (apiResponse) {
				return apiResponse;
			}

			if (withDashboard && (req.method === "GET" || req.method === "HEAD")) {
				const dashboardResponse = serveDashboardAsset(dashUrl, basePath);
				if (dashboardResponse) {
					return dashboardResponse;
				}
			}

			// Under an explicit prefix the dashboard/API namespace is closed.
			if (basePath) {
				return notFound();
			}
		}

		// ---- Proxy / compatibility / websocket: always at the root path ----
		if (url.pathname.startsWith("/v1/ccflare/")) {
			const compatibilityResponse = await handleCompatibilityRequest(
				req,
				url,
				proxyContext,
			);
			if (compatibilityResponse) {
				return compatibilityResponse;
			}
		}

		if (isProxyPath(url.pathname)) {
			if (server) {
				const websocketResponse = await handleWebSocketUpgrade(
					req,
					url,
					proxyContext,
					server,
				);
				if (websocketResponse) {
					return websocketResponse;
				}
				if (isWebSocketUpgradeRequest(req)) {
					return;
				}
			}

			try {
				return await handleProxyRequest(req, url, proxyContext);
			} catch (error) {
				return errorResponse(error);
			}
		}

		return notFound();
	};
}
