/**
 * The boundary between the learning runtime and the agent that runs its tasks. `LearningRuntime`
 * talks to an agent only through `AgentBackend`; what is below it (Pi on Node on desktop,
 * agent/desktop/) is the backend's own. Types only: no platform imports here.
 *
 * A backend states what it can do in `capabilities`. A feature it lacks is not faked: the runtime
 * leaves it out (no resumed sessions, no `/compact`, no learner's own setup, no probes…).
 */

/** Phases the document is allowed to know about. Never tool names, never thoughts. */
/**
 * "retrying": the provider returned an error (a 500, an overload) and the agent is trying again after a pause.
 * "awaiting": the reply arrives whole, not streamed (a "whole" transport, agent/mobile/transport.ts): nothing
 * shows until it is complete, and stopping cannot cancel the request, only discard its result.
 */
export type AgentPhase = "starting" | "thinking" | "reading" | "writing" | "waiting" | "retrying" | "awaiting";

/**
 * How a task's agent is set up.
 * - "mine": the learner's own agent setup — their skills, extensions, MCP, context files and built-in
 *   tools — plus ICAP's tools; the ICAP protocol is appended to their system prompt.
 * - "isolated": only ICAP's tools and read-only built-in tools, and the ICAP protocol as the whole
 *   system prompt. The vault's own AGENTS.md still applies: it belongs to the vault.
 */
export type AgentConfig = "mine" | "isolated";

/** A dialog requested by one of the learner's own extensions. */
export interface DialogRequest {
	method: "select" | "confirm" | "input" | "editor";
	title: string;
	message?: string;
	options?: string[];
	placeholder?: string;
	prefill?: string;
}

/** What the learner answered; `undefined` = dismissed. */
export type DialogAnswer = { value: string } | { confirmed: boolean } | undefined;

/** A runtime control instead of a prompt (ICAP's `/compact`). */
export type Control = { type: "compact"; customInstructions?: string };

export type Json = Record<string, unknown>;

/** ICAP's tools ask the plugin through this (agent/tools/icap-tools.ts); it answers with JSON. */
export type BridgeHandler = (op: string, payload: Json) => Promise<Json>;

/** A request block's cached session, as the block remembers it (see `SessionCache`). */
export interface BlockSession {
	/** Session id: `icap-<blockId>-<n>` (`icpa-…` for sessions from before the plugin was renamed). */
	id: string;
	/** Fingerprint of what the session covers: agent setup + the block's transcript up to its last reply. */
	sig: string;
}

export interface BackendCapabilities {
	/** "mine" can run: the learner's own setup. Without it every task runs "isolated". */
	ownSetup: boolean;
	/** Request blocks' sessions can be kept and resumed (`sessions`). Without it a follow-up replays the block. */
	sessionCache: boolean;
	/** `/compact` of a cached session (needs `sessionCache`). */
	compact: boolean;
	/** The settings can log in to a provider with an account (OAuth), not only an API key (`accounts`). */
	oauthLogin: boolean;
	/** The settings can add a custom model endpoint (`accounts.endpoints`). */
	customEndpoints: boolean;
	/** The learner's extensions may open dialogs; they are asked as turns in the task's block (`onDialog`). */
	extensionDialogs: boolean;
	/** Which models have credentials, and the default one (`probeModels`). */
	modelProbe: boolean;
	/** The learner's own slash commands: extension commands, prompt templates, skills (`probeCommands`). */
	commandProbe: boolean;
	/** Documents in folders outside the vault can be read (`files`). */
	externalFiles: boolean;
	/** The agent has Pi's file tools (read, grep, find, ls) besides ICAP's. */
	fileTools: boolean;
	/** ICAP's skills are files the agent reads on demand; without, their text is part of the system prompt. */
	skillFiles: boolean;
}

/**
 * The agent cannot run until the learner sets something up (no API key for any provider, a model
 * without a key). The runtime shows the message with a way into the settings.
 */
export class SetupNeeded extends Error {}

/** One agent run: a task's turn, or a control. */
export interface AgentRequest {
	config: AgentConfig;
	systemPrompt: string;
	prompt: string;
	/**
	 * The tools this task uses. Isolated: the exact allowlist. Mine: only decides which ICAP tools are
	 * hidden; the learner's own tools are left alone.
	 */
	tools: string[];
	/** Offer ICAP's own skills (the visual skill). */
	icapSkills: boolean;
	/** provider/id; empty = the backend's default. */
	model?: string;
	thinking?: string;
	/** Resume or create this cached session (an id from `sessions.id`). Only with `sessionCache`. */
	session?: string;
	/** Run this control instead of the prompt; the run ends when it is done. Only with `compact`. */
	control?: Control;
}

