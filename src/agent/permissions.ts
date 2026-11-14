/**
 * What the built-in agent may do without asking. Two settings, kept apart: the tool scope decides what
 * the agent has, the confirmation mode decides when it stops to ask. Pure: no platform, no vault.
 *
 * | confirmation \ scope | isolated: ICAP's tools + read, edit, write in the vault | full: also the shell and connectors |
 * |---|---|---|
 * | ask                  | a change shows its diff first and lands when the learner agrees | the same; the shell and connectors ask every time |
 * | auto-edits           | changes in the vault land at once, their diff kept               | the same; the shell and connectors still ask |
 * | skip                 | as auto-edits; the vault is the boundary                         | everything runs at once, no boundary |
 *
 * Three things no mode changes:
 * - `ask_learner` always waits. It is a question, not a permission.
 * - A write to a protected folder always asks: the vault's Obsidian folder (a plugin can be installed
 *   there) and Pi's own folder (credentials, connector configuration).
 * - The original of a file is kept before each write (runtime/backups.ts): once changes land by
 *   themselves, being able to put one back is worth more than having been able to stop it.
 *
 * There is no mode in which a model judges each action: the learner brings their own key, so that cost
 * and delay would be theirs. "In the vault by itself, outside it asks" needs only rules.
 */

/**
 * What the agent has.
 * - "isolated": ICAP's tools, and read, edit and write inside the vault (read also in the folders the
 *   learner allowed). No shell, no connectors: a remote connector can send what is in the vault
 *   elsewhere, which the vault as a boundary does not cover.
 * - "full": also the shell and the learner's connectors (MCP servers), and files outside the vault.
 *   With the learner's own installed Pi it is their whole Pi setup, extensions included.
 */
export type ToolScope = "isolated" | "full";

/** When the agent stops to ask. See the table above. */
export type ConfirmMode = "ask" | "auto-edits" | "skip";

export const CONFIRM_MODES: readonly ConfirmMode[] = ["ask", "auto-edits", "skip"];

/** Where a write lands. */
export type WriteTarget = "vault" | "protected" | "outside";

/** "refuse": the scope does not reach there. "ask": the learner decides. "direct": it happens at once. */
export type Decision = "refuse" | "ask" | "direct";

/** May a file be written (the edit and write tools)? */
export function writeDecision(scope: ToolScope, confirm: ConfirmMode, target: WriteTarget, protectedInVault = false): Decision {
	if (target === "protected") {
		// Pi's own folder is outside the vault: the isolated scope does not reach it at all.
		return scope === "isolated" && !protectedInVault ? "refuse" : "ask";
	}
	if (target === "outside") {
		if (scope === "isolated") return "refuse";
		return confirm === "skip" ? "direct" : "ask";
	}
	return confirm === "ask" ? "ask" : "direct";
}

/** What reaches beyond files: a shell command, or a call to one of the learner's connectors. */
export type ActionKind = "shell" | "connector";

/**
 * May a shell command or a connector call run? `touchesProtected`: the command names a protected folder
 * (see `mentionsPath`): the one case that asks even when everything else runs at once.
 */
export function actionDecision(scope: ToolScope, confirm: ConfirmMode, touchesProtected = false): Decision {
	if (scope === "isolated") return "refuse";
	if (confirm !== "skip") return "ask";
	return touchesProtected ? "ask" : "direct";
}

/**
 * Does a shell command name one of these folders? What a command writes cannot be known from its text, so
 * this is a rule of thumb, not a guarantee: it catches the plain cases (`rm -rf .obsidian/plugins/x`,
 * `echo … > ~/.pi/agent/mcp.json`), not a path built at run time.
 * `paths`: absolute folders; `relative`: the same folders as a command run in the vault may write them.
 */
export function mentionsPath(command: string, paths: string[], relative: string[] = []): boolean {
	const text = command.replace(/\\/g, "/");
	const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
	for (const p of paths.map(norm)) if (p && text.includes(p)) return true;
	for (const r of relative.map(norm)) {
		if (!r) continue;
		// The folder as a path segment: `.obsidian/…`, `./.obsidian`, ` .obsidian `, quoted or at the end.
		const escaped = r.replace(/[.*+?^${}()|[\]]/g, "\\$&");
		if (new RegExp(`(^|[\\s"'=/:(])${escaped}($|[\\s"'/;)])`).test(text)) return true;
	}
	return false;
}

/** The tools of the harness the isolated scope keeps: files, never the shell. */
export const ISOLATED_FILE_TOOLS = ["read", "edit", "write"] as const;
/** The shell tools, by platform default: bash, and PowerShell where there is no bash (Windows without Git Bash). */
export const SHELL_TOOLS = ["bash", "powershell"] as const;

/** Is this one of the learner's connector tools (an MCP tool, as Pi names them)? */
export function isConnectorTool(name: string): boolean {
	return name.startsWith("mcp__") || name === "list_mcp_resources" || name === "list_mcp_resource_templates" || name === "read_mcp_resource";
}
