/**
 * The part of the Pi harness the plugin uses.
 *
 * The harness is a fork of @earendil-works/pi-coding-agent in its own repository, here as the submodule
 * `pi/` (see "Pi inside Obsidian" in AGENTS.md): Pi's sessions, models, settings, tools and MCP, without
 * its terminal, its CLI and anything that loads code from disk. scripts/build/pi-bundle.ts bundles this
 * module on its own for Node, and main.js loads it on first use through agent/desktop/pi-host.ts. Tests
 * import it directly.
 */
export {
	createAgentSession,
	createLocalBashOperations,
	createLocalPowerShellOperations,
	createMcpExtension,
	DefaultResourceLoader,
	getAgentDir,
	hasTrustRequiringProjectResources,
	ModelRuntime,
	ProjectTrustStore,
	SessionManager,
	SettingsManager,
	VERSION,
} from "../../../pi/packages/coding-agent/src/index.ts";
export type {
	AgentSession,
	BashOperations,
	EditOperations,
	ExtensionAPI,
	ExtensionUIContext,
	ToolsOptions,
	WriteOperations,
} from "../../../pi/packages/coding-agent/src/index.ts";
export { Type } from "typebox";
export { addMcpServerConfig, loadMcpConfig, removeMcpServerConfig, updateMcpServerConfig } from "../../../pi/packages/coding-agent/src/extensions/mcp/config.ts";

import { getShellConfig } from "../../../pi/packages/coding-agent/src/utils/shell.ts";

/**
 * The shell tool of the full scope: bash where there is one, else PowerShell (Windows without Git
 * Bash), so the learner is never asked to install anything.
 */
export function shellTool(): "bash" | "powershell" {
	if (process.platform !== "win32") return "bash";
	try {
		getShellConfig();
		return "bash";
	} catch {
		return "powershell";
	}
}

import { bedrockProviderModule } from "@earendil-works/pi-ai/bedrock-provider";
import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth";
import { setBedrockProviderModule } from "@earendil-works/pi-ai/compat";

// pi-ai loads its OAuth flows and Amazon Bedrock (the AWS SDK) through import specifiers computed at
// runtime, which a bundler cannot follow; register them statically, as Pi's standalone binary does,
// so login and Bedrock work from main.js.
registerBunOAuthFlows();
setBedrockProviderModule(bedrockProviderModule);
