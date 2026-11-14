import { constants } from "fs";
import { access, mkdir, readFile, writeFile } from "fs/promises";
import { dirname, join, relative, sep } from "path";
import type { BridgeHandler } from "../backend";
import type { WriteTarget } from "../permissions";
import { inside, realish } from "./icap-extension";
import type { ToolsOptions } from "./pi-sdk-entry";

/** The folders that matter to where a write lands. */
export interface WritePlaces {
	/** The vault's folder. */
	vault: string;
	/** Obsidian's own folder inside the vault, by name (`.obsidian` unless the learner renamed it). */
	configDir: string;
	/** Pi's own folder (~/.pi/agent): credentials, connector configuration. */
	agentDir: string;
}

/** The folders a write always asks about, absolute: Obsidian's own, Pi's own, and the vault's `.pi` (it can name connectors to start). */
export function protectedFolders(places: WritePlaces): string[] {
	return [join(places.vault, places.configDir), places.agentDir, join(places.vault, ".pi")];
}

/**
 * Where a file is, for the confirmation rules (agent/permissions.ts), with links resolved so a link in
 * the vault cannot stand for a file outside it. `rel`: its path in the vault, when it is inside the
 * vault's folder.
 */
export function classifyWrite(absolutePath: string, places: WritePlaces): { target: WriteTarget; rel?: string } {
	const real = realish(absolutePath);
	const vault = realish(places.vault);
	const rel = inside(real, vault) ? relative(vault, real).split(sep).join("/") : undefined;
	const guarded = protectedFolders(places).some((folder) => inside(real, realish(folder)));
	return { target: guarded ? "protected" : rel !== undefined ? "vault" : "outside", ...(rel ? { rel } : {}) };
}

/**
 * How the harness's edit and write tools act inside ICAP: they keep their names and parameters (what
 * models are trained on), but a write is handed to the plugin instead of going to disk.
 *
 * The plugin (runtime: bridge operation `write_file`) decides by the tool scope and the confirmation
 * mode (agent/permissions.ts): refuse it, show the learner the diff and wait, or let it land at once.
 * It keeps the original before any write. Its answer:
 * - "written": the plugin wrote the file itself (a file in the vault, through the open editor when
 *   there is one, so the learner's view and undo history stay whole);
 * - "direct": write it here (a file outside the vault, which the plugin's vault access cannot reach);
 * - anything else: not written; `message` says why, and that is what the model is told.
 */
export function gatedToolOptions(bridge: BridgeHandler, places: WritePlaces): ToolsOptions {
	const write = async (absolutePath: string, content: string): Promise<void> => {
		const answer = await bridge("write_file", { path: absolutePath, content, ...classifyWrite(absolutePath, places) });
		if (answer.status === "written") return;
		if (answer.status === "direct") {
			await mkdir(dirname(absolutePath), { recursive: true });
			await writeFile(absolutePath, content, "utf-8");
			return;
		}
		throw new Error(typeof answer.message === "string" && answer.message ? answer.message : "The learner declined this change; the file is as it was.");
	};
	return {
		edit: {
			operations: {
				readFile: (path) => readFile(path),
				access: (path) => access(path, constants.R_OK | constants.W_OK),
				writeFile: write,
			},
		},
		write: {
			operations: {
				writeFile: write,
				// The folder is made with the file, once the write is allowed: nothing is created for a change that is declined.
				mkdir: async () => undefined,
			},
		},
	};
}
