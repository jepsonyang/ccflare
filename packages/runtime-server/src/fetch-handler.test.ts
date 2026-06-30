import { describe, expect, it } from "bun:test";
import type { ProxyContext } from "@ccflare/proxy";
import { createServerFetchHandler } from "./fetch-handler";

type Call = { kind: string; pathname: string };

function makeHandler(basePath: string) {
	const calls: Call[] = [];

	const handler = createServerFetchHandler({
		apiRouter: {
			handleRequest: async (url) => {
				if (url.pathname.startsWith("/api/") || url.pathname === "/health") {
					calls.push({ kind: "api", pathname: url.pathname });
					return new Response("api", { status: 200 });
				}
				return null;
			},
		},
		proxyContext: {} as ProxyContext,
		withDashboard: true,
		basePath,
		handleProxyRequest: async (_req, url) => {
			calls.push({ kind: "proxy", pathname: url.pathname });
			return new Response("proxy", { status: 200 });
		},
		handleCompatibilityRequest: async (_req, url) => {
			calls.push({ kind: "compat", pathname: url.pathname });
			return new Response("compat", { status: 200 });
		},
		serveDashboardAsset: (url) => {
			calls.push({ kind: "dashboard", pathname: url.pathname });
			return new Response("dashboard", { status: 200 });
		},
	});

	const run = (path: string, method = "GET") =>
		handler(new Request(`http://localhost:8080${path}`, { method }));

	return { run, calls };
}

describe("createServerFetchHandler with a dashboard base path", () => {
	it("routes prefixed API requests with the prefix stripped", async () => {
		const { run, calls } = makeHandler("/ccflare");
		const res = await run("/ccflare/api/stats");
		expect(res?.status).toBe(200);
		expect(calls).toEqual([{ kind: "api", pathname: "/api/stats" }]);
	});

	it("serves the dashboard under the prefix", async () => {
		const { run, calls } = makeHandler("/ccflare");
		const res = await run("/ccflare/accounts");
		expect(res?.status).toBe(200);
		expect(calls).toEqual([{ kind: "dashboard", pathname: "/accounts" }]);
	});

	it("never exposes the proxy under the dashboard prefix", async () => {
		const { run, calls } = makeHandler("/ccflare");
		const res = await run("/ccflare/v1/anthropic/v1/messages", "POST");
		expect(res?.status).toBe(404);
		expect(calls).toEqual([]);
	});

	it("keeps the proxy working at the root path", async () => {
		const { run, calls } = makeHandler("/ccflare");
		const res = await run("/v1/anthropic/v1/messages", "POST");
		expect(res?.status).toBe(200);
		expect(calls).toEqual([
			{ kind: "proxy", pathname: "/v1/anthropic/v1/messages" },
		]);
	});

	it("does not expose the dashboard/API at the root when a prefix is set", async () => {
		const { run, calls } = makeHandler("/ccflare");
		const res = await run("/api/stats");
		expect(res?.status).toBe(404);
		expect(calls).toEqual([]);
	});
});

describe("createServerFetchHandler without a base path", () => {
	it("routes API and proxy at the root (unchanged behavior)", async () => {
		const { run, calls } = makeHandler("");
		expect((await run("/api/stats"))?.status).toBe(200);
		expect((await run("/v1/openai/responses", "POST"))?.status).toBe(200);
		expect(calls).toEqual([
			{ kind: "api", pathname: "/api/stats" },
			{ kind: "proxy", pathname: "/v1/openai/responses" },
		]);
	});
});
