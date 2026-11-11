import { describe, expect, it } from "vite-plus/test";
import { readVaultContext, renderProjectContext, withProjectContext } from "./context-files";

const vault = (files: Record<string, string>) => ({
	exists: async (p: string) => p in files,
	read: async (p: string) => {
		if (!(p in files)) throw new Error("ENOENT");
		return files[p];
	},
});

describe("the vault's context file", () => {
	it("is the first of Pi's names in the vault root", async () => {
		expect(await readVaultContext(vault({ "CLAUDE.md": "c", "AGENTS.md": "a" }))).toEqual([{ path: "AGENTS.md", content: "a" }]);
		expect(await readVaultContext(vault({ "AGENTS.override.md": "o", "AGENTS.md": "a" }))).toEqual([{ path: "AGENTS.override.md", content: "o" }]);
		expect(await readVaultContext(vault({ "CLAUDE.md": "﻿c" }))).toEqual([{ path: "CLAUDE.md", content: "c" }]);
		expect(await readVaultContext(vault({ "Notes/AGENTS.md": "n" }))).toEqual([]);
	});

	it("is rendered as Pi renders project context, after the system prompt", () => {
		const files = [{ path: "AGENTS.md", content: "Be brief." }];
		expect(renderProjectContext(files)).toBe('Project-specific instructions and guidelines:\n\n<project_instructions path="AGENTS.md">\nBe brief.\n</project_instructions>');
		expect(withProjectContext("PROTOCOL", files)).toBe(`PROTOCOL\n\n${renderProjectContext(files)}`);
		expect(withProjectContext("PROTOCOL", [])).toBe("PROTOCOL");
	});
});
