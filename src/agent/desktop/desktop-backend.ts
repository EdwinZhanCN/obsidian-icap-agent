import { FileSystemAdapter, type App } from "obsidian";
import { join } from "path";
import { L } from "../../i18n";
import type { AgentBackend, AgentConfig, AgentEvents, AgentRequest, AgentResult, AgentRun, BackendAccounts, BackendCapabilities, SessionCache } from "../backend";
import { EndpointModal } from "./endpoint-modal";
import { DesktopFiles } from "./files";
import { ensureSkills } from "./icap-skills";
import { LoginModal } from "./login-modal";
import { loadPi, type PiSdk } from "./pi-host";
import { providerStates } from "./pi-login";
import { PiSession, probeCommands, probeModels } from "./pi-session";
import { ensureDir, removeSessions, sessionExists, sessionId } from "./session-cache";

/**
 * The desktop backend: Pi's coding agent in-process on Node (pi-session.ts), with everything the
 * learner's own Pi brings. Pi's SDK stays behind its lazy import (pi-host.ts): constructing this loads
 * nothing; the first run, probe or `describe` does.
 */
export class DesktopBackend implements AgentBackend {
	readonly platform = "desktop" as const;
	readonly capabilities: BackendCapabilities = {
		ownSetup: true,
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
	readonly files: DesktopFiles;
	readonly sessions: SessionCache;
	readonly accounts: BackendAccounts;

	constructor(
		private app: App,
		private opts: {
			/** The plugin's folder on disk (main.js, request blocks' Pi sessions, ICAP's skills). */
			pluginDir: () => string | undefined;
			/** The folders outside the vault the learner allowed (settings), "~" allowed. */
			externalFolders: () => string[];
		},
	) {
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
			ready: async () => (await providerStates(await this.pi())).filter((p) => p.configured).map((p) => p.name),
			login: async (done) => new LoginModal(this.app, await this.pi(), done).open(),
			endpoints: async (done) => new EndpointModal(this.app, await this.pi(), done).open(),
		};
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
	private icapSkills(): string[] {
		const dir = this.opts.pluginDir();
		if (!dir) return [];
		try {
			return ensureSkills(dir);
		} catch {
			return [];
		}
	}

	run(req: AgentRequest, events: AgentEvents): AgentRun {
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
				skillPaths: req.icapSkills ? this.icapSkills() : [],
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

	async describe(): Promise<string> {
		return `Pi ${(await this.pi()).VERSION}`;
	}

	async probeModels(config: AgentConfig, fresh = false) {
		return probeModels(await this.pi(), this.vaultRoot(), config, fresh);
	}

	async probeCommands() {
		return probeCommands(await this.pi(), this.vaultRoot());
	}
}
