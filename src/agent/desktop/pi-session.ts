import type { AgentSession, ExtensionUIContext } from "./pi-sdk-entry";
import { dirname, resolve } from "path";
import { SetupNeeded, type AgentCommand, type AgentEvents, type AgentImage, type AgentResult, type Control, type DialogAnswer, type DialogRequest, type ModelList, type ToolScope } from "../backend";
import { ISOLATED_FILE_TOOLS } from "../permissions";
import { ICAP_TOOLS } from "../tools/icap-tools";
import { icapExtension, inside } from "./icap-extension";
import { HANDLED_GRACE_MS, PiEvents, imageContent, type PiEventView } from "./pi-events";
import { findModel, modelRuntime, projectTrusted, type PiSdk } from "./pi-host";
import { gatedToolOptions, protectedFolders } from "./tool-ops";

/** A run as PiSession needs it: the backend's request resolved to paths on disk, and its events. */
export interface RunOptions extends AgentEvents {
	pi: PiSdk;
	cwd: string;
	scope: ToolScope;
	systemPrompt: string;
	prompt: string;
	/**
	 * The tools this task uses. Isolated: the exact allowlist. Full: only decides which ICAP tools
	 * are hidden; the shell, the connectors and the file tools are left alone.
	 */
	tools: string[];
	/** Isolated scope: `read` may only reach these folders (the vault + what the learner allowed). */
	allowedRoots?: string[];
	/** Obsidian's own folder inside the vault, by name; `.obsidian` unless the learner renamed it. */
	configDir?: string;
	/** ICAP's own skills (folders with a SKILL.md, agent/desktop/icap-skills.ts), offered in both setups. */
	skillPaths?: string[];
	/** provider/id; empty = Pi's default. */
	model?: string;
	thinking?: string;
	/**
	 * Resume or create this Pi session (a file in `dir`) instead of running without one.
	 * See agent/desktop/session-cache.ts: the session is a cache of the block's conversation.
	 */
	session?: { id: string; dir: string };
	/** Run this control instead of the prompt; the run ends when it is done. */
	control?: Control;
	/** Images that go with the prompt (a model that does not read images gets none). */
	images?: AgentImage[];
}

/** What the session factory is told for each tool scope. Pure. */
export interface SessionPlan {
	/** Skip what is discovered on disk: the learner's skills and prompt templates. */
	bare: boolean;
	/** Which AGENTS.md / CLAUDE.md apply: the vault's only, or also Pi's global one (see vaultContextFiles). */
	contextFiles: "vault" | "vault+pi";
	/** The learner's connectors (MCP servers, ~/.pi/agent/mcp.json): full scope only. */
	connectors: boolean;
	systemPrompt?: string;
	appendSystemPrompt?: string[];
	tools?: string[];
	excludeTools?: string[];
}

/**
 * `shell`: which shell tool the full scope has. "bash" everywhere a bash exists; "powershell" on Windows
 * without one (no Git Bash), so nothing has to be installed.
 */
export function sessionPlan(o: Pick<RunOptions, "scope" | "systemPrompt" | "tools">, shell: "bash" | "powershell" = "bash"): SessionPlan {
	if (o.scope === "isolated") {
		// The exact allowlist, and of the harness's own tools never more than the file tools.
		const tools = o.tools.filter((t) => ICAP_TOOLS.includes(t) || (ISOLATED_FILE_TOOLS as readonly string[]).includes(t));
		return { bare: true, contextFiles: "vault", connectors: false, systemPrompt: o.systemPrompt, tools };
	}
	const hidden = ICAP_TOOLS.filter((t) => !o.tools.includes(t));
	return {
		bare: false,
		contextFiles: "vault+pi",
		connectors: true,
		appendSystemPrompt: [o.systemPrompt],
		...(shell === "powershell" ? { tools: ["+powershell", "-bash"] } : {}),
		...(hidden.length ? { excludeTools: hidden } : {}),
	};
}

