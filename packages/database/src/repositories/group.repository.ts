import type { Group } from "@ccflare/types";
import { BaseRepository } from "./base.repository";

interface GroupRow {
	id: string;
	name: string;
	description: string | null;
	created_at: number;
}

const groupSelectFields = `id, name, description, created_at`;

export class GroupRepository extends BaseRepository<Group> {
	listAll(): Group[] {
		return this.query<GroupRow>(
			`SELECT ${groupSelectFields} FROM groups ORDER BY name ASC`,
		);
	}

	findById(id: string): Group | null {
		return this.get<GroupRow>(
			`SELECT ${groupSelectFields} FROM groups WHERE id = ?`,
			[id],
		);
	}

	findByName(name: string): Group | null {
		return this.get<GroupRow>(
			`SELECT ${groupSelectFields} FROM groups WHERE name = ?`,
			[name],
		);
	}

	create(name: string, description: string | null): Group {
		const id = crypto.randomUUID();
		const createdAt = Date.now();
		this.run(
			`INSERT INTO groups (id, name, description, created_at) VALUES (?, ?, ?, ?)`,
			[id, name, description, createdAt],
		);
		return this.findById(id) as Group;
	}

	update(
		id: string,
		data: { name?: string; description?: string | null },
	): Group | null {
		const updates: string[] = [];
		const params: Array<string | null> = [];

		if (data.name !== undefined) {
			updates.push("name = ?");
			params.push(data.name);
		}
		if ("description" in data) {
			updates.push("description = ?");
			params.push(data.description ?? null);
		}

		if (updates.length === 0) {
			return this.findById(id);
		}

		params.push(id);
		const changes = this.runWithChanges(
			`UPDATE groups SET ${updates.join(", ")} WHERE id = ?`,
			params,
		);
		return changes > 0 ? this.findById(id) : null;
	}

	/**
	 * Delete a group and all its membership rows in a single transaction. This
	 * makes membership cleanup deterministic even when SQLite foreign-key
	 * enforcement (PRAGMA foreign_keys) is off, satisfying "deleting a group
	 * adjusts the accounts that belonged to it".
	 */
	delete(id: string): boolean {
		this.db.run("BEGIN");
		try {
			this.run(`DELETE FROM account_groups WHERE group_id = ?`, [id]);
			const changes = this.runWithChanges(`DELETE FROM groups WHERE id = ?`, [
				id,
			]);
			this.db.run("COMMIT");
			return changes > 0;
		} catch (e) {
			this.db.run("ROLLBACK");
			throw e;
		}
	}

	/** Group names an account belongs to. */
	getGroupsForAccount(accountId: string): string[] {
		const rows = this.query<{ name: string }>(
			`SELECT g.name AS name
			 FROM account_groups ag
			 JOIN groups g ON g.id = ag.group_id
			 WHERE ag.account_id = ?
			 ORDER BY g.name ASC`,
			[accountId],
		);
		return rows.map((r) => r.name);
	}

	/**
	 * Replace an account's group membership with the given set of group ids.
	 * Runs in a transaction: clears existing rows then inserts the new set.
	 */
	setAccountGroups(accountId: string, groupIds: string[]): void {
		this.db.run("BEGIN");
		try {
			this.run(`DELETE FROM account_groups WHERE account_id = ?`, [accountId]);
			for (const groupId of groupIds) {
				this.run(
					`INSERT OR IGNORE INTO account_groups (account_id, group_id) VALUES (?, ?)`,
					[accountId, groupId],
				);
			}
			this.db.run("COMMIT");
		} catch (e) {
			this.db.run("ROLLBACK");
			throw e;
		}
	}
}
