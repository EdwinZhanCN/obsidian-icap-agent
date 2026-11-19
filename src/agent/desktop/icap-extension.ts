import { realpathSync } from "fs";
import { homedir } from "os";
import { isAbsolute, relative, resolve as resolvePath } from "path";
import type { BridgeHandler, Json, ToolScope } from "../backend";
import { ISOLATED_FILE_TOOLS, SHELL_TOOLS, isConnectorTool, mentionsPath } from "../permissions";
import type { ExtensionAPI } from "./pi-sdk-entry";
import { icapTools } from "../tools/icap-tools";
import type { PiSdk } from "./pi-host";

/**
 * ICAP's tools (agent/tools/icap-tools.ts) as an inline extension of the harness, registered on every
 * task's session, and the guard on the harness's own tools (see `icapExtension`).
 */

function expandHome(p: string): string {
	return p === "~" ? homedir() : p.startsWith("~/") ? homedir() + p.slice(1) : p;
}

/** Resolve symlinks as far as the path exists, so a link can't lead outside. */
export function realish(p: string): string {
	let head = p;
	const tail: string[] = [];
	for (;;) {
		try {
			return resolvePath(realpathSync(head), ...tail.reverse());
		} catch {
			const parent = resolvePath(head, "..");
			if (parent === head) return p;
			tail.push(head.slice(parent.length).replace(/^[/\\]/, ""));
			head = parent;
		}
	}
}

export function inside(target: string, root: string): boolean {
	const rel = relative(root, target);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** Isolated mode: may a file tool reach `raw` (relative to `cwd`) given the allowed roots? */
export function allowedPath(raw: string, cwd: string, roots: string[]): boolean {
	const abs = realish(resolvePath(cwd, expandHome(raw.replace(/^@/, ""))));
	return roots.some((r) => inside(abs, realish(r)));
}

/** What the plugin said to a `permit` request (runtime: agent/permissions.ts decides, the learner may be asked). */
async function permitted(bridge: BridgeHandler, payload: Json): Promise<string | null> {
	try {
		const answer = await bridge("permit", payload);
		if (answer.status === "allowed") return null;
		return typeof answer.message === "string" && answer.message ? answer.message : "The learner did not allow this.";
	} catch (e) {
		return (e as Error).message || "The learner did not allow this.";
	}
}

/**
 * The extension that registers ICAP's tools and stands between the agent and what it may do.
 * - Isolated scope (`roots`): the file tools stay inside the vault; `read` may also reach the folders the
 *   learner allowed. There is no shell and no connector to guard: they are not in the session.
 * - Full scope: a shell command and a call to one of the learner's connectors ask the plugin first
 *   (`permit`), which decides by the confirmation mode and may ask the learner in the task's block.
 * Writes are not guarded here: the edit and write tools hand them to the plugin (tool-ops.ts).
 */
export function icapExtension(
	pi: PiSdk,
	bridge: BridgeHandler,
	gate: {
		scope: ToolScope;
		cwd: string;
		/** Isolated scope: the folders `read` may reach. */
		roots?: string[];
		/** The folders a shell command is always asked about when it names one: absolute, and by the name a command run in the vault would use. */
		protectedFolders?: string[];
		protectedNames?: string[];
	},
) {
	const tools = icapTools(pi.Type, bridge);
	return (api: ExtensionAPI) => {
		for (const tool of tools) {
			api.registerTool({
				name: tool.name,
				label: tool.label,
				description: tool.description,
				promptSnippet: tool.promptSnippet,
				parameters: tool.parameters,
				...(tool.sequential ? { executionMode: "sequential" as const } : {}),
				async execute(_id, params) {
					const { text, details } = await tool.execute(params as Record<string, unknown>);
					return { content: [{ type: "text", text }], details };
				},
			});
		}

		api.on("tool_call", async (event, ctx) => {
			const name = event.toolName;
			const input = event.input as { path?: unknown; command?: unknown };
			if (gate.scope === "isolated") {
				if (!(ISOLATED_FILE_TOOLS as readonly string[]).includes(name)) return undefined;
				const raw = typeof input?.path === "string" && input.path.trim() ? input.path.trim() : ".";
				// Reading reaches the vault and the folders the learner allowed; writing, the vault only.
				const roots = name === "read" ? (gate.roots ?? [gate.cwd]) : [gate.cwd];
				if (allowedPath(raw, ctx.cwd, roots)) return undefined;
				return { block: true, reason: name === "read" ? `"${raw}" is outside the vault and the folders the learner allowed.` : `"${raw}" is outside the vault: in this setup files are written only inside it.` };
			}
			if ((SHELL_TOOLS as readonly string[]).includes(name)) {
				const command = typeof input?.command === "string" ? input.command : "";
				const refused = await permitted(bridge, { kind: "shell", tool: name, command, protected: mentionsPath(command, gate.protectedFolders ?? [], gate.protectedNames ?? []) });
				return refused ? { block: true, reason: refused } : undefined;
			}
			if (isConnectorTool(name)) {
				const refused = await permitted(bridge, { kind: "connector", tool: name, input: event.input as Json });
				return refused ? { block: true, reason: refused } : undefined;
			}
			return undefined;
		});
	};
}
