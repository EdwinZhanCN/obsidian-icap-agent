import { describe, expect, it } from "vite-plus/test";
import { actionDecision, isConnectorTool, mentionsPath, writeDecision, type ConfirmMode, type ToolScope } from "./permissions";

const MODES: ConfirmMode[] = ["ask", "auto-edits", "skip"];
const SCOPES: ToolScope[] = ["isolated", "full"];

describe("what the built-in agent may write", () => {
	it("in the vault: asked about first, unless the learner chose to accept edits", () => {
		for (const scope of SCOPES) {
			expect(writeDecision(scope, "ask", "vault")).toBe("ask");
			expect(writeDecision(scope, "auto-edits", "vault")).toBe("direct");
			expect(writeDecision(scope, "skip", "vault")).toBe("direct");
		}
	});

	it("outside the vault: never with the isolated tools; with the full ones it asks until every confirmation is skipped", () => {
		for (const mode of MODES) expect(writeDecision("isolated", mode, "outside")).toBe("refuse");
		expect(writeDecision("full", "ask", "outside")).toBe("ask");
		expect(writeDecision("full", "auto-edits", "outside")).toBe("ask");
		expect(writeDecision("full", "skip", "outside")).toBe("direct");
	});

	it("a protected folder always asks, in every mode and scope that reaches it", () => {
		for (const mode of MODES) {
			// Obsidian's own folder is inside the vault: both scopes reach it, and both ask.
			expect(writeDecision("isolated", mode, "protected", true)).toBe("ask");
			expect(writeDecision("full", mode, "protected", true)).toBe("ask");
			// Pi's own folder is outside the vault.
			expect(writeDecision("full", mode, "protected", false)).toBe("ask");
			expect(writeDecision("isolated", mode, "protected", false)).toBe("refuse");
		}
	});
});

describe("the shell and connectors", () => {
	it("are not in the isolated scope at all", () => {
		for (const mode of MODES) expect(actionDecision("isolated", mode)).toBe("refuse");
	});

	it("ask every time, also when edits are accepted; only skipping every confirmation lets them run", () => {
		expect(actionDecision("full", "ask")).toBe("ask");
		expect(actionDecision("full", "auto-edits")).toBe("ask");
		expect(actionDecision("full", "skip")).toBe("direct");
	});

	it("a command that names a protected folder asks even then", () => {
		expect(actionDecision("full", "skip", true)).toBe("ask");
	});

	it("knows a connector's tool by Pi's name for it", () => {
		expect(isConnectorTool("mcp__notion__search")).toBe(true);
		expect(isConnectorTool("read_mcp_resource")).toBe(true);
		expect(isConnectorTool("bash")).toBe(false);
		expect(isConnectorTool("obsidian")).toBe(false);
	});
});

describe("a command that names a protected folder", () => {
	const paths = ["/Users/me/vault/.obsidian", "/Users/me/.pi/agent"];
	const names = [".obsidian", ".pi"];
	const hit = (command: string) => mentionsPath(command, paths, names);

	it("by its absolute path", () => {
		expect(hit("cat /Users/me/.pi/agent/auth.json")).toBe(true);
		expect(hit("ls /Users/me/vault/.obsidian/plugins")).toBe(true);
	});

	it("by the name a command run in the vault would use, however it is written", () => {
		expect(hit("rm -rf .obsidian/plugins/x")).toBe(true);
		expect(hit("ls ./.obsidian")).toBe(true);
		expect(hit('echo "{}" > ".obsidian/app.json"')).toBe(true);
		expect(hit("cat ~/.pi/agent/mcp.json")).toBe(true);
		expect(hit("cat $HOME/.pi/agent/auth.json")).toBe(true);
		expect(hit("cd .obsidian; ls")).toBe(true);
		expect(hit("C:\\vault\\.obsidian\\app.json")).toBe(true);
	});

	it("not a command about something else", () => {
		expect(hit("ls notes")).toBe(false);
		expect(hit("grep -r obsidian notes/")).toBe(false);
		expect(hit("cat my.obsidian.notes.md")).toBe(false);
		expect(hit("python3 script.py")).toBe(false);
		expect(hit("echo 3.pi")).toBe(false);
	});
});
