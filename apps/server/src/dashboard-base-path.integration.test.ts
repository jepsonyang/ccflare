import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import startServer, { type ServerHandle } from "@ccflare/runtime-server";

const ENV_KEYS = [
	"DASHBOARD_BASE_PATH",
	"ccflare_CONFIG_PATH",
	"ccflare_DB_PATH",
] as const;

describe("DASHBOARD_BASE_PATH integration", () => {
	let server: ServerHandle | null = null;
	let tempDir: string | null = null;
	const saved: Record<string, string | undefined> = {};

	afterEach(async () => {
		if (server) {
			await server.stop();
			server = null;
		}
		if (tempDir) {
			// Best-effort: on Windows the SQLite file can stay briefly locked right
			// after shutdown, so retry and never fail the test on cleanup.
			try {
				rmSync(tempDir, {
					recursive: true,
					force: true,
					maxRetries: 5,
					retryDelay: 100,
				});
			} catch {
				// leave the temp dir for the OS to reap
			}
			tempDir = null;
		}
		for (const key of ENV_KEYS) {
			if (saved[key] === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = saved[key];
			}
		}
	});

	it("mounts the dashboard/API under the env-configured prefix and hardens the proxy", async () => {
		for (const key of ENV_KEYS) {
			saved[key] = process.env[key];
		}

		tempDir = mkdtempSync(join(tmpdir(), "ccflare-base-path-int-"));
		process.env.ccflare_CONFIG_PATH = join(tempDir, "ccflare.json");
		process.env.ccflare_DB_PATH = join(tempDir, "ccflare.db");
		// The env var is the path under test: it must be honored by the running
		// server (not only the config file).
		process.env.DASHBOARD_BASE_PATH = "/ccflare";

		server = startServer({ port: 0, withDashboard: false });
		const base = `http://localhost:${server.port}`;

		const status = async (method: string, path: string): Promise<number> =>
			(await fetch(`${base}${path}`, { method })).status;

		// Management API is served under the prefix...
		expect(await status("GET", "/ccflare/health")).toBe(200);
		// ...and is no longer exposed at the root.
		expect(await status("GET", "/health")).toBe(404);
		// The LLM proxy is never reachable under the dashboard prefix.
		expect(await status("POST", "/ccflare/v1/anthropic/v1/messages")).toBe(404);
	});
});
