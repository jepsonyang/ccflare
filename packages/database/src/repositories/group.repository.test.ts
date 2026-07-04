import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { ensureSchema, runMigrations } from "../migrations";
import { AccountRepository } from "./account.repository";
import { GroupRepository } from "./group.repository";

describe("GroupRepository", () => {
	let db: Database;
	let groups: GroupRepository;
	let accounts: AccountRepository;

	beforeEach(() => {
		db = new Database(":memory:");
		db.exec("PRAGMA foreign_keys = ON");
		ensureSchema(db);
		runMigrations(db);
		groups = new GroupRepository(db);
		accounts = new AccountRepository(db);
	});

	afterEach(() => {
		db.close();
	});

	function makeAccount(name: string) {
		return accounts.create({
			name,
			provider: "anthropic",
			auth_method: "oauth",
			access_token: `${name}-token`,
		});
	}

	it("creates, looks up, and lists groups", () => {
		const g = groups.create("teamA", "Team A pool");
		expect(g).toEqual(
			expect.objectContaining({ name: "teamA", description: "Team A pool" }),
		);
		expect(groups.findByName("teamA")?.id).toBe(g.id);
		expect(groups.findById(g.id)?.name).toBe("teamA");
		expect(groups.listAll().map((x) => x.name)).toEqual(["teamA"]);
	});

	it("sets and reads account membership and reflects it on the account", () => {
		const a = makeAccount("acc-a");
		const g1 = groups.create("teamA", null);
		const g2 = groups.create("teamB", null);

		groups.setAccountGroups(a.id, [g1.id, g2.id]);

		expect(groups.getGroupsForAccount(a.id).sort()).toEqual(["teamA", "teamB"]);
		expect(accounts.findById(a.id)?.groups.sort()).toEqual(["teamA", "teamB"]);
	});

	it("replaces membership on subsequent setAccountGroups calls", () => {
		const a = makeAccount("acc-a");
		const g1 = groups.create("teamA", null);
		const g2 = groups.create("teamB", null);

		groups.setAccountGroups(a.id, [g1.id]);
		groups.setAccountGroups(a.id, [g2.id]);

		expect(groups.getGroupsForAccount(a.id)).toEqual(["teamB"]);
	});

	it("deleting a group removes its membership rows", () => {
		const a = makeAccount("acc-a");
		const g = groups.create("teamA", null);
		groups.setAccountGroups(a.id, [g.id]);

		expect(groups.delete(g.id)).toBe(true);
		expect(groups.findById(g.id)).toBeNull();
		expect(groups.getGroupsForAccount(a.id)).toEqual([]);
		// Still routable via the shared pool now that it carries no tag.
		expect(
			accounts.findAvailableForProvider("anthropic").map((x) => x.name),
		).toContain("acc-a");
	});
});

describe("AccountRepository group-aware selection", () => {
	let db: Database;
	let groups: GroupRepository;
	let accounts: AccountRepository;

	beforeEach(() => {
		db = new Database(":memory:");
		db.exec("PRAGMA foreign_keys = ON");
		ensureSchema(db);
		runMigrations(db);
		groups = new GroupRepository(db);
		accounts = new AccountRepository(db);
	});

	afterEach(() => {
		db.close();
	});

	function makeAccount(name: string) {
		return accounts.create({
			name,
			provider: "anthropic",
			auth_method: "oauth",
			access_token: `${name}-token`,
		});
	}

	it("includes grouped accounts in the shared pool (groups are non-exclusive)", () => {
		const grouped = makeAccount("grouped");
		makeAccount("ungrouped");
		const g = groups.create("teamA", null);
		groups.setAccountGroups(grouped.id, [g.id]);

		const pool = accounts
			.findAvailableForProvider("anthropic")
			.map((a) => a.name)
			.sort();
		expect(pool).toEqual(["grouped", "ungrouped"]);
	});

	it("returns only members when filtering by group", () => {
		const a = makeAccount("acc-a");
		const b = makeAccount("acc-b");
		makeAccount("acc-c");
		const g = groups.create("teamA", null);
		groups.setAccountGroups(a.id, [g.id]);
		groups.setAccountGroups(b.id, [g.id]);

		const members = accounts
			.findAvailableForProviderAndGroups("anthropic", ["teamA"])
			.map((x) => x.name)
			.sort();
		expect(members).toEqual(["acc-a", "acc-b"]);
	});

	it("returns the union of multiple groups, deduped", () => {
		const a = makeAccount("acc-a");
		const b = makeAccount("acc-b");
		const both = makeAccount("acc-both");
		makeAccount("acc-ungrouped");
		const gA = groups.create("teamA", null);
		const gB = groups.create("teamB", null);
		groups.setAccountGroups(a.id, [gA.id]);
		groups.setAccountGroups(b.id, [gB.id]);
		groups.setAccountGroups(both.id, [gA.id, gB.id]);

		// Union of teamA + teamB, acc-both counted once; ungrouped excluded.
		expect(
			accounts
				.findAvailableForProviderAndGroups("anthropic", ["teamA", "teamB"])
				.map((x) => x.name)
				.sort(),
		).toEqual(["acc-a", "acc-b", "acc-both"]);
	});

	it("returns no accounts for an unknown group and for an empty selection", () => {
		makeAccount("acc-a");
		expect(
			accounts.findAvailableForProviderAndGroups("anthropic", ["nope"]),
		).toEqual([]);
		expect(accounts.findAvailableForProviderAndGroups("anthropic", [])).toEqual(
			[],
		);
	});
});
