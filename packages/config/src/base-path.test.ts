import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Config, normalizeBasePath } from "./index";

describe("normalizeBasePath", () => {
	it("treats empty, undefined and '/' as disabled", () => {
		expect(normalizeBasePath(undefined)).toBe("");
		expect(normalizeBasePath("")).toBe("");
		expect(normalizeBasePath("   ")).toBe("");
		expect(normalizeBasePath("/")).toBe("");
	});

	it("ensures a single leading slash and strips trailing slashes", () => {
		expect(normalizeBasePath("ccflare")).toBe("/ccflare");
		expect(normalizeBasePath("/ccflare")).toBe("/ccflare");
		expect(normalizeBasePath("/ccflare/")).toBe("/ccflare");
		expect(normalizeBasePath("ccflare///")).toBe("/ccflare");
		expect(normalizeBasePath("/a/b/")).toBe("/a/b");
	});
});

describe("Config dashboardBasePath", () => {
	function withConfig(data: Record<string, unknown>): Config {
		const dir = mkdtempSync(join(tmpdir(), "ccflare-base-path-"));
		const path = join(dir, "config.json");
		writeFileSync(path, JSON.stringify(data));
		const config = new Config(path);
		rmSync(dir, { recursive: true, force: true });
		return config;
	}

	it("defaults to empty when unset", () => {
		expect(withConfig({ port: 4011 }).getRuntime().dashboardBasePath).toBe("");
	});

	it("reads and normalizes the configured prefix", () => {
		expect(
			withConfig({ dashboard_base_path: "ccflare/" }).getRuntime()
				.dashboardBasePath,
		).toBe("/ccflare");
	});
});
