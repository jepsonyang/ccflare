import type { Config } from "@ccflare/config";
import type { DatabaseOperations } from "@ccflare/database";
import type {
	AccountProvider,
	AuthMethod,
	RuntimeHealth,
} from "@ccflare/types";

export interface AccountResponse {
	id: string;
	name: string;
	provider: AccountProvider;
	auth_method: AuthMethod;
	base_url: string | null;
	requestCount: number;
	totalRequests: number;
	lastUsed: string | null;
	created: string;
	weight: number;
	paused: boolean;
	tokenStatus: "valid" | "expired";
	tokenExpiresAt: string | null;
	rateLimitStatus: {
		code: string;
		isLimited: boolean;
		until: string | null;
	};
	rateLimitReset: string | null;
	rateLimitRemaining: number | null;
	usageWindows: {
		fiveHour: {
			utilization: number | null;
			resetAt: string | null;
			isRepresentative: boolean;
		};
		sevenDay: {
			utilization: number | null;
			resetAt: string | null;
			isRepresentative: boolean;
		};
		fable: {
			utilization: number | null;
			resetAt: string | null;
			isRepresentative: boolean;
		};
	};
	sessionInfo: {
		active: boolean;
		startedAt: string | null;
		requestCount: number;
	};
}

export interface APIContext {
	config: Config;
	dbOps: DatabaseOperations;
	getProviders: () => string[];
	getRuntimeHealth?: () => RuntimeHealth;
}
