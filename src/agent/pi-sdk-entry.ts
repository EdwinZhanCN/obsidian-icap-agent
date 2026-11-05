/**
 * The part of Pi's SDK the plugin uses.
 *
 * esbuild.config.mjs bundles this module on its own for Node (Pi's "bundled node" mode: user extensions
 * resolve typebox / pi-ai / pi-coding-agent to these embedded copies), and main.js loads it on first use
 * through agent/pi-host.ts. Tests import it straight from node_modules.
 */
export {
	createAgentSession,
	createMcpExtension,
	createToolSearchExtension,
	DefaultResourceLoader,
	getAgentDir,
	hasTrustRequiringProjectResources,
	ModelRuntime,
	ProjectTrustStore,
	SessionManager,
	SettingsManager,
	VERSION,
} from "@earendil-works/pi-coding-agent";
export { Type } from "typebox";

import { bedrockProviderModule } from "@earendil-works/pi-ai/bedrock-provider";
import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth";
import { setBedrockProviderModule } from "@earendil-works/pi-ai/compat";

// pi-ai loads its OAuth flows and Amazon Bedrock (the AWS SDK) through import specifiers computed at
// runtime, which a bundler cannot follow; register them statically, as Pi's standalone binary does,
// so login and Bedrock work from main.js.
registerBunOAuthFlows();
setBedrockProviderModule(bedrockProviderModule);