/**
 * The context files (AGENTS.md, CLAUDE.md) a task sees: those inside the vault and, unless `vaultOnly`,
 * Pi's global one (~/.pi/agent/AGENTS.md). Pi also walks up from the vault to the filesystem root,
 * which picks up files written for other work — ~/AGENTS.md, the AGENTS.md of a repository the vault
 * sits in — so those are left out. Pure.
 */
export function vaultContextFiles<T extends { path: string }>(files: T[], vault: string, agentDir: string, vaultOnly = false): T[] {
	const root = resolve(vault);
	const global = resolve(agentDir);
	return files.filter((f) => {
		const dir = dirname(resolve(f.path));
		return (!vaultOnly && dir === global) || inside(dir, root);
	});
}

export { extensionName, stepDetail } from "./pi-events";

/** Build a session for a task (or a probe): the learner's Pi configuration, shaped by the plan. */
async function openSession(
	o: Pick<RunOptions, "pi" | "cwd" | "scope" | "systemPrompt" | "tools" | "allowedRoots" | "configDir" | "skillPaths" | "model" | "thinking" | "session" | "onBridge">,
): Promise<AgentSession> {
	const { pi, cwd } = o;
	const plan = sessionPlan(o, pi.shellTool());
	const agentDir = pi.getAgentDir();
	const places = { vault: cwd, configDir: o.configDir ?? ".obsidian", agentDir };
	const settingsManager = pi.SettingsManager.create(cwd, agentDir, { projectTrusted: projectTrusted(pi, cwd, o.scope) });
	const factories = [
		icapExtension(pi, o.onBridge, { scope: o.scope, cwd, roots: o.allowedRoots, protectedFolders: protectedFolders(places), protectedNames: [places.configDir, ".pi"] }),
		// A built-in of the harness: named, so `/mcp` and its tools are attributed to it.
		...(plan.connectors ? [{ name: "mcp", factory: pi.createMcpExtension(), builtin: true }] : []),
	];
	const resourceLoader = new pi.DefaultResourceLoader({
		cwd,
		agentDir,
		settingsManager,
		extensionFactories: factories,
		noSkills: plan.bare,
		noPromptTemplates: plan.bare,
		// ICAP's own skills are offered even with noSkills.
		additionalSkillPaths: o.skillPaths ?? [],
		systemPrompt: plan.systemPrompt,
		appendSystemPrompt: plan.appendSystemPrompt,
		agentsFilesOverride: ({ agentsFiles }) => ({ agentsFiles: vaultContextFiles(agentsFiles, cwd, agentDir, plan.contextFiles === "vault") }),
	});
	await resourceLoader.reload();
	const runtime = await modelRuntime(pi);
	const model = o.model?.trim() ? findModel(runtime, o.model.trim()) : undefined;
	if (o.model?.trim() && !model) throw new Error(`Pi has no model “${o.model.trim()}”.`);
	const sessionManager = o.session
		? (() => {
				const existing = pi.SessionManager.findById(cwd, o.session.id, o.session.dir);
				return existing ? pi.SessionManager.open(existing, o.session.dir) : pi.SessionManager.create(cwd, o.session.dir, { id: o.session.id });
			})()
		: pi.SessionManager.inMemory(cwd);
	const { session } = await pi.createAgentSession({
		cwd,
		agentDir,
		modelRuntime: runtime,
		settingsManager,
		resourceLoader,
		sessionManager,
		// edit and write hand their writes to the plugin: reviewed, or landed and recorded, by the confirmation mode.
		toolOptions: gatedToolOptions(o.onBridge, places),
		...(model ? { model } : {}),
		...(o.thinking?.trim() ? { thinkingLevel: o.thinking.trim() as never } : {}),
		...(plan.tools ? { tools: plan.tools } : {}),
		...(plan.excludeTools ? { excludeTools: plan.excludeTools } : {}),
	});
	return session;
}

/** Dialog-free UI for a session nobody answers (probes). */
function silentUi(): ExtensionUIContext {
	return uiContext({ dialog: async () => undefined, notify: () => undefined });
}

/**
 * The UI Pi's extensions talk to. Dialogs become questions in the note; notices are collected; terminal
 * chrome (status, widgets, titles, themes) has no place in a note and is ignored.
 */
