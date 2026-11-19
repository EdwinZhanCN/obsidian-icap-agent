/**
 * The boundary between the learning runtime and the agent that runs its tasks. `LearningRuntime`
 * talks to an agent only through `AgentBackend`; what is below it (on desktop Pi, built in or the
 * learner's own install, agent/desktop/) is the backend's own. Types only: no platform imports here.
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
import type { ToolScope } from "./permissions";
import type { RunUsage } from "./usage";

/**
 * Where a run is. "starting": the session and the learner's extensions load. "sending": a turn's request is out, no
 * reply yet. "replying": the reply has begun, nothing of it shown yet. A run stuck in one of these says where it stuck.
 */
export type AgentPhase = "starting" | "sending" | "replying" | "thinking" | "reading" | "writing" | "waiting" | "retrying" | "awaiting";

export type { ConfirmMode, ToolScope } from "./permissions";

/** A dialog the agent asks through the note: one of the learner's own extensions (their Pi), a connector's sign-in, or a permission. */
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
	/**
	 * The full tool scope can run: the shell, the learner's connectors, files outside the vault (with the
	 * learner's own installed Pi: their whole setup). Without it every task runs "isolated".
	 */
	fullScope: boolean;
	/**
	 * The isolated scope can run: ICAP's tools and files in the vault only. Without it every task runs
	 * "full": the agent is the learner's own install, whose tools the plugin cannot take away.
	 */
	isolatedScope: boolean;
	/**
	 * The agent asks the plugin before it writes a file, runs a shell command or calls a connector
	 * (bridge operations `write_file` and `permit`), so the confirmation modes apply (agent/permissions.ts).
	 * Without it the agent acts on its own: the learner's own Pi, whose changes are recorded, not reviewed.
	 */
	confirms: boolean;
	/** Request blocks' sessions can be kept and resumed (`sessions`). Without it a follow-up replays the block. */
	sessionCache: boolean;
	/** `/compact` of a cached session (needs `sessionCache`). */
	compact: boolean;
	/** The settings can log in to a provider with an account (OAuth), not only an API key (`accounts`). */
	oauthLogin: boolean;
	/** The settings can add a custom model endpoint (`accounts.endpoints`). */
	customEndpoints: boolean;
	/** The agent may open dialogs (a connector's sign-in, an extension of the learner's own Pi); they are asked as turns in the task's block (`onDialog`). */
	extensionDialogs: boolean;
	/** Which models have credentials, and the default one (`probeModels`). */
	modelProbe: boolean;
	/** The learner's own slash commands: extension commands, prompt templates, skills (`probeCommands`). */
	commandProbe: boolean;
	/** Documents in folders outside the vault can be read (`files`). */
	externalFiles: boolean;
	/** The agent has Pi's file tools (read, edit, write) besides ICAP's. */
	fileTools: boolean;
	/** ICAP's skills are files the agent reads on demand; without, their text is part of the system prompt. */
	skillFiles: boolean;
	/** A message can reach the agent while it works, between its tool calls (`AgentRun.steer`). */
	steer: boolean;
}

/** An image sent with a prompt: base64, and its type (`image/png`, `image/jpeg`, `image/gif`, `image/webp`). */
export interface AgentImage {
	data: string;
	mimeType: string;
}

/**
 * The agent cannot run until the learner sets something up (no API key for any provider, a model
 * without a key). The runtime shows the message with a way into the settings.
 */
export class SetupNeeded extends Error {}

/** One agent run: a task's turn, or a control. */
export interface AgentRequest {
	scope: ToolScope;
	systemPrompt: string;
	prompt: string;
	/**
	 * The tools this task uses. Isolated: the exact allowlist. Full: only decides which ICAP tools are
	 * hidden; the shell, the connectors and the learner's own tools are left alone.
	 */
	tools: string[];
	/** ICAP's own skills to offer, by name (agent/skills.ts, agent/visual-skill.ts); where there are no skill files, their text is in the system prompt instead. */
	icapSkills: string[];
	/** provider/id; empty = the backend's default. */
	model?: string;
	thinking?: string;
	/** Resume or create this cached session (an id from `sessions.id`). Only with `sessionCache`. */
	session?: string;
	/** Run this control instead of the prompt; the run ends when it is done. Only with `compact`. */
	control?: Control;
	/** Images that go with the prompt. A model that does not read images gets none (`onImagesDropped`). */
	images?: AgentImage[];
}

/**
 * What a tool call returned, for the activity's steps: its call id, whether it failed, and the start of its
 * text on one line (a failure's message whole, with its lines: `stepResult`).
 */
export interface StepResult {
	id?: string;
	error: boolean;
	preview: string;
}

