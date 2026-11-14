import { describe, expect, it } from "vite-plus/test";
import { sessionPlan, vaultContextFiles } from "./pi-session";



describe("context files", () => {
	it("keeps Pi's global AGENTS.md and the vault's own, drops what lies above the vault", () => {
		const files = [
			{ path: "/Users/me/.pi/agent/AGENTS.md" },
			{ path: "/Users/me/AGENTS.md" },
			{ path: "/Users/me/code/repo/CLAUDE.md" },
			{ path: "/Users/me/code/repo/vault/AGENTS.md" },
			{ path: "/Users/me/code/repo/vault-other/AGENTS.md" },
		];
		expect(vaultContextFiles(files, "/Users/me/code/repo/vault", "/Users/me/.pi/agent").map((f) => f.path)).toEqual([
			"/Users/me/.pi/agent/AGENTS.md",
			"/Users/me/code/repo/vault/AGENTS.md",
		]);
		expect(vaultContextFiles(files, "/Users/me/code/repo/vault", "/Users/me/.pi/agent", true).map((f) => f.path)).toEqual(["/Users/me/code/repo/vault/AGENTS.md"]);
	});
});

describe("pi session plan", () => {
	const base = { systemPrompt: "PROTOCOL", tools: ["read", "obsidian", "read_document", "documents", "ask_learner"] };
	it("full scope: the learner's skills and connectors, the protocol appended, unused ICAP tools hidden", () => {
		const p = sessionPlan({ ...base, scope: "full" });
		expect(p).toMatchObject({ bare: false, contextFiles: "vault+pi", connectors: true, appendSystemPrompt: ["PROTOCOL"], excludeTools: ["create_note", "propose_edit"] });
		expect(p.systemPrompt).toBeUndefined();
		expect(p.tools).toBeUndefined();
	});
	it("isolated scope: only ICAP's tools and the file tools given, no connectors, the protocol as the whole prompt", () => {
		const p = sessionPlan({ ...base, scope: "isolated" });
		expect(p).toMatchObject({ bare: true, contextFiles: "vault", connectors: false, systemPrompt: "PROTOCOL", tools: ["read", "obsidian", "read_document", "documents", "ask_learner"] });
		expect(p.appendSystemPrompt).toBeUndefined();
	});
	it("isolated scope never has the shell or a connector, whatever the task lists", () => {
		const p = sessionPlan({ systemPrompt: "P", tools: ["read", "edit", "write", "bash", "powershell", "mcp__notion__search", "grep", "ask_learner"], scope: "isolated" });
		expect(p.tools).toEqual(["read", "edit", "write", "ask_learner"]);
	});
	it("full scope on Windows without a bash uses PowerShell instead, so nothing has to be installed", () => {
		expect(sessionPlan({ ...base, scope: "full" }, "powershell").tools).toEqual(["+powershell", "-bash"]);
		expect(sessionPlan({ ...base, scope: "full" }, "bash").tools).toBeUndefined();
	});
});

import { stepDetail } from "./pi-session";
describe("tool call steps", () => {
	it("summarizes a tool call in one line", () => {
		expect(stepDetail({ path: "notes/a.md", offset: 3 })).toBe("notes/a.md");
		expect(stepDetail({ command: "ls   -la\n/tmp" })).toBe("ls -la /tmp");
		expect(stepDetail(null)).toBe("");
	});
});