function uiContext(h: { dialog: (req: DialogRequest, timeout?: number) => Promise<DialogAnswer>; notify: (message: string) => void }): ExtensionUIContext {
	const theme = new Proxy({}, { get: () => (...args: unknown[]) => (typeof args[args.length - 1] === "string" ? args[args.length - 1] : "") });
	const ui = {
		select: async (title: string, options: string[], opts?: { timeout?: number }) => {
			const a = await h.dialog({ method: "select", title, options }, opts?.timeout);
			return a && "value" in a ? a.value : undefined;
		},
		confirm: async (title: string, message: string, opts?: { timeout?: number }) => {
			const a = await h.dialog({ method: "confirm", title, message }, opts?.timeout);
			return !!a && "confirmed" in a && a.confirmed;
		},
		input: async (title: string, placeholder?: string, opts?: { timeout?: number }) => {
			const a = await h.dialog({ method: "input", title, placeholder }, opts?.timeout);
			return a && "value" in a ? a.value : undefined;
		},
		editor: async (title: string, prefill?: string) => {
			const a = await h.dialog({ method: "editor", title, prefill });
			return a && "value" in a ? a.value : undefined;
		},
		notify: (message: string) => {
			if (typeof message === "string" && message.trim()) h.notify(message.trim());
		},
		onTerminalInput: () => () => undefined,
		setStatus: () => undefined,
		setWorkingMessage: () => undefined,
		setWorkingVisible: () => undefined,
		setWorkingIndicator: () => undefined,
		setHiddenThinkingLabel: () => undefined,
		setWidget: () => undefined,
		setFooter: () => undefined,
		setHeader: () => undefined,
		setTitle: () => undefined,
		custom: async () => undefined,
		pasteToEditor: () => undefined,
		setEditorText: () => undefined,
		getEditorText: () => "",
		addAutocompleteProvider: () => undefined,
		setEditorComponent: () => undefined,
		getEditorComponent: () => undefined,
		get theme() {
			return theme;
		},
		getAllThemes: () => [],
		getTheme: () => undefined,
		setTheme: () => ({ success: false, error: "Themes do not apply inside Obsidian." }),
		getToolsExpanded: () => false,
		setToolsExpanded: () => undefined,
	};
	return ui as unknown as ExtensionUIContext;
}

/**
 * One session of the harness per task, in-process. Tasks are independent learning acts; a request
 * block's follow-ups may resume the same *session* (a file, in Pi's format).
 */
export class PiSession {
	private session: AgentSession | null = null;
	private events: PiEvents;
	private cancelled = false;
	private handled = false;
	/** The prompt is with the agent: from here on a steering message can reach it. */
	private prompting = false;

	constructor(private opts: RunOptions) {
		this.events = new PiEvents(opts);
	}

	async run(): Promise<AgentResult> {
		const o = this.opts;
		o.onPhase?.("starting");
		let session: AgentSession;
		try {
			session = await openSession(o);
		} catch (e) {
			// What the learner has to set up says so itself, with the way into the settings.
			if (e instanceof SetupNeeded) throw e;
			throw new Error(`Pi could not start: ${(e as Error).message}`);
		}
		this.session = session;
		const unsubscribe = session.subscribe((ev) => {
			this.events.handle(ev as unknown as PiEventView);
			// A turn ended: how full the model's context is now (the session knows its model's window).
			if (ev.type === "turn_end") {
				const used = session.getContextUsage();
				if (used && typeof used.tokens === "number" && used.contextWindow > 0) o.onContext?.(used.tokens, used.contextWindow);
			}
		});
		try {
			await session.bindExtensions({
				uiContext: uiContext({ dialog: (req, timeout) => this.dialog(req, timeout), notify: (m) => this.events.notify(m) }),
				mode: "rpc",
				onError: (err) => this.events.extensionError(err.extensionPath, err.error),
			});
			if (this.cancelled) return this.result();
			if (o.control) {
				await session.compact(o.control.customInstructions);
				return this.result();
			}
			let images = imageContent(o.images);
			if (images && !session.model?.input?.includes("image")) {
				images = undefined;
				o.onImagesDropped?.();
			}
			let disposition: string | undefined;
			this.prompting = true;
			await session.prompt(o.prompt, { source: "rpc", preflightResult: (d) => (disposition = d), ...(images ? { images } : {}) });
			if (disposition === "handled") {
				this.handled = true;
				// An extension command may start a turn of its own (pi.sendUserMessage) a moment later.
				await new Promise((r) => window.setTimeout(r, HANDLED_GRACE_MS));
			}
			await session.waitForIdle();
			return this.result();
		} catch (e) {
			if (this.cancelled) return this.result();
			throw e instanceof Error ? e : new Error(String(e));
		} finally {
			unsubscribe();
			session.dispose();
			this.session = null;
			this.prompting = false;
		}
	}

