import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { randomBytes } from "crypto";
import { homedir, tmpdir } from "os";
import { join } from "path";
import { Type } from "typebox";
import { L } from "../../../i18n";
import type { AgentEvents, AgentImage, AgentResult, AgentRun, Control } from "../../backend";
import { CONTEXT_FILE_NAMES, withProjectContext, type ContextFile } from "../../context-files";
import { ICAP_TOOLS, icapTools } from "../../tools/icap-tools";
import { loginEnv } from "../pi-host";
import { ToolBridge } from "./bridge-server";
import { ensureForwarder } from "./icap-forwarder";
import { findPi, type PiCommand } from "./pi-command";
import { RpcSession, probePi, type PiProbe } from "./rpc-session";

/**
 * The learner's own Pi as a backend: found on this computer (pi-command.ts), started once per task as
 * `pi --mode rpc` (rpc-session.ts), given ICAP's tools over a local socket (bridge-server.ts,
 * icap-forwarder.ts). Pi's configuration is the learner's and stays theirs: ~/.pi/agent (auth.json,
 * models.json, settings.json, mcp.json, extensions, skills) and the vault's .pi/. Nothing of Pi is
 * loaded into Obsidian.
 */

/** What a task needs from the backend's request, resolved to paths on disk. */
export interface RpcRequest {
	/** The vault's folder: Pi's working directory. */
	cwd: string;
	systemPrompt: string;
	prompt: string;
	/** Which of ICAP's tools this task offers; the learner's own tools are left alone. */
	tools: string[];
	skillPaths: string[];
	model?: string;
	thinking?: string;
	session?: { id: string; dir: string };
	control?: Control;
	images?: AgentImage[];
}

/** Pi's own folder, as Pi finds it: `PI_CODING_AGENT_DIR`, else ~/.pi/agent. */
export function piAgentDir(env: NodeJS.ProcessEnv): string {
	const set = env.PI_CODING_AGENT_DIR?.trim();
	if (!set) return join(homedir(), ".pi", "agent");
	return set === "~" ? homedir() : /^~[\\/]/.test(set) ? join(homedir(), set.slice(2)) : set;
}

/**
 * The context files (AGENTS.md and its kin) a task sees: Pi's global one and the vault's own, the first
 * of Pi's names in each folder, in Pi's order. Never an ancestor's: a vault under ~/ or inside a
 * repository would otherwise be told what was written for other work.
 */
export function contextFiles(vault: string, agentDir: string): ContextFile[] {
	const out: ContextFile[] = [];
	for (const dir of agentDir === vault ? [vault] : [agentDir, vault]) {
		for (const name of CONTEXT_FILE_NAMES) {
			const path = join(dir, name);
			try {
				if (!existsSync(path)) continue;
				out.push({ path, content: readFileSync(path, "utf8").replace(/^﻿/, "") });
				break;
			} catch {
				// unreadable: try the next name, as Pi does
			}
		}
	}
	return out;
}

/** How long what Pi answered about itself (models, commands) is taken as current. */
const PROBE_TTL_MS = 30000;

export class PiRpc {
	private located: { key: string; pi: Promise<PiCommand> } | null = null;
	private bridge: ToolBridge | null = null;
	private scratch: string | null = null;
	private probed: { key: string; at: number; probe: Promise<PiProbe> } | null = null;
	private running = new Set<RpcSession>();
	private seq = 0;

	constructor(
		private opts: {
			/** The plugin's folder on disk: where `pi/icap-extension.js` is written. */
			pluginDir: () => string | undefined;
			/** The path to Pi from the settings; empty = look on PATH. */
			piPath: () => string;
			/** The environment Pi runs in; by default Obsidian's plus the login shell's (pi-host.ts). */
			env?: () => Promise<NodeJS.ProcessEnv>;
		},
	) {}

	/** The learner's Pi, found once per path; `fresh` looks again (they installed or updated it). Throws `SetupNeeded`. */
	locate(fresh = false): Promise<PiCommand> {
		const key = this.opts.piPath().trim();
		if (!this.located || this.located.key !== key || fresh) {
			const pi = (async () => findPi(key, await (this.opts.env ?? loginEnv)()))();
			const entry = { key, pi };
			this.located = entry;
			// A Pi that was not found is looked for again next time.
			pi.catch(() => {
				if (this.located === entry) this.located = null;
			});
		}
		return this.located.pi;
	}

