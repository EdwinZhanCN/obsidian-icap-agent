import { realpathSync } from "fs";
import { homedir } from "os";
import { isAbsolute, relative, resolve as resolvePath } from "path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { BridgeHandler } from "../backend";
import { icapTools } from "../tools/icap-tools";
import type { PiSdk } from "./pi-host";

/**
 * ICAP's tools (agent/tools/icap-tools.ts) as a Pi inline extension, registered in-process on every
 * task's Pi session (it loads even with noExtensions). In isolated mode it also guards Pi's own file
 * tools: they stay inside the vault and the folders the learner allowed.
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

/**
 * The extension that registers ICAP's tools. `roots` (isolated mode): file tools stay inside the vault
 * and the folders the learner allowed.
 */
export function icapExtension(pi: PiSdk, bridge: BridgeHandler, roots?: string[]) {
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

		if (roots) {
			api.on("tool_call", async (event, ctx) => {
				if (!["read", "grep", "find", "ls"].includes(event.toolName)) return undefined;
				const input = event.input as { path?: unknown };
				const raw = typeof input?.path === "string" && input.path.trim() ? input.path.trim() : ".";
				if (allowedPath(raw, ctx.cwd, roots)) return undefined;
				return { block: true, reason: `"${raw}" is outside the vault and the folders the learner allowed.` };
			});
		}
	};
}