	cancel() {
		if (this.cancelled) return;
		this.cancelled = true;
		void this.session?.abort();
	}

	/** A message for the agent while it works: it reads it after its current tool calls. False when the run cannot take one. */
	steer(text: string, images?: AgentImage[]): boolean {
		const session = this.session;
		if (!session || !this.prompting || this.cancelled) return false;
		this.events.expectSteer(text);
		const sees = session.model?.input?.includes("image");
		session.steer(text, sees ? imageContent(images) : undefined, { source: "rpc" }).catch(() => this.events.forgetSteer(text));
		return true;
	}

	private result(): AgentResult {
		return this.events.result(this.cancelled, this.handled);
	}

	/** A dialog from one of the learner's own extensions (e.g. a permission gate): ask in the note. */
	private async dialog(req: DialogRequest, timeout?: number): Promise<DialogAnswer> {
		if (!this.opts.onDialog || this.cancelled) return undefined;
		const ctl = new AbortController();
		// Pi resolves a timed-out dialog itself; withdraw the question when that happens.
		const timer = typeof timeout === "number" && timeout > 0 ? window.setTimeout(() => ctl.abort(), timeout) : null;
		try {
			const answer = await this.opts.onDialog(req, ctl.signal);
			return ctl.signal.aborted ? undefined : answer;
		} catch {
			return undefined;
		} finally {
			if (timer) window.clearTimeout(timer);
		}
	}
}

/* ───────────── Probes: nothing is sent to a model ───────────── */

/** Open a session the way tasks do, read from it, and close it. */
async function probe<T>(pi: PiSdk, cwd: string, scope: ToolScope, read: (s: AgentSession) => T | Promise<T>): Promise<T> {
	const session = await openSession({
		pi,
		cwd,
		scope,
		systemPrompt: "",
		tools: scope === "isolated" ? [...ISOLATED_FILE_TOOLS, ...ICAP_TOOLS] : ICAP_TOOLS,
		onBridge: async () => ({ status: "error", message: "Not available." }),
	});
	try {
		await session.bindExtensions({ uiContext: silentUi(), mode: "rpc" });
		return await read(session);
	} finally {
		session.dispose();
	}
}

/** Which model the built-in agent would use and which ones have credentials. `fresh` re-reads Pi's credentials first. */
export async function probeModels(pi: PiSdk, cwd: string, scope: ToolScope, fresh = false): Promise<ModelList> {
	if (fresh) await modelRuntime(pi, true);
	return probe(pi, cwd, scope, async (s) => {
		const available = (await s.modelRuntime.getAvailable()).map((m) => `${m.provider}/${m.id}`);
		const m = s.model;
		return { current: m ? `${m.provider}/${m.id}` : null, available };
	});
}

/** The slash commands the full scope offers: the harness's own (`/mcp`), prompt templates, skills. */
export function probeCommands(pi: PiSdk, cwd: string): Promise<AgentCommand[]> {
	return probe(pi, cwd, "full", (s) => {
		const out: AgentCommand[] = [];
		for (const c of s.extensionRunner.getRegisteredCommands()) out.push({ name: c.invocationName, description: c.description, source: "extension" });
		for (const t of s.promptTemplates) out.push({ name: t.name, description: t.description, source: "prompt" });
		for (const k of s.resourceLoader.getSkills().skills) out.push({ name: `skill:${k.name}`, description: k.description, source: "skill" });
		return out;
	});
}