	/**
	 * A folder only this user can open, for the socket and the prompt files; made on first use. The system
	 * clears temporary folders that sit unused for days (Obsidian stays open that long): one that is gone
	 * is made again, and the socket in it with it.
	 */
	private scratchDir(): string {
		if (this.scratch && !existsSync(this.scratch)) {
			this.scratch = null;
			this.bridge?.dispose();
			this.bridge = null;
		}
		this.scratch ??= mkdtempSync(join(tmpdir(), "icap-"));
		return this.scratch;
	}

	private toolBridge(): ToolBridge {
		const dir = this.scratchDir();
		// Windows has no socket files: a named pipe, whose name is unguessable and which only this user's processes reach.
		this.bridge ??= new ToolBridge(process.platform === "win32" ? `\\\\.\\pipe\\icap-${randomBytes(12).toString("hex")}` : join(dir, "bridge.sock"));
		return this.bridge;
	}

	run(req: RpcRequest, events: AgentEvents): AgentRun {
		let cancelled = false;
		let session: RpcSession | null = null;
		const result = (async (): Promise<AgentResult> => {
			const pi = await this.locate();
			if (cancelled) return { text: "", aborted: true };
			const pluginDir = this.opts.pluginDir();
			if (!pluginDir) throw new Error(L("This plugin needs the desktop app (a vault on disk).", "此插件需要桌面版（Vault 在本地磁盘上）。"));
			const tools = icapTools(Type, events.onBridge);
			const offered = ICAP_TOOLS.filter((t) => req.tools.includes(t));
			const task = await this.toolBridge().open(async (name, params) => {
				const tool = offered.includes(name) ? tools.find((t) => t.name === name) : undefined;
				if (!tool) throw new Error(`“${name}” is not available for this task.`);
				return tool.execute(params);
			}, offered);
			const promptFile = join(this.scratchDir(), `prompt-${++this.seq}.md`);
			try {
				writeFileSync(promptFile, withProjectContext(req.systemPrompt, contextFiles(req.cwd, piAgentDir(pi.env))));
				session = new RpcSession({
					...events,
					pi,
					cwd: req.cwd,
					promptFile,
					prompt: req.prompt,
					bridge: { extension: ensureForwarder(pluginDir, tools), env: task.env },
					skillPaths: req.skillPaths,
					model: req.model,
					thinking: req.thinking,
					session: req.session,
					control: req.control,
					images: req.images,
				});
				this.running.add(session);
				if (cancelled) session.cancel();
				return await session.run();
			} finally {
				if (session) this.running.delete(session);
				task.close();
				rmSync(promptFile, { force: true });
			}
		})();
		return {
			result,
			cancel: () => {
				cancelled = true;
				session?.cancel();
			},
			steer: (text, images) => session?.steer(text, images) ?? false,
		};
	}

	/** "Pi 1.5.0", as the learner's Pi says. */
	async describe(fresh = false): Promise<string> {
		return `Pi ${(await this.locate(fresh)).version}`;
	}

	/** Pi's models and commands, asked once and kept for a moment (the settings and a block's `/` ask close together). */
	probe(cwd: string, fresh = false): Promise<PiProbe> {
		const key = `${this.opts.piPath().trim()}|${cwd}`;
		const p = this.probed;
		if (!p || p.key !== key || fresh || Date.now() - p.at > PROBE_TTL_MS) {
			const probe = (async () => probePi(await this.locate(), cwd))();
			const entry = { key, at: Date.now(), probe };
			this.probed = entry;
			probe.catch(() => {
				if (this.probed === entry) this.probed = null;
			});
		}
		return this.probed!.probe;
	}

	/** The plugin unloads: stop what runs, close the socket, remove the scratch folder. */
	dispose() {
		for (const s of this.running) s.cancel();
		this.running.clear();
		this.bridge?.dispose();
		this.bridge = null;
		if (this.scratch) rmSync(this.scratch, { recursive: true, force: true });
		this.scratch = null;
	}
}
