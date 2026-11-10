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
	it("uses the learner's own setup, appending the protocol and hiding unused ICAP tools", () => {
		const p = sessionPlan({ ...base, config: "mine" });
		expect(p).toMatchObject({ bare: false, contextFiles: "vault+pi", builtins: true, appendSystemPrompt: ["PROTOCOL"], excludeTools: ["create_note", "propose_edit"] });
		expect(p.systemPrompt).toBeUndefined();
		expect(p.tools).toBeUndefined();
	});
	it("isolates: only ICAP, the given tools, the protocol as the whole prompt, the vault's own AGENTS.md", () => {
		const p = sessionPlan({ ...base, config: "isolated" });
		expect(p).toMatchObject({ bare: true, contextFiles: "vault", builtins: false, systemPrompt: "PROTOCOL", tools: ["read", "obsidian", "read_document", "documents", "ask_learner"] });
		expect(p.appendSystemPrompt).toBeUndefined();
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
