import type { AccountResponse } from "@ccflare/api";
import type { ApiKeyProvider, OAuthProvider } from "@ccflare/types";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";
import { queryKeys } from "../lib/query-keys";
import {
	useAccounts,
	useCreateGroup,
	useDeleteGroup,
	useGroups,
	useRenameAccount,
	useSetAccountGroups,
	useUpdateGroup,
} from "./queries";
import { useApiError } from "./useApiError";

/**
 * Page-model hook for the Accounts page.
 *
 * Owns: query reads, all mutations, invalidation, error shaping.
 * Components only receive shaped data and call actions.
 */
export function useAccountsPageModel() {
	const { formatError } = useApiError();
	const queryClient = useQueryClient();
	const {
		data: accounts,
		isLoading: loading,
		error: queryError,
	} = useAccounts();
	const renameAccountMutation = useRenameAccount();
	const { data: groups } = useGroups();
	const createGroupMutation = useCreateGroup();
	const updateGroupMutation = useUpdateGroup();
	const deleteGroupMutation = useDeleteGroup();
	const setAccountGroupsMutation = useSetAccountGroups();

	const [actionError, setActionError] = useState<string | null>(null);

	const invalidateAccounts = () =>
		queryClient.invalidateQueries({ queryKey: queryKeys.accounts() });

	// -- Mutations --

	const createApiKeyAccount = useMutation({
		mutationFn: (params: {
			name: string;
			provider: ApiKeyProvider;
			apiKey: string;
		}) => api.createApiKeyAccount(params),
		onSuccess: () => {
			setActionError(null);
			invalidateAccounts();
		},
		onError: (err) => setActionError(formatError(err)),
	});

	const startOAuth = async (params: {
		name: string;
		provider: OAuthProvider;
	}) => {
		try {
			const result = await api.initAddAccount(params);
			setActionError(null);
			return result;
		} catch (err) {
			setActionError(formatError(err));
			throw err;
		}
	};

	const completeOAuth = async (params: {
		provider: OAuthProvider;
		sessionId: string;
		code: string;
	}) => {
		try {
			await api.completeAddAccount(params);
			await invalidateAccounts();
			setActionError(null);
		} catch (err) {
			setActionError(formatError(err));
			throw err;
		}
	};

	const getSessionStatus = async (sessionId: string) => {
		try {
			return await api.getAuthSessionStatus(sessionId);
		} catch (err) {
			setActionError(formatError(err));
			throw err;
		}
	};

	const onOAuthCompleted = async () => {
		try {
			await invalidateAccounts();
			setActionError(null);
		} catch (err) {
			setActionError(formatError(err));
			throw err;
		}
	};

	const removeAccount = useMutation({
		mutationFn: (accountId: string) => api.removeAccount(accountId),
		onSuccess: () => {
			setActionError(null);
			invalidateAccounts();
		},
		onError: (err) => setActionError(formatError(err)),
	});

	const renameAccount = async (accountId: string, newName: string) => {
		try {
			await renameAccountMutation.mutateAsync({ accountId, newName });
			setActionError(null);
		} catch (err) {
			setActionError(formatError(err));
		}
	};

	const togglePause = useMutation({
		mutationFn: (account: AccountResponse) =>
			account.paused
				? api.resumeAccount(account.id)
				: api.pauseAccount(account.id),
		onSuccess: () => invalidateAccounts(),
		onError: (err) => setActionError(formatError(err)),
	});

	const refreshAccount = useMutation({
		mutationFn: (accountId: string) => api.refreshAccount(accountId),
		onSuccess: () => invalidateAccounts(),
		onError: (err) => setActionError(formatError(err)),
	});

	const updateRefreshSchedule = useMutation({
		mutationFn: (params: {
			accountId: string;
			schedule: { enabled: boolean; times: string[] } | null;
		}) => api.updateRefreshSchedule(params.accountId, params.schedule),
		onSuccess: () => {
			setActionError(null);
			invalidateAccounts();
		},
		onError: (err) => setActionError(formatError(err)),
	});

	// -- Group actions --

	const createGroup = async (data: {
		name: string;
		description?: string | null;
	}) => {
		try {
			await createGroupMutation.mutateAsync(data);
			setActionError(null);
		} catch (err) {
			setActionError(formatError(err));
			throw err;
		}
	};

	const renameGroup = async (groupId: string, name: string) => {
		try {
			await updateGroupMutation.mutateAsync({ groupId, data: { name } });
			setActionError(null);
		} catch (err) {
			setActionError(formatError(err));
			throw err;
		}
	};

	const deleteGroup = async (groupId: string) => {
		try {
			await deleteGroupMutation.mutateAsync(groupId);
			setActionError(null);
		} catch (err) {
			setActionError(formatError(err));
			throw err;
		}
	};

	const setAccountGroups = async (accountId: string, groupIds: string[]) => {
		try {
			await setAccountGroupsMutation.mutateAsync({
				accountId,
				groups: groupIds,
			});
			setActionError(null);
		} catch (err) {
			setActionError(formatError(err));
			throw err;
		}
	};

	// -- Computed --

	const displayError = queryError ? formatError(queryError) : actionError;

	return {
		// Data
		accounts,
		groups: groups ?? [],
		loading,
		error: displayError,

		// Actions
		createApiKeyAccount: createApiKeyAccount.mutateAsync,
		startOAuth,
		completeOAuth,
		getSessionStatus,
		onOAuthCompleted,
		removeAccount: (accountId: string) => removeAccount.mutateAsync(accountId),
		renameAccount,
		togglePause: (account: AccountResponse) => togglePause.mutateAsync(account),
		refreshAccount: (accountId: string) =>
			refreshAccount.mutateAsync(accountId),
		updateRefreshSchedule: (
			accountId: string,
			schedule: { enabled: boolean; times: string[] } | null,
		) => updateRefreshSchedule.mutateAsync({ accountId, schedule }),
		isRenaming: renameAccountMutation.isPending,
		createGroup,
		renameGroup,
		deleteGroup,
		setAccountGroups,
		clearError: () => setActionError(null),
	};
}
