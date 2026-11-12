import { FileSystemAdapter, type App } from "obsidian";
import { join } from "path";
import { L } from "../../i18n";
import type { AgentBackend, AgentConfig, AgentEvents, AgentRequest, AgentResult, AgentRun, BackendAccounts, BackendCapabilities, OwnInstall, SessionCache } from "../backend";
import { EndpointModal } from "./endpoint-modal";
import { DesktopFiles } from "./files";
import { ensureSkills } from "./icap-skills";
import { LoginModal } from "./login-modal";
import { loadPi, type PiSdk } from "./pi-host";
import { providerStates } from "./pi-login";
import { PiSession, probeCommands, probeModels } from "./pi-session";
import { installCommands } from "./rpc/pi-command";
import { PiRpc } from "./rpc/pi-rpc";
import { ensureDir, removeSessions, sessionExists, sessionId } from "./session-cache";

/**
 * Which Pi runs the tasks on desktop.
 * - "builtin": the Pi bundled into main.js, in Obsidian's own process (pi-session.ts).
 * - "rpc": the learner's own installed Pi, one `pi --mode rpc` process per task (rpc/). Always their
 *   whole setup ("mine"): their Pi loads their extensions in its own process.
 */
export type DesktopPi = "builtin" | "rpc";

const CAPABILITIES: BackendCapabilities = {
	ownSetup: true,
	isolatedSetup: true,
	sessionCache: true,
	compact: true,
	oauthLogin: true,
	customEndpoints: true,
	extensionDialogs: true,
	modelProbe: true,
	commandProbe: true,
	externalFiles: true,
	fileTools: true,
	skillFiles: true,
};

/**
 * The desktop backend: Pi's coding agent, with everything the learner's own Pi brings. Two ways to run
 * it (`DesktopPi`), chosen in the settings and read at every run, so a change applies to the next task.
 * Both share Pi's own files: ~/.pi/agent (credentials, models, settings, MCP) and the session format, so
 * a block's cached session resumes under either. Pi's SDK stays behind its lazy import (pi-host.ts):
 * constructing this loads nothing; the first built-in run, probe or `describe` does.
 */
export class DesktopBackend implements AgentBackend {
	readonly platform = "desktop" as const;
	readonly files: DesktopFiles;
	readonly sessions: SessionCache;
	readonly accounts: BackendAccounts;
	private rpc: PiRpc;

	constructor(
		private app: App,
		private opts: {
			/** The plugin's folder on disk (main.js, request blocks' Pi sessions, ICAP's skills). */
			pluginDir: () => string | undefined;
			/** The folders outside the vault the learner allowed (settings), "~" allowed. */
			externalFolders: () => string[];
			/** Which Pi runs the tasks (settings). */
			pi: () => DesktopPi;
			/** The path to the learner's own Pi (settings); empty = found on PATH. */
			piPath: () => string;
		},
	) {
		this.rpc = new PiRpc({ pluginDir: opts.pluginDir, piPath: opts.piPath });
		this.files = new DesktopFiles(() => this.vaultRoot(), opts.externalFolders);
		this.sessions = {
			ready: () => this.sessionDir() !== null,
			setup: (config) => `${config}|${this.vaultRoot()}`,
			id: sessionId,
			exists: (id) => {
				const dir = this.sessionDir();
				return !!dir && sessionExists(dir, id);
			},
			remove: (match) => {
				const dir = this.sessionDir();
				if (dir) removeSessions(dir, match);
			},
		};
		this.accounts = {
			ready: async () => {
				// The learner's own Pi says which providers have credentials through its models; the bundled SDK is not loaded for it.
				if (this.opts.pi() === "rpc") return [...new Set((await this.rpc.probe(this.vaultRoot())).models.available.map((m) => m.slice(0, m.indexOf("/"))))];
				return (await providerStates(await this.pi())).filter((p) => p.configured).map((p) => p.name);
			},
			login: async (done) => new LoginModal(this.app, await this.pi(), done).open(),
			endpoints: async (done) => new EndpointModal(this.app, await this.pi(), done).open(),
		};
	}

	/** The learner's own Pi cannot be told to leave their tools out: it has no isolated setup. */
	get capabilities(): BackendCapabilities {
		return this.opts.pi() === "rpc" ? { ...CAPABILITIES, isolatedSetup: false } : CAPABILITIES;
	}