/** What a run tells the runtime while it goes. */
export interface AgentEvents {
	/** Full text of the assistant message currently streaming (narration before tool calls is dropped). */
	onText?: (text: string) => void;
	onPhase?: (phase: AgentPhase) => void;
	/** A tool call started (true) or finished (false); file changes in between are the agent's. */
	onTool?: (running: boolean) => void;
	/** A tool call started: its name and a one-line gist of its arguments (for the activity's steps). */
	onStep?: (tool: string, detail: string) => void;
	/** ICAP's tools. */
	onBridge: BridgeHandler;
	/** A dialog from one of the learner's extensions; absent = dismiss it. Aborted on timeout. */
	onDialog?: (req: DialogRequest, signal: AbortSignal) => Promise<DialogAnswer>;
}

export interface AgentResult {
	text: string;
	/** The learner stopped it. */
	aborted: boolean;
	/** The prompt was a command the agent ran itself (an extension command); no turn may have run. */
	handled?: boolean;
	/**
	 * The connection was lost mid-run (the app went to the background, the network dropped). The task
	 * is interrupted, not failed: the learner continues it (runtime.resume). `text` is what came so far.
	 */
	interrupted?: string;
}

export interface AgentRun {
	result: Promise<AgentResult>;
	/** Stop the run; `result` then resolves with `aborted`. */
	cancel(): void;
}

export interface ModelList {
	/** provider/id used by default; null = no model has credentials. */
	current: string | null;
	/** Models with credentials, as provider/id. */
	available: string[];
}

export interface AgentCommand {
	name: string;
	description?: string;
	source: "extension" | "prompt" | "skill";
}

/**
 * A request block's session kept as a cache, never as the source of truth (runtime/transcript.ts
 * fingerprints it). The runtime decides when a session is resumed; the backend keeps the files.
 */
export interface SessionCache {
	/** The cache can be used now (its folder exists or was made). */
	ready(): boolean;
	/** What a session is made under; a session made under another setup is not resumed. */
	setup(config: AgentConfig): string;
	/** The id of a block's n-th session. */
	id(blockId: string, n: number): string;
	exists(id: string): boolean;
	/** Remove a block's sessions (all generations), or every session whose block is not in `keep`. */
	remove(match: { block: string } | { keep: Set<string> }): void;
}

/**
 * Files outside the vault, which `vault.adapter` cannot reach: the folders the learner allowed, and
 * absolute paths the agent names. Only with `externalFiles`.
 */
export interface ExternalFiles {
	/** Is `p` an absolute path on this device? */
	isAbsolute(p: string): boolean;
	/** `p` (absolute), normalized; null when `restrict` and it is outside the vault and the allowed folders. */
	resolve(p: string, restrict: boolean): string | null;
	/** The folders outside the vault the learner allowed, absolute. */
	roots(): string[];
	stat(abs: string): Promise<{ size: number; mtime: number } | null>;
	read(abs: string): Promise<Uint8Array>;
	/** The file as UTF-8 text, or null when it cannot be read. */
	readText(abs: string): Promise<string | null>;
	/** A folder's entries; empty when it cannot be read. */
	list(dir: string): Promise<{ path: string; name: string; folder: boolean }[]>;
}

/** Provider credentials, from the settings. */
export interface BackendAccounts {
	/** Names of the providers that have credentials. */
	ready(): Promise<string[]>;
	/** Open the login dialog; `done` runs after a change. Rejects when the backend cannot load. */
	login?(done: () => void): Promise<void>;
	/** Open the custom endpoint dialog (`customEndpoints`). */
	endpoints?(done: () => void): Promise<void>;
	/** Keys and endpoints edited right in the settings tab (instead of dialogs); `done` runs after a change. */
	render?(el: HTMLElement, done: () => void): void;
}

export interface AgentBackend {
	/** Which settings it reads (desktop: Pi's model; mobile: its own, settings.mobileModel). */
	readonly platform: "desktop" | "mobile";
	readonly capabilities: BackendCapabilities;
	/** Start a run. The backend may load lazily; a failure to load rejects `result`. */
	run(req: AgentRequest, events: AgentEvents): AgentRun;
	/** Name and version, e.g. "Pi 1.5.0" (loads the backend). */
	describe(): Promise<string>;
	/** `modelProbe`: models with credentials; `fresh` re-reads credentials first. Nothing is sent to a model. */
	probeModels?(config: AgentConfig, fresh?: boolean): Promise<ModelList>;
	/** `commandProbe`: the learner's own slash commands ("mine" only). */
	probeCommands?(): Promise<AgentCommand[]>;
	/** `sessionCache`. */
	readonly sessions?: SessionCache;
	/** `externalFiles`. */
	readonly files?: ExternalFiles;
	/** Credentials and endpoints, from the settings. */
	readonly accounts?: BackendAccounts;
}
