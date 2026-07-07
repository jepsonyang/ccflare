export {
	createServerFetchHandler,
	createStartupBanner,
	default,
	type ServerHandle,
	type StartServerOptions,
} from "@ccflare/runtime-server";

import { Config } from "@ccflare/config";
import startServer from "@ccflare/runtime-server";

if (import.meta.main) {
	// Honor the configured port (config file / PORT env), like the TUI does.
	// Without this, startServer() falls back to the hardcoded default port and
	// ignores `port` in ccflare.json.
	startServer({ port: new Config().getRuntime().port });
}