	/** Pi's SDK, bundled into main.js and loaded on first use (pi-host.ts). */
	private pi(): Promise<PiSdk> {
		const dir = this.opts.pluginDir();
		return loadPi(dir ? `${dir}/main.js` : undefined);
	}

	/** The vault's folder on disk: Pi's working directory. */
	private vaultRoot(): string {
		const a = this.app.vault.adapter;
		if (a instanceof FileSystemAdapter) return a.getBasePath();
		throw new Error(L("This plugin needs the desktop app (a vault on disk).", "此插件需要桌面版（Vault 在本地磁盘上）。"));
	}

	/** Where request blocks' Pi sessions live: next to the plugin, out of the vault's notes. */
	private sessionDir(): string | null {
		const dir = this.opts.pluginDir();
		if (!dir) return null;
		try {
			return ensureDir(join(dir, "sessions"));
		} catch {
			return null;
		}
	}

	/** ICAP's own skills, written into the plugin folder (inside the vault, readable in isolated mode). */
	private icapSkills(names: string[]): string[] {
		const dir = this.opts.pluginDir();
		if (!dir || !names.length) return [];
		try {
			return ensureSkills(dir, names);
		} catch {
			return [];
		}
	}

	run(req: AgentRequest, events: AgentEvents): AgentRun {
		if (this.opts.pi() === "rpc") return this.runRpc(req, events);
		let cancelled = false;
		let session: PiSession | null = null;
		const result = (async (): Promise<AgentResult> => {
			const pi = await this.pi();
			if (cancelled) return { text: "", aborted: true };
			const cwd = this.vaultRoot();
			const dir = req.session ? this.sessionDir() : null;
			session = new PiSession({
				...events,
				pi,
				cwd,
				config: req.config,
				// Isolated mode: file tools may only reach the vault and the folders the learner allowed.
				allowedRoots: [cwd, ...this.files.roots()],
				skillPaths: this.icapSkills(req.icapSkills),
				systemPrompt: req.systemPrompt,
				prompt: req.prompt,
				tools: req.tools,
				model: req.model,
				thinking: req.thinking,
				session: req.session && dir ? { id: req.session, dir } : undefined,
				control: req.control,
			});
			return session.run();
		})();
		return {
			result,
			cancel: () => {
				cancelled = true;
				session?.cancel();
			},
		};
	}

	/** A run on the learner's own Pi. Resolving the request's paths can throw: that rejects `result`, like any failed start. */
	private runRpc(req: AgentRequest, events: AgentEvents): AgentRun {
		try {
			const dir = req.session ? this.sessionDir() : null;
			return this.rpc.run(
				{
					cwd: this.vaultRoot(),
					systemPrompt: req.systemPrompt,
					prompt: req.prompt,
					tools: req.tools,
					skillPaths: this.icapSkills(req.icapSkills),
					model: req.model,
					thinking: req.thinking,
					session: req.session && dir ? { id: req.session, dir } : undefined,
					control: req.control,
				},
				events,
			);
		} catch (e) {
			return { result: Promise.reject(e instanceof Error ? e : new Error(String(e))), cancel: () => undefined };
		}
	}

	async describe(fresh = false): Promise<string> {
		if (this.opts.pi() === "rpc") return this.rpc.describe(fresh);
		return `Pi ${(await this.pi()).VERSION}`;
	}

	/** The learner's own Pi, while it is the one in use: where it was found, and how to install it. */
	get ownInstall(): OwnInstall | undefined {
		if (this.opts.pi() !== "rpc") return undefined;
		return { locate: async (fresh) => (await this.rpc.locate(fresh)).path, installCommand: installCommands().installer };
	}

	async probeModels(config: AgentConfig, fresh = false) {
		if (this.opts.pi() === "rpc") return (await this.rpc.probe(this.vaultRoot(), fresh)).models;
		return probeModels(await this.pi(), this.vaultRoot(), config, fresh);
	}

	async probeCommands() {
		if (this.opts.pi() === "rpc") return (await this.rpc.probe(this.vaultRoot())).commands;
		return probeCommands(await this.pi(), this.vaultRoot());
	}

	dispose() {
		this.rpc.dispose();
	}
}
