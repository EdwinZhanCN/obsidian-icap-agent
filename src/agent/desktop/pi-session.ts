import type { AgentSession, AgentSessionEvent, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { dirname, resolve } from "path";
import type { AgentCommand, AgentConfig, AgentEvents, AgentResult, Control, DialogAnswer, DialogRequest, ModelList } from "../backend";
import { ICAP_TOOLS } from "../tools/icap-tools";
import { messageUsage } from "../usage";
import { icapExtension, inside } from "./icap-extension";
import { findModel, modelRuntime, projectTrusted, type PiSdk } from "./pi-host";

/** A run as PiSession needs it: the backend's request resolved to paths on disk, and its events. */
export interface RunOptions extends AgentEvents {
	pi: PiSdk;
	cwd: string;
	config: AgentConfig;
	systemPrompt: string;
	prompt: string;
	/**
	 * The tools this task uses. Isolated: the exact allowlist. Mine: only decides which ICAP tools
	 * are hidden; the learner's own tools are left alone.
	 */
	tools: string[];
	/** Isolated mode: file tools may only reach these folders (the vault + what the learner allowed). */
	allowedRoots?: string[];
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
}

/** What the session factory is told for each agent setup. Pure. */
export interface SessionPlan {
	/** Skip what is discovered on disk: the learner's extensions, skills, prompt templates, themes. */
	bare: boolean;
	/** Which AGENTS.md / CLAUDE.md apply: the vault's only, or also Pi's global one (see vaultContextFiles). */
	contextFiles: "vault" | "vault+pi";
	/** Load Pi's built-in MCP and tool-search extensions (the CLI always does). */
	builtins: boolean;
	systemPrompt?: string;
	appendSystemPrompt?: string[];
	tools?: string[];
	excludeTools?: string[];
}

export function sessionPlan(o: Pick<RunOptions, "config" | "systemPrompt" | "tools">): SessionPlan {
	if (o.config === "isolated") return { bare: true, contextFiles: "vault", builtins: false, systemPrompt: o.systemPrompt, tools: [...o.tools] };
	const hidden = ICAP_TOOLS.filter((t) => !o.tools.includes(t));
	return { bare: false, contextFiles: "vault+pi", builtins: true, appendSystemPrompt: [o.systemPrompt], ...(hidden.length ? { excludeTools: hidden } : {}) };
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

/** A one-line gist of a tool call's arguments: the path, command or query it is about. */
export function stepDetail(args: unknown): string {
	if (!args || typeof args !== "object") return "";
	const a = args as Record<string, unknown>;
	for (const k of ["path", "file_path", "command", "pattern", "query", "title", "op", "url", "question"]) {
		const v = a[k];
		if (typeof v === "string" && v.trim()) return clip(v);
	}
	const first = Object.values(a).find((v) => typeof v === "string" && v.trim());
	return typeof first === "string" ? clip(first) : "";
}

function clip(s: string) {
	const t = s.replace(/\s+/g, " ").trim();
	return t.length > 90 ? t.slice(0, 88) + "…" : t;
}

/** After an extension command was handled, how long to wait for a turn it may have started. */
const HANDLED_GRACE_MS = 350;

/** Build a Pi session for a task (or a probe): the learner's Pi configuration, shaped by the plan. */
async function openSession(
	o: Pick<RunOptions, "pi" | "cwd" | "config" | "systemPrompt" | "tools" | "allowedRoots" | "skillPaths" | "model" | "thinking" | "session" | "onBridge">,
): Promise<AgentSession> {
	const { pi, cwd } = o;
	const plan = sessionPlan(o);
	const agentDir = pi.getAgentDir();
	const settingsManager = pi.SettingsManager.create(cwd, agentDir, { projectTrusted: projectTrusted(pi, cwd, o.config) });
	const factories = [
		icapExtension(pi, o.onBridge, o.config === "isolated" ? o.allowedRoots : undefined),
		...(plan.builtins ? [pi.createToolSearchExtension(), pi.createMcpExtension()] : []),
	];
	const resourceLoader = new pi.DefaultResourceLoader({
		cwd,
		agentDir,
		settingsManager,
		extensionFactories: factories,
		noExtensions: plan.bare,
		noSkills: plan.bare,
		noPromptTemplates: plan.bare,
		noThemes: plan.bare,
		// Pi loads ICAP's own skills even with noSkills.
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
 * One Pi session per task, in-process. Tasks are independent learning acts; a request block's
 * follow-ups may resume the same Pi *session* (a file).
 */
export class PiSession {
	private session: AgentSession | null = null;
	private finalText = "";
	private currentText = "";
	private lastError: string | null = null;
	private cancelled = false;
	private handled = false;
	/** ctx.ui.notify from an extension: the only output of many extension commands. */
	private notices: string[] = [];

	constructor(private opts: RunOptions) {}

	async run(): Promise<AgentResult> {
		const o = this.opts;
		o.onPhase?.("starting");
		let session: AgentSession;
		try {
			session = await openSession(o);
		} catch (e) {
			throw new Error(`Pi could not start: ${(e as Error).message}`);
		}
		this.session = session;
		const unsubscribe = session.subscribe((ev) => this.handle(ev));
		try {
			await session.bindExtensions({
				uiContext: uiContext({ dialog: (req, timeout) => this.dialog(req, timeout), notify: (m) => this.notices.push(m) }),
				mode: "rpc",
				onError: (err) => {
					this.lastError = err.error || "An extension failed.";
				},
			});
			if (this.cancelled) return this.result();
			if (o.control) {
				await session.compact(o.control.customInstructions);
				return this.result();
			}
			let disposition: string | undefined;
			await session.prompt(o.prompt, { source: "rpc", preflightResult: (d) => (disposition = d) });
			if (disposition === "handled") {
				this.handled = true;
				// An extension command may start a turn of its own (pi.sendUserMessage) a moment later.
				await new Promise((r) => setTimeout(r, HANDLED_GRACE_MS));
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
		}
	}

	cancel() {
		if (this.cancelled) return;
		this.cancelled = true;
		void this.session?.abort();
	}

	private result(): AgentResult {
		// What an extension command said through notify is its result when no model text came.
		const text = this.finalText.trim() ? this.finalText : this.notices.join("\n\n");
		// A session the learner stopped always ends as "aborted", whatever Pi reported on the way out.
		if (this.cancelled) return { text, aborted: true, handled: this.handled };
		if (this.lastError && !text.trim()) throw new Error(this.lastError);
		return { text, aborted: false, handled: this.handled };
	}

	private handle(ev: AgentSessionEvent) {
		const o = this.opts;
		const rec = ev as unknown as Record<string, any>;
		switch (rec.type) {
			case "message_start":
				if (rec.message?.role === "assistant") this.currentText = "";
				return;
			case "message_update": {
				const e = rec.assistantMessageEvent;
				if (!e) return;
				if (e.type === "thinking_start") o.onPhase?.("thinking");
				else if (e.type === "toolcall_start") o.onPhase?.("reading");
				else if (e.type === "text_delta") {
					this.currentText += e.delta;
					o.onPhase?.("writing");
					o.onText?.(this.currentText);
				}
				return;
			}
			case "message_end": {
				const m = rec.message;
				if (m?.role !== "assistant") return;
				const used = messageUsage(m.usage);
				const model = m.provider && m.model ? `${m.provider}/${m.model}` : null;
				if (used || model) o.onUsage?.(used, model);
				const text = Array.isArray(m.content) ? m.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("") : "";
				if (m.stopReason === "error" || m.stopReason === "aborted") {
					this.lastError = m.errorMessage || (m.stopReason === "aborted" ? "Stopped." : "The model returned an error.");
				}
				if (m.stopReason === "toolUse") {
					// Narration before a tool call is not part of the result.
					if (this.currentText) o.onText?.(this.finalText);
				} else if (text.trim()) {
					this.finalText = text;
					o.onText?.(text);
				}
				this.currentText = "";
				return;
			}
			case "tool_execution_start":
				if (typeof rec.toolName === "string") o.onStep?.(rec.toolName, stepDetail(rec.args));
				o.onTool?.(true);
				o.onPhase?.(rec.toolName === "ask_learner" || rec.toolName === "propose_edit" ? "waiting" : "reading");
				return;
			case "tool_execution_end":
				o.onTool?.(false);
				o.onPhase?.("thinking");
				return;
			case "auto_retry_start":
				o.onPhase?.("retrying");
				return;
			case "auto_retry_end":
				if (rec.success === false && rec.finalError) this.lastError = rec.finalError;
				return;
		}
	}

	/** A dialog from one of the learner's own extensions (e.g. a permission gate): ask in the note. */
	private async dialog(req: DialogRequest, timeout?: number): Promise<DialogAnswer> {
		if (!this.opts.onDialog || this.cancelled) return undefined;
		const ctl = new AbortController();
		// Pi resolves a timed-out dialog itself; withdraw the question when that happens.
		const timer = typeof timeout === "number" && timeout > 0 ? setTimeout(() => ctl.abort(), timeout) : null;
		try {
			const answer = await this.opts.onDialog(req, ctl.signal);
			return ctl.signal.aborted ? undefined : answer;
		} catch {
			return undefined;
		} finally {
			if (timer) clearTimeout(timer);
		}
	}
}

/* ───────────── Probes: nothing is sent to a model ───────────── */

/** Open a session the way tasks do, read from it, and close it. */
async function probe<T>(pi: PiSdk, cwd: string, config: AgentConfig, read: (s: AgentSession) => T | Promise<T>): Promise<T> {
	const session = await openSession({
		pi,
		cwd,
		config,
		systemPrompt: "",
		tools: config === "isolated" ? ["read", ...ICAP_TOOLS] : ICAP_TOOLS,
		onBridge: async () => ({ status: "error", message: "Not available." }),
	});
	try {
		await session.bindExtensions({ uiContext: silentUi(), mode: "rpc" });
		return await read(session);
	} finally {
		session.dispose();
	}
}

/**
 * Which model Pi would use and which ones have credentials. Runs the way tasks run (the learner's own
 * extensions may register providers). `fresh` re-reads Pi's credentials first.
 */
export async function probeModels(pi: PiSdk, cwd: string, config: AgentConfig, fresh = false): Promise<ModelList> {
	if (fresh) await modelRuntime(pi, true);
	return probe(pi, cwd, config, async (s) => {
		const available = (await s.modelRuntime.getAvailable()).map((m) => `${m.provider}/${m.id}`);
		const m = s.model;
		return { current: m ? `${m.provider}/${m.id}` : null, available };
	});
}

/** The slash commands the learner's own Pi offers: extension commands, prompt templates, skills. */
export function probeCommands(pi: PiSdk, cwd: string): Promise<AgentCommand[]> {
	return probe(pi, cwd, "mine", (s) => {
		const out: AgentCommand[] = [];
		for (const c of s.extensionRunner.getRegisteredCommands()) out.push({ name: c.invocationName, description: c.description, source: "extension" });
		for (const t of s.promptTemplates) out.push({ name: t.name, description: t.description, source: "prompt" });
		for (const k of s.resourceLoader.getSkills().skills) out.push({ name: `skill:${k.name}`, description: k.description, source: "skill" });
		return out;
	});
}
