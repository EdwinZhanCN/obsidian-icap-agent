/**
 * The vault's own context file (AGENTS.md and its kin), for a backend that has no Pi to find it: the
 * mobile agent. Desktop gets the same file from Pi's discovery (vaultContextFiles in pi-session.ts);
 * this follows Pi's rules so a vault reads the same on both: the first of these names in the vault's
 * root, rendered the way Pi renders project context into the system prompt.
 */

/** Pi's candidates, in Pi's order (resource-loader.js, loadContextFileFromDir). */
export const CONTEXT_FILE_NAMES = ["AGENTS.override.md", "AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"] as const;

export interface ContextFile {
	path: string;
	content: string;
}

/** Pi's project-context section (system-prompt.js, renderProjectContext). */
export function renderProjectContext(files: ContextFile[]): string {
	if (!files.length) return "";
	return ["Project-specific instructions and guidelines:", ...files.map(({ path, content }) => `<project_instructions path="${path}">\n${content}\n</project_instructions>`)].join("\n\n");
}

/** The system prompt with the vault's context file after it, as Pi appends it. */
export function withProjectContext(systemPrompt: string, files: ContextFile[]): string {
	const context = renderProjectContext(files);
	return context ? `${systemPrompt}\n\n${context}` : systemPrompt;
}

/** The vault root's context file, read through the vault adapter; none when there is none or it cannot be read. */
export async function readVaultContext(adapter: { exists(path: string): Promise<boolean>; read(path: string): Promise<string> }): Promise<ContextFile[]> {
	for (const name of CONTEXT_FILE_NAMES) {
		try {
			if (!(await adapter.exists(name))) continue;
			const content = (await adapter.read(name)).replace(/^\uFEFF/, "");
			return [{ path: name, content }];
		} catch {
			// unreadable: try the next name, as Pi does
		}
	}
	return [];
}
