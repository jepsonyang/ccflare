import {
	patterns,
	sanitizers,
	ValidationError,
	validateString,
} from "@ccflare/core";
import type { DatabaseOperations } from "@ccflare/database";
import {
	BadRequest,
	errorResponse,
	jsonResponse,
	NotFound,
} from "@ccflare/http";
import { Logger } from "@ccflare/logger";
import {
	DEFAULT_GROUP_NAME,
	type Group,
	type GroupCreateData,
	type GroupDeleteData,
	type GroupUpdateData,
	type MutationResult,
} from "@ccflare/types";
import type { GroupResponse } from "../types";
import { parseJsonObject } from "../utils/json";

const log = new Logger("GroupsHandler");

/**
 * The synthetic default group. Not stored in the DB — it represents the pool of
 * accounts with no explicit group membership. Non-deletable and non-editable.
 */
const DEFAULT_GROUP: GroupResponse = {
	id: DEFAULT_GROUP_NAME,
	name: DEFAULT_GROUP_NAME,
	description: "Ungrouped accounts (default pool)",
	created: new Date(0).toISOString(),
	system: true,
};

function isReservedGroupName(name: string): boolean {
	return name.toLowerCase() === DEFAULT_GROUP_NAME;
}

function isDefaultGroupId(groupId: string): boolean {
	return groupId.toLowerCase() === DEFAULT_GROUP_NAME;
}

function serializeGroup(group: Group): GroupResponse {
	return {
		id: group.id,
		name: group.name,
		description: group.description,
		created: new Date(group.created_at).toISOString(),
	};
}

function validateGroupName(value: unknown): string | null | undefined {
	return validateString(value, "name", {
		required: true,
		minLength: 1,
		maxLength: 100,
		pattern: patterns.groupName,
		transform: sanitizers.trim,
	});
}

function normalizeDescription(value: unknown): string | null {
	if (value === undefined || value === null || value === "") {
		return null;
	}
	return (
		validateString(value, "description", {
			maxLength: 500,
			transform: sanitizers.trim,
		}) || null
	);
}

function isDuplicateGroupNameError(error: unknown): boolean {
	return (
		error instanceof Error &&
		error.message.includes("UNIQUE constraint failed: groups.name")
	);
}

export function createGroupsListHandler(dbOps: DatabaseOperations) {
	return (): Response => {
		// Prepend the synthetic default group so the UI can show it as a
		// non-deletable pool alongside the real groups.
		const response: GroupResponse[] = [
			DEFAULT_GROUP,
			...dbOps.getGroups().map(serializeGroup),
		];
		return jsonResponse(response);
	};
}

export function createGroupAddHandler(dbOps: DatabaseOperations) {
	return async (req: Request): Promise<Response> => {
		try {
			const body = await parseJsonObject(req);

			const name = validateGroupName(body.name);
			if (!name) {
				return errorResponse(BadRequest("Group name is required"));
			}
			if (isReservedGroupName(name)) {
				return errorResponse(
					BadRequest(`'${DEFAULT_GROUP_NAME}' is a reserved group name`),
				);
			}
			const description = normalizeDescription(body.description);

			if (dbOps.getGroupByName(name)) {
				return errorResponse(BadRequest(`Group '${name}' already exists`));
			}

			const group = dbOps.createGroup(name, description);
			const result: MutationResult<GroupCreateData> = {
				success: true,
				message: `Group '${name}' created successfully`,
				data: { groupId: group.id, name: group.name },
			};
			return jsonResponse(result);
		} catch (error) {
			if (error instanceof ValidationError) {
				return errorResponse(BadRequest(error.message));
			}
			if (isDuplicateGroupNameError(error)) {
				return errorResponse(BadRequest("Group name is already taken"));
			}
			log.error("Group add error:", error);
			return errorResponse(
				error instanceof Error ? error : new Error("Failed to create group"),
			);
		}
	};
}

export function createGroupUpdateHandler(dbOps: DatabaseOperations) {
	return async (req: Request, groupId: string): Promise<Response> => {
		try {
			if (isDefaultGroupId(groupId)) {
				return errorResponse(
					BadRequest("The default group cannot be modified"),
				);
			}
			const body = await parseJsonObject(req);
			const group = dbOps.getGroup(groupId);
			if (!group) {
				return errorResponse(NotFound("Group not found"));
			}

			const hasName = Object.hasOwn(body, "name");
			const hasDescription = Object.hasOwn(body, "description");
			if (!hasName && !hasDescription) {
				return errorResponse(
					BadRequest("At least one of 'name' or 'description' is required"),
				);
			}

			const data: { name?: string; description?: string | null } = {};
			if (hasName) {
				const name = validateGroupName(body.name);
				if (!name) {
					return errorResponse(BadRequest("Group name is required"));
				}
				if (isReservedGroupName(name)) {
					return errorResponse(
						BadRequest(`'${DEFAULT_GROUP_NAME}' is a reserved group name`),
					);
				}
				const existing = dbOps.getGroupByName(name);
				if (existing && existing.id !== groupId) {
					return errorResponse(
						BadRequest(`Group name '${name}' is already taken`),
					);
				}
				data.name = name;
			}
			if (hasDescription) {
				data.description = normalizeDescription(body.description);
			}

			const updated = dbOps.updateGroup(groupId, data);
			if (!updated) {
				return errorResponse(NotFound("Group not found"));
			}

			const result: MutationResult<GroupUpdateData> = {
				success: true,
				message: `Group '${updated.name}' updated successfully`,
				data: {
					groupId: updated.id,
					name: updated.name,
					description: updated.description,
				},
			};
			return jsonResponse(result);
		} catch (error) {
			if (error instanceof ValidationError) {
				return errorResponse(BadRequest(error.message));
			}
			if (isDuplicateGroupNameError(error)) {
				return errorResponse(BadRequest("Group name is already taken"));
			}
			log.error("Group update error:", error);
			return errorResponse(
				error instanceof Error ? error : new Error("Failed to update group"),
			);
		}
	};
}

export function createGroupRemoveHandler(dbOps: DatabaseOperations) {
	return async (_req: Request, groupId: string): Promise<Response> => {
		try {
			if (isDefaultGroupId(groupId)) {
				return errorResponse(BadRequest("The default group cannot be deleted"));
			}
			const group = dbOps.getGroup(groupId);
			if (!group) {
				return errorResponse(NotFound("Group not found"));
			}
			// Deletes the group and all its membership rows in one transaction,
			// so member accounts revert to the default pool.
			if (!dbOps.deleteGroup(groupId)) {
				return errorResponse(NotFound("Group not found"));
			}

			const result: MutationResult<GroupDeleteData> = {
				success: true,
				message: `Group '${group.name}' removed successfully`,
				data: { groupId: group.id },
			};
			return jsonResponse(result);
		} catch (error) {
			log.error("Group remove error:", error);
			return errorResponse(
				error instanceof Error ? error : new Error("Failed to remove group"),
			);
		}
	};
}
