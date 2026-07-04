import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { Account } from "@ccflare/types";

// Capture refreshAccountUsage calls without hitting the network.
const refreshCalls: Account[] = [];
mock.module("@ccflare/api", () => ({
	refreshAccountUsage: async (account: Account) => {
		refreshCalls.push(account);
		return { ok: true as const };
	},
}));

const { _runTickForTest, _localHhMmForTest } = await import(
	"./refresh-scheduler"
);

const log = {
	info: () => {},
	warn: () => {},
	error: () => {},
} as unknown as import("@ccflare/logger").Logger;

function account(name: string, schedule: Account["refresh_schedule"]): Account {
	return {
		name,
		auth_method: "oauth",
		refresh_schedule: schedule,
	} as Account;
}

function fakeDbOps(accounts: Account[]) {
	return { getAllAccounts: () => accounts } as unknown as Parameters<
		typeof _runTickForTest
	>[0];
}

const config = {} as unknown as Parameters<typeof _runTickForTest>[1];

describe("_localHhMmForTest", () => {
	it("formats hours and minutes zero-padded", () => {
		expect(_localHhMmForTest(new Date(2026, 0, 1, 5, 0))).toBe("05:00");
		expect(_localHhMmForTest(new Date(2026, 0, 1, 17, 30))).toBe("17:30");
		expect(_localHhMmForTest(new Date(2026, 0, 1, 0, 9))).toBe("00:09");
	});
});

describe("runTick", () => {
	beforeEach(() => {
		refreshCalls.length = 0;
	});

	it("refreshes only accounts whose enabled schedule matches the minute", async () => {
		const accounts = [
			account("match", { enabled: true, times: ["05:00", "17:30"] }),
			account("other-time", { enabled: true, times: ["06:00"] }),
			account("disabled", { enabled: false, times: ["05:00"] }),
			account("unset", null),
		];

		await _runTickForTest(
			fakeDbOps(accounts),
			config,
			log,
			new Date(2026, 0, 1, 5, 0),
		);

		expect(refreshCalls.map((a) => a.name)).toEqual(["match"]);
	});

	it("does nothing when no schedule matches", async () => {
		const accounts = [account("a", { enabled: true, times: ["09:00"] })];
		await _runTickForTest(
			fakeDbOps(accounts),
			config,
			log,
			new Date(2026, 0, 1, 5, 0),
		);
		expect(refreshCalls).toHaveLength(0);
	});
});