/** What a run tells the runtime while it goes. */
export interface AgentEvents {
	/** Full text of the assistant message currently streaming (narration before tool calls is dropped). */
	onText?: (text: string) => void;
	onPhase?: (phase: AgentPhase) => void;
	/** A tool call started (true) or finished (false, with what it returned); file changes in between are the agent's. */
	onTool?: (running: boolean, result?: StepResult) => void;
	/** A tool call started: its name, a one-line gist of its arguments and its call id (for the activity's steps). */
	onStep?: (tool: string, detail: string, id?: string) => void;
	/**
	 * An assistant message ended: the tokens and price it reports (agent/usage.ts), summed by the runtime, and
	 * the model that wrote it as `provider/id` (what the task records in `icap-model`).
	 */
	onUsage?: (usage: RunUsage | null, model: string | null) => void;
	/**
	 * How much of the model's context the conversation fills after the latest reply: tokens, and the
	 * model's window. Not called when the window is unknown (a custom endpoint without one).
	 */
	onContext?: (used: number, window: number) => void;
	/** The prompt's images were left out: the model does not read images. */
	onImagesDropped?: () => void;
	/** A message given with `AgentRun.steer` reached the agent: from here on its words answer that message too. */
	onSteered?: (text: string) => void;
	/** ICAP's tools. */
	onBridge: BridgeHandler;
	/**
	 * One of the learner's extensions threw (loading, or in one of its handlers): `extension: message`. The run goes on;
	 * the task shows it, because a broken extension can leave the run waiting with no other sign.
	 */
	onExtensionError?: (message: string) => void;
	/** A dialog from the agent (see `DialogRequest`); absent = dismiss it. Aborted on timeout. */
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
	/**
	 * Give the agent a message while it works (`steer`): it reads it after the tool calls of its current
	 * turn, before it asks the model again. False when the run cannot take it (not started, or over);
	 * `onSteered` says when it arrived. A run that ends first never delivers it.
	 */
	steer?(text: string, images?: AgentImage[]): boolean;
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
	/** What a session is made under; a session made under another scope is not resumed. */
	setup(scope: ToolScope): string;
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
	/** Keys and endpoints edited right in the settings tab (instead of dialogs), appended to `el`; `done` runs after a change. */
	render?(el: HTMLElement, done: () => void): void;
}

/** One of the learner's connectors: an MCP server in Pi's global `mcp.json`. */
export interface Connector {
	name: string;
	kind: "stdio" | "http";
	/** The command line, or the URL. */
	target: string;
	enabled: boolean;
}

/** What a new connector is: a program to start, or a URL. */
export type ConnectorSpec = { command: string; args: string[] } | { url: string };

/**
 * The learner's connectors, read and written in Pi's global `mcp.json` (shared with their own Pi).
 * Changes apply to the next task. Desktop only: a phone cannot start a program or hold a connector.
 */
export interface BackendConnectors {
	/** The servers, the file they are in, and what in it could not be read. */
	list(): Promise<{ servers: Connector[]; file: string; errors: string[] }>;
	setEnabled(name: string, enabled: boolean): Promise<void>;
	/** Rejects when the name is taken or the entry is invalid, saying why. */
	add(name: string, spec: ConnectorSpec): Promise<void>;
	remove(name: string): Promise<void>;
	/** Show the file in the system's file manager. */
	reveal(): Promise<void>;
}

/**
 * An agent that is a program the learner installs themselves (desktop: their own Pi). The plugin looks
 * for it and says how to get it; it never installs or updates it.
 */
export interface OwnInstall {
	/** Where it is on this computer. Rejects with `SetupNeeded` (not found, too old), saying what to do. */
	locate(fresh?: boolean): Promise<string>;
	/** The official install command for this computer, to read and copy. Never run by the plugin. */
	installCommand: string;
}

export interface AgentBackend {
	/** Which settings it reads (desktop: Pi's model; mobile: its own, settings.mobileModel). */
	readonly platform: "desktop" | "mobile";
	readonly capabilities: BackendCapabilities;
	/** Start a run. The backend may load lazily; a failure to load rejects `result`. */
	run(req: AgentRequest, events: AgentEvents): AgentRun;
	/** Name and version, e.g. "Pi 1.5.0" (loads the backend). `fresh` looks for the agent again (the settings' ↻). */
	describe(fresh?: boolean): Promise<string>;
	/** `modelProbe`: models with credentials; `fresh` re-reads credentials first. Nothing is sent to a model. */
	probeModels?(scope: ToolScope, fresh?: boolean): Promise<ModelList>;
	/** `commandProbe`: the learner's own slash commands (full scope only). */
	probeCommands?(): Promise<AgentCommand[]>;
	/** `sessionCache`. */
	readonly sessions?: SessionCache;
	/** `externalFiles`. */
	readonly files?: ExternalFiles;
	/** Credentials and endpoints, from the settings. */
	readonly accounts?: BackendAccounts;
	/** Present while the agent in use is the learner's own install. */
	readonly ownInstall?: OwnInstall;
	/** The learner's connectors (MCP servers). */
	readonly connectors?: BackendConnectors;
	/** Is the learner's own install on this computer and able to run (whichever agent is in use now)? */
	hasOwnInstall?(): Promise<boolean>;
	/** The plugin unloads: stop what runs and give back what was taken (processes, sockets, temporary files). */
	dispose?(): void;
}
