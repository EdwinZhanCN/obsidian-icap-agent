import { MarkdownView, Notice, TFile, TFolder, arrayBufferToBase64, parseYaml, type App, type Editor, type TAbstractFile } from "obsidian";
import { EditorView } from "@codemirror/view";
import { mount, unmount } from "svelte";
import { SvelteMap } from "svelte/reactivity";
import type IcapPlugin from "../main";
import { SetupNeeded, type AgentBackend, type AgentImage, type AgentPhase, type ConfirmMode, type Control, type DialogAnswer, type DialogRequest, type SessionCache, type ToolScope } from "../agent/backend";
import { actionDecision, writeDecision, type WriteTarget } from "../agent/permissions";
import { Backups } from "./backups";
import { hunk, locate, type Hunk } from "./file-change";
import { extractLinks, imageEmbeds, imageType } from "../dsl/links";
import { LIVE_RECORD, appendRounds, dropLastRound, findLiveRecord, isSessionName, roundsTranscript, sessionName, sessionNote, sessionTitle } from "../dsl/session";
import type { RequestRound } from "../dsl/records";
import { THINKING_LEVELS, isIcapCommand, parseCommand, type CommandProvider, type IcapCommandName, type SlashCommand } from "../dsl/commands";
import { L } from "../i18n";
import { GENERATED_BY } from "../settings/settings";
import { glossLabelUI } from "../ui/phrases";
import { vaultCommand } from "../agent/tools/vault-tools";
import { DocStore, LEGACY_DIR, formatOf, type Loaded } from "../documents/store";
import { documentsCommand, readDocument } from "../documents/tools";
import { applySummaries, documentPrompt, parseSummaries, summaryBatches } from "../documents/summaries";
import {
	blockContext,
	commandContext,
	continuationPrompt,
	explainPrompt,
	followUpPrompt,
	notePrompt,
	offeredSkills,
	type Placement,
	quizPrompt,
	recallPrompt,
	requestPrompt,
	steerPrompt,
	systemPrompt,
	type GlossMode,
	type NoteTaskKind,
} from "../agent/prompts";
import { addUsage } from "../agent/usage";
import { buildContext } from "./context";
import { TaskNotes, announceMigration, basesEnabled } from "./task-notes";
import { keptMarkdown, roundsOf } from "./kept";
import { coveredTranscript, reusable, sessionSig, transcriptOf, withReply } from "./transcript";
import { editProblem, findAskBlock, findRequestRecord, isoDate, parseAskSource, parseAuthored, type AskSource, glossCallout, newId, serializeAsk, splitSources, tidyOptionLabel, tidyQuestion, dialogTitle, clipText, connectorLabel, type Depth } from "../dsl/blocks";
import { askReplacement, blockInsertion, editorFor, spliceFile, uniqueNotePath, type Splice } from "../dsl/doc-ops";
import { NOTE_EXT, baseProblem, canvasProblem, noteTypeOf, type NoteType } from "../dsl/structures";
import { flashRange } from "../editor/fresh";
import { clearCues, cue, withdrawCue } from "../editor/cue";
import { glossAnchor, paragraphBounds, sectionBounds, stripFrontmatter, shortTitle } from "../dsl/text";
import { addGloss, anchorsIn, glossField, removeGloss, type GlossAnchor, type GlossFieldType, type GlossHost } from "../editor/gloss-field";
import GlossView from "../ui/GlossView.svelte";
import { acknowledge } from "../ui/motion";
import {
	AskBlock,
	Gloss,
	Ledger,
	Task,
	type Answer,
	type Artifact,
	type BlockRecord,
	type TaskKind,
	type TaskRecord,
	type Turn,
} from "./state.svelte";

// `read` is the harness's own file tool; searching the vault is ICAP's `obsidian` tool.
const READ_TOOLS = ["read", "obsidian", "read_document", "documents"];
const ASK_TOOLS = [...READ_TOOLS, "ask_learner"];
// Tasks that may change notes also get the harness's edit and write: what they write goes through the learner (writeFile below).
const NOTE_TOOLS = [...READ_TOOLS, "ask_learner", "create_note", "propose_edit", "edit", "write"];
const REQUEST_TOOLS = NOTE_TOOLS;
/** A file change this soon after one of a task's tool calls ended is still that call's (watchers lag). */
const TOOL_GRACE_MS = 3000;
/** Artifacts that describe files the agent touched, kept whatever the task's own result is. */
const FILE_KINDS = new Set<Artifact["kind"]>(["created", "edited", "deleted"]);

/** The connection to the model failed mid-run (mobile: the app went to the background): resumable. */
class Interrupted extends Error {}

class Cancelled extends Error {
	constructor() {
		super(L("Stopped", "已停止"));
	}
}

type Json = Record<string, unknown>;

/** How a request block's agent runs, beyond the task's prompt and tools. */
interface RunExtras {
	/** Added to the system prompt for this run (e.g. where a slash command was typed). */
	systemExtra?: string;
	/** This block's own model / thinking; empty = the plugin settings. */
	model?: string;
	thinking?: string;
	/** A cached session to resume or create (SessionCache.id). */
	session?: string;
	/** A runtime control (compact) instead of a prompt. */
	control?: Control;
	/** Images that go with the prompt. */
	images?: AgentImage[];
	/** The model does not read images: they were left out. */
	onImagesDropped?: () => void;
	/** A message handed over while the agent worked (Task.steer) reached it. */
	onSteered?: (sent: string) => void;
}

/** Images sent with one request: at most this many, each at most this large. */
const MAX_IMAGES = 8;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** The command catalog is asked of the agent at most this often (new skills show up without a restart). */
const CATALOG_TTL_MS = 5 * 60 * 1000;

export interface PersistedRuntime {
	tasks: TaskRecord[];
	blocks: BlockRecord[];
}

export class LearningRuntime {
	ledger = new Ledger();
	glosses = new Map<string, Gloss>();
	/** Reactive, so a block view follows when an authored block is reset in place. */
	blocks = new SvelteMap<string, AskBlock>();
	field: GlossFieldType;
	private running = 0;
	private waitingForSlot: (() => void)[] = [];
	private saveTimer: number | null = null;
	/** Blocks that should take focus the first time they render. */
	focusOnMount = new Set<string>();
	/** The document cache (the plugin's own docs/) behind read_document and documents. */
	docs: DocStore;
	/** Documents whose summaries are being written (by content hash). */
	private summarizing = new Set<string>();
	/** Request and note tasks as notes with `icap-*` properties (FORMAT.md v4); Activity.base lists them. */
	taskNotes: TaskNotes;
	private prepQueue: string[] = [];
	private preparing = false;

	constructor(private plugin: IcapPlugin) {
		const host: GlossHost = {
			restore: (path, doc) => this.restoreGlosses(path, doc),
			track: (a) => {
				const g = this.glosses.get(a.id);
				if (g) {
					g.anchor = a.anchor;
					g.termFrom = a.from;
					g.termTo = a.to;
				}
			},
			mount: (id, el) => {
				const gloss = this.glosses.get(id);
				if (!gloss) return () => undefined;
				const c = mount(GlossView, { target: el, props: { gloss, rt: this } });
				return () => void unmount(c);
			},
		};
		this.field = glossField(host);
		this.docs = new DocStore(plugin.app, plugin.backend.files ?? null, `${plugin.manifest.dir ?? `${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}`}/docs`);
		this.taskNotes = new TaskNotes({
			app: plugin.app,
			home: () => this.settings.homeFolder,
			tasks: () => this.ledger.tasks,
			block: (id) => (id ? this.blocks.get(id) : undefined),
			beingEdited: (path) => this.isBeingEdited(path),
			baseMade: () => this.settings.activityBaseMade,
			setBaseMade: () => {
				if (this.settings.activityBaseMade) return;
				this.settings.activityBaseMade = true;
				this.persist();
			},
			viewAdded: () => this.settings.activityViewAdded,
			setViewAdded: () => {
				if (this.settings.activityViewAdded) return;
				this.settings.activityViewAdded = true;
				this.persist();
			},
			recording: () => this.settings.taskNotes === "on",
		});
	}

	/** The agent below the runtime (agent/backend.ts). */
	get backend(): AgentBackend {
		return this.plugin.backend;
	}

	get app(): App {
		return this.plugin.app;
	}
	get settings() {
		return this.plugin.settings;
	}

	/* ───────────────────────── persistence ───────────────────────── */

	load(data: Partial<PersistedRuntime> | undefined) {
		for (const r of data?.tasks ?? []) this.ledger.tasks.push(Task.from(r));
		for (const r of data?.blocks ?? []) {
			if (r.settled !== "open") continue;
			this.blocks.set(r.id, AskBlock.from(r));
		}
		// What already existed when Obsidian started is not "arriving": no entrance replays.
		const seen: string[] = [];
		// Only what is actually on the page: feedback or a summary that arrives later still arrives.
		for (const b of this.blocks.values()) {
			seen.push(`b:${b.id}`, `bh:${b.id}`);
			if (b.summary.trim() && b.phase === "completed") seen.push(`s:${b.id}`);
			for (const t of b.turns) {
				seen.push(`q:${t.id}`);
				if (t.feedback) seen.push(`f:${t.id}`);
				if (t.answer) seen.push(`a:${t.id}`, `r:${t.id}`);
			}
		}
		for (const t of this.ledger.tasks) {
			seen.push(`done:${t.id}`);
			for (const a of t.artifacts) seen.push(`art:${t.id}:${a.kind}:${a.path}`);
		}
		acknowledge(seen);
	}

	snapshot(): PersistedRuntime {
		return {
			tasks: this.ledger.tasks.slice(0, 60).map((t) => t.toJSON()),
			blocks: Array.from(this.blocks.values())
				.filter((b) => b.settled === "open")
				.map((b) => b.toJSON()),
		};
	}

	persist() {
		// Every change of a task's state passes here: its note follows (written only if something differs).
		void this.taskNotes.sync();
		if (this.saveTimer) window.clearTimeout(this.saveTimer);
		this.saveTimer = window.setTimeout(() => {
			this.saveTimer = null;
			void this.plugin.saveState();
		}, 400);
	}

	dispose() {
		this.taskNotes.dispose();
		clearCues();
		for (const t of this.ledger.active) t.cancel?.();
	}

	/* ───────────────────────── agent execution ───────────────────────── */

	private async slot(): Promise<() => void> {
		if (this.running >= Math.max(1, this.settings.maxConcurrent)) {
			await new Promise<void>((r) => this.waitingForSlot.push(r));
		}
		this.running++;
		let released = false;
		return () => {
			if (released) return;
			released = true;
			this.running--;
			this.waitingForSlot.shift()?.();
		};
	}

	/** The tool scope tasks run with: the learner's choice, when the backend can run both. */
	toolScope(): ToolScope {
		const can = this.backend.capabilities;
		if (!can.fullScope) return "isolated";
		// The learner's own install (Pi over RPC) is their whole setup: there is nothing to isolate it to.
		if (!can.isolatedScope) return "full";
		return this.settings.toolScope;
	}

	/** When the built-in agent stops to ask (agent/permissions.ts). */
	confirmMode(): ConfirmMode {
		return this.settings.confirm;
	}

	private async runAgent(
		task: Task,
		opts: {
			prompt: string;
			tools: string[];
			onText?: (t: string) => void;
			onBridge?: (op: string, p: Json) => Promise<Json>;
			onPhase?: (p: AgentPhase) => void;
		} & RunExtras,
	): Promise<string> {
		let cancelledEarly = false;
		task.cancel = () => {
			cancelledEarly = true;
		};
		const release = await this.slot();
		try {
			if (cancelledEarly) throw new Cancelled();
			const config = this.toolScope();
			const visuals = this.settings.visuals;
			const run = this.backend.run(
				{
					scope: config,
					icapSkills: offeredSkills(visuals),
					systemPrompt: systemPrompt(config, this.settings.preferences, visuals, { fileTools: this.backend.capabilities.fileTools, skills: this.backend.capabilities.skillFiles }) + (opts.systemExtra ? `\n\n${opts.systemExtra}` : ""),
					prompt: opts.prompt,
					tools: opts.tools,
					model: opts.model || this.defaultModel(),
					thinking: opts.thinking || this.settings.thinking,
					session: opts.session,
					control: opts.control,
					...(opts.images?.length ? { images: opts.images } : {}),
				},
				{
					onText: opts.onText,
					onContext: (used, window) => {
						task.context = { used, window };
						this.persist();
					},
					onImagesDropped: opts.onImagesDropped,
					onSteered: opts.onSteered,
					onStep: (tool, detail) => {
						task.addStep(tool, detail);
						this.persist();
					},
					onUsage: (used, model) => {
						if (used) task.usage = addUsage(task.usage, used);
						if (model) task.model = model;
						this.persist();
					},
					onTool: (running) => {
						task.toolsRunning = Math.max(0, task.toolsRunning + (running ? 1 : -1));
						if (!running) {
							task.toolEndedAt = Date.now();
							task.endStep(task.toolEndedAt);
						}
					},
					onExtensionError: (message) => {
						if (!task.extensionErrors.includes(message) && task.extensionErrors.length < 5) task.extensionErrors.push(message);
					},
					onPhase: (p) => {
						task.phase = p;
						if (p === "waiting") task.status = "waiting";
						else if (task.status === "waiting") task.status = "processing";
						opts.onPhase?.(p);
					},
					onBridge: async (op, p) => {
						// The read-only vault tools work in every task; the rest depends on the task.
						if (op === "vault") return vaultCommand(this.app, p);
						if (op === "read_document" || op === "documents") return this.documentTool(op, p, config === "isolated");
						// What the harness's own tools may do: a file written, a shell command, a connector called.
						if (op === "write_file") return this.writeFile(task, p);
						if (op === "permit") return this.permit(task, p);
						return opts.onBridge ? opts.onBridge(op, p) : { status: "error", message: "Not available for this task." };
					},
					// A dialog from one of the learner's own extensions is asked in the task's block.
					...(this.backend.capabilities.extensionDialogs ? { onDialog: (req: DialogRequest, signal: AbortSignal) => this.dialog(task, req, signal) } : {}),
				},
			);
			task.cancel = () => run.cancel();
			task.steer = run.steer && this.backend.capabilities.steer ? (text, images) => run.steer!(text, images) : null;
			const result = await run.result;
			if (result.aborted) throw new Cancelled();
			if (result.interrupted) throw new Interrupted(result.interrupted);
			return result.text;
		} finally {
			task.steer = null;
			release();
		}
	}

	/** The model the settings choose on this device (each backend has its own; empty = its default). */
	defaultModel(): string {
		return this.backend.platform === "mobile" ? this.settings.mobileModel : this.settings.model;
	}

	/** Open ICAP's settings tab (a task that cannot run until something is set up). */
	openSettings() {
		const setting = (this.app as unknown as { setting?: { open(): void; openTabById(id: string): void } }).setting;
		setting?.open();
		setting?.openTabById(this.plugin.manifest.id);
	}

	private finishWithError(task: Task, err: unknown, outcomeOnFail: string): "cancelled" | "failed" | "interrupted" {
		if (err instanceof Cancelled) {
			// Keep the task's own title ("Explaining “heap”"); the ledger's status word says "stopped".
			task.end("cancelled");
			return "cancelled";
		}
		if (err instanceof Interrupted) {
			// Resumable like a task Obsidian closed on (resume()); the reason is kept for the ledger.
			task.interrupted = true;
			task.end("cancelled", undefined, L("The connection to the model was lost (the app may have gone to the background).", "与模型的连接中断了（应用可能被切到了后台）。"));
			return "interrupted";
		}
		if (err instanceof SetupNeeded) {
			// The direct way into the settings, from wherever the task was started.
			const notice = new Notice(
				createFragment((f) => {
					f.createDiv({ text: err.message });
					f.createEl("button", { text: L("Open settings", "打开设置"), cls: "mod-cta icap-notice-action" }).addEventListener("click", () => {
						notice.hide();
						this.openSettings();
					});
				}),
				0,
			);
		}
		const msg = humanError(err);
		task.end("failed", outcomeOnFail, msg);
		return "failed";
	}

	cancelTask(task: Task) {
		task.cancel?.();
	}

	/* ───────────── The `/` catalog: the agent's commands + ICAP's runtime commands ───────────── */

	private commandCache: { key: string; at: number; list: Promise<SlashCommand[]> } | null = null;
	private modelCache: { key: string; at: number; list: Promise<string[]> } | null = null;

	/** Settings changed (agent setup): ask the agent again next time. */
	invalidateCatalog() {
		this.commandCache = null;
		this.modelCache = null;
	}

	private catalogKey() {
		return this.toolScope();
	}

	private icapCommands(): SlashCommand[] {
		const commands: SlashCommand[] = [
			{ name: "model", source: "icap", description: L("Model for this block only (/model default goes back)", "仅用于这个块的模型（/model default 恢复默认）") },
			{ name: "thinking", source: "icap", description: L("Thinking level for this block only", "仅用于这个块的思考强度") },
			{ name: "compact", source: "icap", description: L("Summarize the earlier rounds for the agent; the note stays as it is", "为 Agent 压缩前面的轮次；笔记保持不变") },
		];
		// Only a backend that keeps sessions can compact one.
		return this.backend.capabilities.compact ? commands : commands.filter((c) => c.name !== "compact");
	}

	/** Every command a request block offers. The learner's own come from their Pi (cached). */
	async slashCommands(): Promise<SlashCommand[]> {
		const own = this.icapCommands();
		// The isolated scope runs without the learner's skills, prompt templates and connectors: there is nothing to ask.
		const probe = this.backend.probeCommands?.bind(this.backend);
		if (this.toolScope() === "isolated" || !probe || !this.backend.capabilities.commandProbe) return own;
		const key = this.catalogKey();
		const c = this.commandCache;
		if (!c || c.key !== key || Date.now() - c.at > CATALOG_TTL_MS) {
			const list = (async () => {
				const found = await probe();
				return found.map((x): SlashCommand => ({ name: x.name, description: x.description, source: x.source }));
			})();
			const entry = { key, at: Date.now(), list };
			this.commandCache = entry;
			// A failed probe is not remembered: the next "/" asks again.
			list.catch(() => {
				if (this.commandCache === entry) this.commandCache = null;
			});
		}
		const theirs = await this.commandCache!.list.catch(() => [] as SlashCommand[]);
		// ICAP's runtime commands take their names; one of the learner's with the same name is shadowed.
		return [...own, ...theirs.filter((x) => !isIcapCommand(x.name))];
	}

	/** Models with credentials in the learner's Pi (for /model). */
	async modelChoices(): Promise<string[]> {
		const probe = this.backend.probeModels?.bind(this.backend);
		if (!probe || !this.backend.capabilities.modelProbe) return [];
		const key = this.catalogKey();
		const c = this.modelCache;
		if (!c || c.key !== key || Date.now() - c.at > CATALOG_TTL_MS) {
			const list = (async () => {
				return (await probe(this.toolScope())).available;
			})();
			const entry = { key, at: Date.now(), list };
			this.modelCache = entry;
			list.catch(() => {
				if (this.modelCache === entry) this.modelCache = null;
			});
		}
		return this.modelCache!.list.catch(() => [] as string[]);
	}

	/** What a request block's writing line offers after "/". Learning blocks get none: see AskView. */
	commandProvider(): CommandProvider {
		const config = () => this.toolScope();
		return {
			list: () => this.slashCommands(),
			args: (name) =>
				name === "model" ? this.modelChoices().then((m) => ["default", ...m]) : name === "thinking" ? Promise.resolve(["default", ...THINKING_LEVELS]) : null,
			// Read when shown, so a change of agent setup is reflected without re-rendering the block.
			get note() {
				return config() === "isolated"
					? L("Your own Pi skills and commands are off with the isolated tools (settings → Tools).", "隔离的工具范围下不加载你自己的 Pi skills 和命令（设置 → 工具范围）。")
					: undefined;
			},
		};
	}

	/* ───────────── Request blocks' sessions (a cache of the conversation, SessionCache in agent/backend.ts) ───────────── */

	/** The backend's session cache, when it has one and it can be used now. */
	private sessionCache(): SessionCache | null {
		const cache = this.backend.sessions;
		return cache && this.backend.capabilities.sessionCache && cache.ready() ? cache : null;
	}

	/** What a session was made under; a session made under another setup is not resumed. */
	private sessionSetup(): string {
		const config = this.toolScope();
		return this.backend.sessions?.setup(config) ?? config;
	}

	private dropSessions(blockId: string) {
		this.sessionCache()?.remove({ block: blockId });
	}

	/** Remove the sessions of blocks that are no longer open (kept, cleared, or gone with their note). */
	pruneSessions() {
		this.sessionCache()?.remove({ keep: new Set(this.blocks.keys()) });
	}

	/* ───────────── Documents: preparing ahead, summaries ───────────── */

	/**
	 * Prepare every document in the vault (when the setting is on), one at a time so Obsidian stays
	 * responsive, then drop cache entries nothing points to. Summaries follow when they are on.
	 */
	/**
	 * The agent's document tools: `read_document` (structure, a node, pages) and `documents` (list,
	 * search). `restrict` (isolated mode): an absolute path only inside the vault and the folders the
	 * learner allowed; documents in those folders are listed either way.
	 */
	async documentTool(op: "read_document" | "documents", p: Record<string, unknown>, restrict = false) {
		const files = this.backend.files ?? null;
		if (op === "documents") return documentsCommand(this.app, this.docs, files, p);
		const r = await readDocument(this.app, this.docs, files, p, restrict);
		if (typeof r.path === "string") void this.summarizeLater(r.path);
		return r;
	}

	prepareDocuments() {
		if (!this.settings.prepareDocuments && !this.settings.documentSummaries) return;
		const all = this.app.vault
			.getFiles()
			.filter((f) => formatOf(f.path))
			.map((f) => f.path);
		for (const p of all) if (!this.prepQueue.includes(p)) this.prepQueue.push(p);
		void this.drainPrep(true);
	}

	/** A document was added or changed in the vault: prepare it (when the setting is on). */
	onDocumentChange(file: TAbstractFile) {
		if (!this.settings.prepareDocuments || !(file instanceof TFile) || !formatOf(file.path)) return;
		if (!this.prepQueue.includes(file.path)) this.prepQueue.push(file.path);
		void this.drainPrep(false);
	}

	private async drainPrep(prune: boolean) {
		if (this.preparing) return;
		this.preparing = true;
		try {
			while (this.prepQueue.length) {
				const path = this.prepQueue.shift()!;
				try {
					// With preparing off, only documents already read get their summaries.
					const known = this.settings.prepareDocuments ? null : await this.docs.cached(path);
					if (!this.settings.prepareDocuments && !known) continue;
					const loaded = await this.docs.load(path);
					void this.summarizeLater(path, loaded);
				} catch (e) {
					console.warn(`ICAP: could not prepare ${path}:`, e);
				}
				await new Promise((r) => window.setTimeout(r, 150));
			}
			if (prune) await this.docs.prune().catch(() => undefined);
		} finally {
			this.preparing = false;
		}
	}

	/** Write a document's summaries in the background, when they are on and it has none yet. */
	async summarizeLater(path: string, loaded?: Loaded) {
		if (!this.settings.documentSummaries) return;
		const doc = loaded ?? (await this.docs.load(path).catch(() => null));
		if (!doc || doc.tree.summary !== undefined || this.summarizing.has(doc.tree.hash) || doc.tree.toc_source === "unreadable") return;
		this.summarizing.add(doc.tree.hash);
		try {
			await this.summarizeDocument(doc);
		} finally {
			this.summarizing.delete(doc.tree.hash);
		}
	}

	private async summarizeDocument(doc: Loaded) {
		const name = basename(doc.path);
		const task = this.ledger.add(new Task(newId("t"), "read", L(`Summarizing “${name}”`, `正在为“${name}”写摘要`), doc.path));
		this.persist();
		try {
			const tree = doc.tree;
			for (const batch of summaryBatches(tree, doc.units)) {
				const reply = await this.runAgent(task, { prompt: batch.prompt, tools: [] });
				applySummaries(tree, parseSummaries(reply, batch.ids));
				// Progress survives an interruption: the next run continues with what is missing.
				await this.docs.writeTree(tree);
			}
			tree.summary = (await this.runAgent(task, { prompt: documentPrompt(tree), tools: [] })).replace(/\s+/g, " ").trim();
			tree.summarized_by = this.defaultModel() || (this.backend.platform === "mobile" ? "default" : "Pi default");
			await this.docs.writeTree(tree);
			setResult(task, { kind: "kept", path: doc.path, label: name });
			task.end("completed", L(`Summarized “${name}”`, `已为“${name}”写好摘要`));
		} catch (e) {
			this.finishWithError(task, e, L(`Could not summarize “${name}”`, `无法为“${name}”写摘要`));
			task.retry = () => void this.summarizeLater(doc.path);
		}
		this.persist();
	}

	/* ───────────────────────── helpers ───────────────────────── */

	private fileOf(path: string): TFile | null {
		const f = this.app.vault.getAbstractFileByPath(path);
		return f instanceof TFile ? f : null;
	}

	private async textOf(path: string): Promise<string> {
		const ed = editorFor(this.app, path);
		if (ed) return ed.getValue();
		const f = this.fileOf(path);
		return f ? this.app.vault.cachedRead(f) : "";
	}

	private selectionOf(editor: Editor): { from: number; to: number; text: string } {
		let from = editor.posToOffset(editor.getCursor("from"));
		let to = editor.posToOffset(editor.getCursor("to"));
		if (from === to) {
			const cm = cmOf(editor);
			const word = cm?.state.wordAt(from);
			if (word) {
				from = word.from;
				to = word.to;
			}
		}
		return { from, to, text: editor.getValue().slice(from, to) };
	}

	/* ───────────────────────── Explanation ───────────────────────── */

	explain(editor: Editor, file: TFile) {
		const cm = cmOf(editor);
		if (!cm) return new Notice(L("Explanations need the editor (Live Preview or Source mode).", "解释需要在编辑器中进行（实时预览或源码模式）。"));
		const sel = this.selectionOf(editor);
		const selection = sel.text.trim();
		if (!selection) return new Notice(L("Select a term or passage to explain.", "请选中要解释的词或段落。"));
		for (const g of this.glosses.values()) {
			if (g.notePath === file.path && g.state === "open" && g.selection.trim() === selection) {
				g.collapsed = false;
				g.focusToken++;
				return;
			}
		}
		const text = editor.getValue();
		const anchor = glossAnchor(text, sel.to);
		const gloss = new Gloss(newId("g"), file.path, selection, anchor, sel.from, sel.to);
		this.glosses.set(gloss.id, gloss);
		cm.dispatch({ effects: addGloss.of({ id: gloss.id, anchor, from: sel.from, to: sel.to }) });
		void this.runGlossSection(gloss, "explain");
	}

	explainFromView(view: EditorView) {
		const md = this.markdownViewFor(view);
		if (md?.file) this.explain(md.editor, md.file);
	}

	checkFromView(view: EditorView) {
		const md = this.markdownViewFor(view);
		if (md?.file) void this.checkWriting(md.editor, md.file);
	}

	private markdownViewFor(view: EditorView): MarkdownView | null {
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const v = leaf.view;
			if (v instanceof MarkdownView && cmOf(v.editor) === view) return v;
		}
		return null;
	}

	/** The section's heading in kept Markdown — English on purpose: the agent reads "**Plainly.**" back as evidence. */
	glossLabel(mode: GlossMode, compareWith?: string) {
		switch (mode) {
			case "deeper":
				return "Deeper";
			case "example":
				return "Example";
			case "simpler":
				return "Plainly";
			case "compare":
				return `Compared with ${compareWith}`;
			default:
				return "";
		}
	}

	async runGlossSection(gloss: Gloss, mode: GlossMode, compareWith?: string) {
		const task = this.ledger.add(
			new Task(newId("t"), "explain", mode === "explain" ? L(`Explaining “${gloss.term}”`, `正在解释“${gloss.term}”`) : `${glossLabelUI(mode, compareWith)} — “${gloss.term}”`, gloss.notePath),
		);
		task.glossId = gloss.id;
		gloss.sections.push({
			id: newId("s"),
			mode,
			label: this.glossLabel(mode, compareWith),
			text: "",
			sources: [],
			status: "streaming",
			taskId: task.id,
		});
		const section = gloss.sections[gloss.sections.length - 1];
		try {
			const file = this.fileOf(gloss.notePath);
			if (!file) throw new Error(L("The note is no longer there.", "这篇笔记已经不在了。"));
			const text = await this.textOf(gloss.notePath);
			const ctx = buildContext(this.app, file, text, gloss.termFrom, gloss.termTo, this.settings.background);
			const previous = gloss.fullText;
			const out = await this.runAgent(task, {
				prompt: explainPrompt(ctx, gloss.selection, mode, previous, compareWith),
				tools: READ_TOOLS,
				onText: (t) => (section.text = t),
			});
			const { body, sources } = splitSources(out);
			if (!body.trim()) throw new Error(L("The agent returned nothing.", "Agent 没有返回任何内容。"));
			section.text = body;
			section.sources = sources;
			section.status = "done";
			this.cueGloss(gloss, mode === "explain" ? L("explanation ready", "解释好了") : L("added to the explanation", "已补充到解释中"));
			setResult(task, { kind: "gloss", path: gloss.notePath, label: basename(gloss.notePath) });
			task.end("completed", mode === "explain" ? L(`Explained “${gloss.term}”`, `已解释“${gloss.term}”`) : `${glossLabelUI(mode, compareWith)} — “${gloss.term}”`);
		} catch (e) {
			const r = this.finishWithError(task, e, L(`Could not explain “${gloss.term}”`, `无法解释“${gloss.term}”`));
			section.status = r === "interrupted" ? "failed" : r;
			section.error = task.error ?? undefined;
			if (r === "cancelled" && !section.text.trim()) gloss.sections.splice(gloss.sections.indexOf(section), 1);
			task.retry = () => {
				const i = gloss.sections.indexOf(section);
				if (i !== -1) gloss.sections.splice(i, 1);
				void this.runGlossSection(gloss, mode, compareWith);
			};
			if (!gloss.sections.length) this.dismissGloss(gloss);
		}
		this.persist();
	}

	stopGloss(gloss: Gloss) {
		for (const s of gloss.sections) {
			if (s.status !== "streaming" || !s.taskId) continue;
			const t = this.ledger.get(s.taskId);
			if (t) this.cancelTask(t);
		}
	}

	private viewsShowing(path: string): EditorView[] {
		const out: EditorView[] = [];
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const v = leaf.view;
			if (v instanceof MarkdownView && v.file?.path === path) {
				const cm = cmOf(v.editor);
				if (cm) out.push(cm);
			}
		}
		return out;
	}

	private detachGloss(gloss: Gloss) {
		for (const cm of this.viewsShowing(gloss.notePath)) cm.dispatch({ effects: removeGloss.of(gloss.id) });
	}

	dismissGloss(gloss: Gloss) {
		withdrawCue(gloss.id);
		this.stopGloss(gloss);
		gloss.state = "dismissed";
		this.detachGloss(gloss);
		this.glosses.delete(gloss.id);
	}

	async keepGloss(gloss: Gloss) {
		if (gloss.busy || !gloss.fullText) return;
		withdrawCue(gloss.id);
		const views = this.viewsShowing(gloss.notePath);
		const live: GlossAnchor | undefined = views.length ? anchorsIn(views[0], this.field).find((a) => a.id === gloss.id) : undefined;
		const anchor = live?.anchor ?? gloss.anchor;
		const depth = [...new Set(gloss.sections.flatMap((s): Depth[] => (s.mode === "simpler" ? ["plainer"] : s.mode === "deeper" ? ["deeper"] : [])))];
		const callout = glossCallout(gloss.selection, gloss.fullText, gloss.sources, { id: gloss.id, date: isoDate(), depth });
		const ok = await this.writeAndShow(gloss.notePath, "follow", (text) => blockInsertion(text, Math.min(anchor, text.length), callout));
		if (!ok) return void new Notice(L("Could not write to the note.", "无法写入笔记。"));
		gloss.state = "kept";
		this.detachGloss(gloss);
		this.glosses.delete(gloss.id);
		const t = this.ledger.tasks.find((x) => x.glossId === gloss.id && x.status === "completed");
		if (t) {
			t.outcome = L(`Explained “${gloss.term}” · kept in note`, `已解释“${gloss.term}” · 已留在笔记里`);
			setResult(t, { kind: "kept", path: gloss.notePath, label: basename(gloss.notePath) });
		}
		this.persist();
	}

	private restoreGlosses(path: string, doc: string): GlossAnchor[] {
		const out: GlossAnchor[] = [];
		for (const g of this.glosses.values()) {
			if (g.notePath !== path || g.state !== "open") continue;
			let at = doc.slice(g.termFrom, g.termTo) === g.selection ? g.termFrom : -1;
			if (at === -1) {
				const near = doc.indexOf(g.selection, Math.max(0, g.termFrom - 2000));
				at = near !== -1 ? near : doc.indexOf(g.selection);
			}
			if (at === -1) continue;
			const to = at + g.selection.length;
			out.push({ id: g.id, from: at, to, anchor: glossAnchor(doc, to) });
		}
		return out;
	}

	/* ───────────────────────── Interactive Blocks ───────────────────────── */

	private async insertBlock(editor: Editor | null, path: string, offset: number, block: AskBlock, body: string) {
		this.blocks.set(block.id, block);
		this.focusOnMount.add(block.id);
		const src = serializeAsk({ id: block.id, kind: block.kind, body });
		let ok: boolean;
		if (editor) {
			const text = editor.getValue();
			const s = blockInsertion(text, Math.min(offset, text.length), src);
			// Not editor.replaceRange (nor editor.transaction): Obsidian's scroll the cursor into view, so a
			// block inserted away from the cursor — under a visual whose button was clicked — would jerk the
			// note to wherever the cursor was. The block brings itself into view when it mounts (AskView).
			const cm = cmOf(editor);
			if (cm) cm.dispatch({ changes: { from: s.from, to: s.to, insert: s.insert } });
			else editor.replaceRange(s.insert, editor.offsetToPos(s.from), editor.offsetToPos(s.to));
			ok = true;
		} else {
			ok = await spliceFile(this.app, path, (text) => blockInsertion(text, Math.min(offset, text.length), src));
		}
		if (!ok) {
			this.blocks.delete(block.id);
			throw new Error(L("Could not write the interaction into the note.", "无法把这段交互写入笔记。"));
		}
		this.persist();
	}

	async recall(editor: Editor, file: TFile) {
		const text = editor.getValue();
		const sel = editor.posToOffset(editor.getCursor("from"));
		const selected = editor.getSelection().trim();
		const sec = sectionBounds(text, sel);
		const topic = selected.length >= 3 && selected.length <= 80 ? selected : sec.title ?? file.basename;
		const block = new AskBlock(newId("q"), "recall", topic, file.path);
		block.turns = [
			{
				id: newId("u"),
				kind: "text",
				question: L(`Explain **${escapeMd(topic)}** in your own words — without looking back.`, `不往回看，用你自己的话解释 **${escapeMd(topic)}**。`),
				placeholder: L("What it is, why it exists, how it works…", "它是什么、为什么存在、怎样运作…"),
				local: true,
			},
		];
		block.phase = "idle";
		block.veiled = this.settings.veilByDefault;
		await this.insertBlock(editor, file.path, sec.to, block, L(`Recall: ${topic}`, `回忆：${topic}`)).catch((e) => new Notice(humanError(e)));
	}

	/* ───────────── Request blocks: the learner talks to their agent in the note ───────────── */

	/** Open a request block below the cursor (or the selection, which goes along as context). */
	async request(editor: Editor, file: TFile) {
		const text = editor.getValue();
		const quote = editor.getSelection().trim().slice(0, 6000);
		const at = glossAnchor(text, editor.posToOffset(editor.getCursor("to")));
		const block = new AskBlock(newId("q"), "request", "", file.path);
		block.quote = quote;
		block.turns = [{ id: newId("u"), kind: "text", question: "", placeholder: L("Ask your agent anything… ([[ to link a file, / for commands)", "向你的 Agent 提任何请求…（[[ 链接文件，/ 使用命令）"), local: true, request: true }];
		block.phase = "idle";
		await this.insertBlock(editor, file.path, at, block, L("Request to the agent", "向 Agent 的请求")).catch((e) => new Notice(humanError(e)));
	}

	/** Send a follow-up in a finished request block: the same conversation goes on. */
	async followUp(block: AskBlock, text: string) {
		if (block.kind !== "request" || !text.trim() || this.ledger.get(block.taskId ?? "")?.active) return;
		withdrawCue(block.id);
		// The reply so far moves into the history, right after the turn it answered. (The same move
		// that coveredTranscript fingerprints a resumable session with.)
		block.turns = withReply(block.turns, block.summary);
		block.summary = "";
		block.error = null;
		block.turns.push({ id: newId("u"), kind: "text", question: "", local: true, request: true, answer: { text: text.trim() } });
		this.persist();
		await this.startRequest(block);
	}

	/**
	 * A visual's icap.ask inside a request block: a follow-up there. False when the block is not a
	 * request block (the visual then has nowhere to send it).
	 */
	visualFollowUp(blockId: string, text: string): boolean {
		const block = this.blocks.get(blockId);
		if (!block || block.kind !== "request") return false;
		// While the agent works it waits in the block, like anything the learner writes then.
		this.enqueue(block, text);
		return true;
	}

	/* ───────────── While the agent works: what the learner writes waits, or is handed over ───────────── */

	/**
	 * The learner wrote in a request block. When its agent is working, the words wait in the block and are
	 * sent as the next request when this round ends; else they are the next request now.
	 */
	enqueue(block: AskBlock, text: string) {
		const said = text.trim();
		if (block.kind !== "request" || !said) return;
		if (!this.ledger.get(block.taskId ?? "")?.active) return void this.followUp(block, said);
		block.queue = [...block.queue, { id: newId("m"), text: said, state: "queued" }];
	}

	/** Take back what was waiting. What is already on its way to the agent cannot be taken back. */
	withdraw(block: AskBlock, id: string) {
		block.queue = block.queue.filter((q) => q.id !== id || q.state === "delivering");
	}

	/** Can what waits in this block be handed to the working agent now? */
	canSteer(block: AskBlock): boolean {
		const task = this.ledger.get(block.taskId ?? "");
		return !!task?.active && !!task.steer;
	}

	/**
	 * Hand a waiting message to the agent now: it reads it after the tool calls of its current turn.
	 * It becomes a request in the block when it arrives (`steered`); if the round ends first, it waits on.
	 */
	async deliverNow(block: AskBlock, id: string) {
		const q = block.queue.find((x) => x.id === id);
		const task = this.ledger.get(block.taskId ?? "");
		if (!q || q.state !== "queued" || !task?.active || !task.steer) return;
		// A command is run by the plugin or by Pi at the start of a round, not by the model in the middle of one.
		if (parseCommand(q.text)) return void new Notice(L("A command runs when the agent has finished this round.", "命令会在 Agent 完成这一轮后执行。"));
		const pointed = extractLinks(q.text).map((link) => ({ link, path: this.app.metadataCache.getFirstLinkpathDest(link, block.notePath)?.path ?? null }));
		const sent = steerPrompt(q.text, pointed);
		const { images } = await this.imagesOf(q.text, block.notePath);
		if (!task.active || !task.steer || !block.queue.some((x) => x.id === id && x.state === "queued")) return;
		block.queue = block.queue.map((x) => (x.id === id ? { ...x, state: "delivering" as const, sent } : x));
		if (task.steer(sent, images)) return;
		block.queue = block.queue.map((x) => (x.id === id ? { id: x.id, text: x.text, state: "queued" as const } : x));
	}

	/** The agent read a message handed over mid-round: it is a request in the conversation from here on. */
	private steered(block: AskBlock, sent: string) {
		const q = block.queue.find((x) => x.sent === sent);
		if (!q) return;
		block.queue = block.queue.filter((x) => x !== q);
		// What the agent said so far answered what came before.
		block.turns = withReply(block.turns, block.summary);
		block.summary = "";
		block.turns.push({ id: newId("u"), kind: "text", question: "", local: true, request: true, answer: { text: q.text } });
		this.persist();
	}

	/**
	 * The images embedded in a request (`![[shot.png]]`), read from the vault to go with the prompt.
	 * `skipped`: some were left out (too many, too large, or not found).
	 */
	private async imagesOf(text: string, notePath: string): Promise<{ images: AgentImage[]; skipped: boolean }> {
		const images: AgentImage[] = [];
		let skipped = false;
		for (const link of imageEmbeds(text)) {
			const file = this.app.metadataCache.getFirstLinkpathDest(link, notePath);
			const type = file ? imageType(file.name) : undefined;
			if (!file || !type || file.stat.size > MAX_IMAGE_BYTES || images.length >= MAX_IMAGES) {
				skipped = true;
				continue;
			}
			try {
				images.push({ data: arrayBufferToBase64(await this.app.vault.readBinary(file)), mimeType: type });
			} catch {
				skipped = true;
			}
		}
		return { images, skipped };
	}

	/**
	 * An image the learner pasted, dropped or chose in a request: saved where their attachments go
	 * (Obsidian's own setting), and written into the request as an embed. Null when it could not be saved.
	 */
	async saveImage(file: File, notePath: string): Promise<string | null> {
		try {
			const ext = imageType(file.name) ? file.name.split(".").pop()!.toLowerCase() : (file.type.split("/")[1] ?? "png").replace("jpeg", "jpg");
			// A pasted image has no name of its own ("image.png"): named the way Obsidian names one.
			const d = new Date();
			const two = (n: number) => String(n).padStart(2, "0");
			const stamp = `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
			const name = imageType(file.name) && !/^image\.[a-z]+$/i.test(file.name) ? file.name : `Pasted image ${stamp}.${ext}`;
			const path = await this.app.fileManager.getAvailablePathForAttachment(name, notePath);
			const saved = await this.app.vault.createBinary(path, await file.arrayBuffer());
			return `![[${this.app.metadataCache.fileToLinktext(saved, notePath, true)}]]`;
		} catch (e) {
			new Notice(L("Could not save the image: ", "无法保存图片：") + humanError(e));
			return null;
		}
	}

	/* ───────────── The last request again, or asked differently ───────────── */

	/**
	 * Can the block's last request be asked again? Only when its round changed no file: what the agent
	 * wrote stays written, and asking again as if it had not would mislead.
	 */
	canRedo(block: AskBlock): boolean {
		if (block.kind !== "request" || block.settled !== "open") return false;
		const task = this.ledger.get(block.taskId ?? "");
		// Without the task of that round, whether it changed a file is not known.
		if (!task || task.active || task.round.length) return false;
		if (!["completed", "failed", "cancelled", "interrupted"].includes(block.phase)) return false;
		// A session's finished rounds are in the note's record; its block holds only an unfinished one.
		if (block.live && !block.turns.some((t) => t.request)) return block.recorded > 0;
		const last = block.turns.findLast((t) => t.request);
		return !!last?.answer && !last.control;
	}

	/** The block's last request, in the learner's words (to change it and send it again). */
	async lastRequest(block: AskBlock): Promise<string> {
		const inBlock = block.turns.findLast((t) => t.request)?.answer?.text;
		if (inBlock !== undefined || !block.live) return inBlock ?? "";
		return findLiveRecord(await this.textOf(block.notePath), block.id)?.record?.rounds.at(-1)?.request ?? "";
	}

	/**
	 * Ask the last request again: as it was (regenerate), or as `text` (the learner changed it). The reply
	 * it had, and the questions of that round, are replaced. The earlier rounds are told to a new session
	 * from the block (the cached one covered the replaced reply and no longer matches).
	 */
	async redo(block: AskBlock, text?: string) {
		if (!this.canRedo(block)) return;
		const again = text?.trim();
		if (block.live && !block.turns.some((t) => t.request)) {
			let round: RequestRound | null = null;
			const ok = await spliceFile(this.app, block.notePath, (note) => {
				const dropped = dropLastRound(note, block.id);
				round = dropped?.round ?? null;
				return dropped?.splice ?? null;
			});
			const taken = round as RequestRound | null;
			if (!ok || !taken) return void new Notice(L("Could not find the last round in this note's record.", "在这篇笔记的记录里找不到上一轮。"));
			block.recorded = Math.max(0, block.recorded - 1);
			block.turns = [{ id: newId("u"), kind: "text", question: "", local: true, request: true, answer: { text: again || taken.request } }];
		} else {
			const i = block.turns.map((t) => !!t.request).lastIndexOf(true);
			const turn = block.turns[i];
			block.turns = [...block.turns.slice(0, i), { id: turn.id, kind: turn.kind, question: "", local: true, request: true, answer: { text: again || turn.answer?.text || "" } }];
		}
		block.summary = "";
		block.error = null;
		this.persist();
		await this.startRequest(block);
	}

	/* ───────────── Session notes: a conversation as a note of its own ───────────── */

	/**
	 * A new session note: a note whose body is one request block that writes its record as it goes
	 * (FORMAT.md 7). It is the learner's note, not the plugin's: it goes where their new notes go (or into
	 * `folder`), and the plugin sets only its two properties.
	 */
	async newSession(folder?: TFolder) {
		const from = this.app.workspace.getActiveFile();
		const parent = folder ?? this.app.fileManager.getNewFileParent(from?.path ?? "");
		const id = newId("q");
		const path = await uniqueNotePath(this.app, parent.isRoot() ? "" : parent.path, sessionName(new Date()));
		const block = new AskBlock(id, "request", "", path);
		block.live = true;
		// The note they came from is most likely what they mean: linked in the first request, theirs to delete.
		const link = from && from.extension === "md" ? `[[${this.app.metadataCache.fileToLinktext(from, path, true)}]] ` : "";
		block.prefill = link;
		block.turns = [{ id: newId("u"), kind: "text", question: "", placeholder: L("Ask your agent anything… ([[ to link a file, / for commands)", "向你的 Agent 提任何请求…（[[ 链接文件，/ 使用命令）"), local: true, request: true, ...(link ? { draft: link } : {}) }];
		block.phase = "idle";
		this.blocks.set(id, block);
		this.focusOnMount.add(id);
		try {
			const file = await this.app.vault.create(path, sessionNote(id, L("Session", "会话")));
			await this.app.workspace.getLeaf("tab").openFile(file);
		} catch (e) {
			this.blocks.delete(id);
			return void new Notice(humanError(e));
		}
		this.persist();
	}

	/**
	 * A session's block this device has no state for (the note was synced from another device, or the
	 * plugin's data was lost): the record in the note is the conversation, so it simply goes on from there.
	 */
	adoptSession(src: AskSource, notePath: string): AskBlock | null {
		if (!src.id || src.kind !== "request" || src.header?.record !== LIVE_RECORD) return null;
		const block = new AskBlock(src.id, "request", "", notePath);
		block.live = true;
		block.phase = "completed";
		this.blocks.set(block.id, block);
		this.persist();
		return block;
	}

	/** The first request names a session note, once, unless the learner already named it themselves. */
	private async nameSession(file: TFile, request: string) {
		const title = sessionTitle(request);
		if (!title || !isSessionName(file.basename)) return;
		try {
			await this.app.fileManager.renameFile(file, await uniqueNotePath(this.app, file.parent && !file.parent.isRoot() ? file.parent.path : "", title));
		} catch {
			/* it keeps the name it has */
		}
	}

	/**
	 * A session's finished rounds go into the note: added to the record above its block, where the next
	 * round reads them back. The block then holds nothing of them. False: the note could not be written,
	 * and the block keeps the round.
	 */
	private async recordRounds(block: AskBlock, task: Task): Promise<boolean> {
		const rounds = roundsOf(block);
		if (!rounds.length) return false;
		const files = task.round.filter((a) => FILE_KINDS.has(a.kind) && !a.path.startsWith("/"));
		const ok = await spliceFile(this.app, block.notePath, (text) => appendRounds(text, block.id, block.topic, rounds, files));
		if (!ok) {
			block.error = L("This round could not be written into the note's record; it is still here.", "这一轮没能写进笔记的记录，它还留在这里。");
			return false;
		}
		block.recorded += rounds.length;
		// What the plugin said about these rounds stays in sight once their turns have left the block.
		block.remark = block.turns.map((t) => t.note).filter(Boolean).join(" ");
		block.turns = [];
		block.summary = "";
		return true;
	}

	/** A file was renamed or moved: what lives in it (blocks, explanations, tasks) follows. */
	onRename(file: TAbstractFile, oldPath: string) {
		if (!(file instanceof TFile)) return;
		let moved = false;
		for (const here of [...this.blocks.values(), ...this.glosses.values(), ...this.ledger.tasks]) {
			if (here.notePath !== oldPath) continue;
			here.notePath = file.path;
			moved = true;
		}
		if (moved) this.persist();
	}

	/** A visual's icap.ask in a note: a new request block just below it (after `line`), sent at once. */
	async requestBelow(path: string, line: number, request: string) {
		if (!this.fileOf(path)) return;
		const text = await this.textOf(path);
		const lines = text.split("\n");
		const n = Math.max(0, Math.min(line, lines.length - 1));
		const at = lines.slice(0, n + 1).join("\n").length;
		const block = new AskBlock(newId("q"), "request", "", path);
		block.turns = [{ id: newId("u"), kind: "text", question: "", local: true, request: true, answer: { text: request } }];
		block.phase = "thinking";
		try {
			await this.insertBlock(editorFor(this.app, path), path, at, block, L("Request to the agent", "向 Agent 的请求"));
		} catch (e) {
			return void new Notice(humanError(e));
		}
		await this.startRequest(block);
	}

	/**
	 * Run (or, after an interruption, continue) the block's latest request.
	 *
	 * The block's visible turns are the conversation. If the Pi session that produced the last reply
	 * still covers exactly those turns, it is resumed and only the new request is sent; otherwise a
	 * fresh session starts from a replay of the turns (SessionCache in agent/backend.ts).
	 *
	 * A request starting with "/" is a command. ICAP's own (/model, /thinking, /compact) are handled
	 * here; any other is sent to Pi verbatim — Pi expands prompt templates and skills, and runs
	 * extension commands, only when the message starts with the command — with the note context in
	 * the system prompt instead of around the message.
	 */
	private async startRequest(block: AskBlock) {
		await this.runRequest(block);
		// What was on its way to the agent when the round ended never arrived: it waits like the rest.
		if (block.queue.some((q) => q.state === "delivering")) block.queue = block.queue.map((q) => ({ id: q.id, text: q.text, state: "queued" as const }));
		// What the learner wrote meanwhile is the next request, one at a time.
		if (block.phase === "completed" && block.queue.length && this.blocks.get(block.id) === block) {
			const [next, ...rest] = block.queue;
			block.queue = rest;
			await this.followUp(block, next.text);
		}
	}

	private async runRequest(block: AskBlock) {
		const file = this.fileOf(block.notePath);
		if (!file) return;
		const i = block.turns.map((t) => !!t.request).lastIndexOf(true);
		const turn = block.turns[i];
		const request = turn?.answer?.text?.trim();
		if (!turn || !request) return;
		const cmd = parseCommand(request);
		if (cmd && isIcapCommand(cmd.name)) return this.runControl(block, turn, cmd.name, cmd.args);
		// A session: the rounds that are finished are in the note's record, and are read from there.
		const record = block.live ? (findLiveRecord(await this.textOf(block.notePath), block.id)?.record ?? null) : null;
		if (block.live) {
			block.remark = "";
			block.recorded = record?.rounds.length ?? 0;
			if (!block.firstRequest) block.firstRequest = record?.rounds[0]?.request || request;
			if (!block.topic) block.topic = record?.title || short(request);
			if (!block.recorded) await this.nameSession(file, block.prefill && request.startsWith(block.prefill.trim()) ? request.slice(block.prefill.trim().length) : request);
		}
		if (!block.topic) block.topic = short(request);
		// An unanswered question from an interrupted run is asked again by the agent.
		if (block.current && !block.current.answer && !block.current.local) block.turns.pop();
		const text = await this.textOf(block.notePath);
		const pos = findAskBlock(text, block.id)?.from ?? 0;
		const ctx = buildContext(this.app, file, text, pos, pos, this.settings.background);
		const earlier = record ? roundsTranscript(record.rounds) : "";
		const history = [earlier, transcriptOf(block, block.turns.slice(0, i))].filter((s) => s.trim()).join("\n");
		const sofar = transcriptOf(block, block.turns.slice(i + 1));
		// The images embedded in the request go with it; a model that cannot read them gets their paths only.
		const { images, skipped } = await this.imagesOf(request, block.notePath);
		turn.note = skipped ? L(`Some images were not sent: at most ${MAX_IMAGES} per request, each up to 5 MB (PNG, JPEG, GIF, WebP).`, `有些图片没有发送：每个请求最多 ${MAX_IMAGES} 张，每张不超过 5 MB（PNG、JPEG、GIF、WebP）。`) : undefined;
		// [[links]] in the request: the files the learner pointed to, resolved like Obsidian does.
		const pointed = extractLinks(request).map((link) => ({ link, path: this.app.metadataCache.getFirstLinkpathDest(link, block.notePath)?.path ?? null }));

		// The session: resumed only if it covers exactly the history; an interrupted round never is.
		const cache = this.settings.rememberContext ? this.sessionCache() : null;
		const setup = this.sessionSetup();
		const resumed = !!cache && !sofar.trim() && reusable(block.session, setup, history) && cache.exists(block.session.id) ? block.session : null;
		let session: string | undefined;
		if (cache) {
			if (resumed) session = resumed.id;
			else {
				cache.remove({ block: block.id });
				block.sessionSeq++;
				session = cache.id(block.id, block.sessionSeq);
			}
		}
		// From here on the old session no longer matches the block — until this round succeeds.
		block.session = null;

		const interrupted = sofar.trim() ? `\n\nYou were interrupted while carrying out this request. What happened so far:\n<so_far>\n${sofar}\n</so_far>\nContinue from there.` : "";
		let prompt: string;
		let systemExtra: string | undefined;
		if (cmd) {
			prompt = request;
			systemExtra = commandContext(ctx, block.quote, resumed ? "" : history, pointed) + interrupted;
		} else if (resumed) {
			prompt = followUpPrompt(request, pointed);
			systemExtra = blockContext(ctx, block.quote);
		} else {
			prompt = requestPrompt(ctx, block.quote, history, request, pointed, this.placementFor(file)) + interrupted;
		}
		// One request block = one ledger line, which keeps the files (and steps) of every round.
		const prev = block.taskId ? this.ledger.get(block.taskId) : undefined;
		if (prev && !prev.active) this.ledger.remove(prev.id);
		const task = this.ledger.add(new Task(newId("t"), "request", `“${short(request)}”`, block.notePath));
		// One request block = one task note, named after its first request.
		// (Its first: the note may only be written at a later round, once the conversation amounts to a task.)
		this.taskNotes.adopt(task, block.id, block.openingRequest || request, "request");
		task.artifacts = prev ? [...prev.artifacts] : [];
		task.steps = prev ? [...prev.steps] : [];
		task.stepsDropped = prev?.stepsDropped ?? 0;
		// What the conversation has cost so far: the task note's cost is the whole block's.
		task.usage = prev?.usage ? { ...prev.usage } : null;
		task.model = prev?.model ?? null;
		task.context = prev?.context ? { ...prev.context } : null;
		// The session is resumable only if its own messages hold the whole conversation. A command in a
		// fresh session got the earlier turns through the system prompt, which Pi does not store.
		const selfContained = !cmd || !!resumed || (!history.trim() && !sofar.trim());
		await this.runBlockTask(block, task, prompt, REQUEST_TOOLS, L(`Done — “${short(request)}”`, `完成——“${short(request)}”`), {
			extras: {
				session,
				systemExtra,
				model: block.model,
				thinking: block.thinking,
				images,
				onImagesDropped: () => {
					turn.note = L("This model does not read images: only the paths of the images were sent.", "这个模型不读图片：只发送了图片的路径。");
					this.persist();
				},
				onSteered: (sent) => this.steered(block, sent),
			},
			onSuccess: async () => {
				// A session's round goes into the note; what the session then covers is what the next round reads there.
				let covered = earlier;
				if (block.live && (await this.recordRounds(block, task))) covered = roundsTranscript(findLiveRecord(await this.textOf(block.notePath), block.id)?.record?.rounds ?? []);
				if (session && selfContained) block.session = { id: session, sig: sessionSig(setup, [covered, coveredTranscript(block)].filter((s) => s.trim()).join("\n")) };
			},
		});
	}

	/**
	 * ICAP's runtime commands: they change how this block's agent runs and stay out of the
	 * conversation (transcriptOf and the kept record skip them).
	 */
	private async runControl(block: AskBlock, turn: Turn, name: IcapCommandName, args: string) {
		turn.control = true;
		block.error = null;
		const done = (reply: string) => {
			turn.reply = reply;
			block.phase = "completed";
			this.persist();
		};
		const reset = /^(default|reset|-)$/i.test(args);
		switch (name) {
			case "model": {
				if (!args) {
					const shown = block.model || this.defaultModel() || L("the default", "默认");
					return done(L(`This block uses **${shown}**. Type \`/model\` and a name to change it here; \`/model default\` follows the settings again.`, `这个块使用 **${shown}**。输入 \`/model\` 加模型名即可只在这里更换；\`/model default\` 恢复为设置中的模型。`));
				}
				block.model = reset ? "" : args;
				if (reset) return done(L("Back to the model in the settings.", "已恢复为设置中的模型。"));
				// Pi also accepts patterns ("sonnet"), so an unknown name is a warning, not a refusal.
				const known = await this.modelChoices();
				const q = args.toLowerCase();
				const warn =
					known.length && !known.some((m) => m.toLowerCase().includes(q))
						? L(" It is not among the models with credentials in your Pi, so the next request may fail.", "它不在你的 Pi 中已有凭证的模型里，下一个请求可能会失败。")
						: "";
				return done(L(`From the next request on, this block uses **${args}**.`, `从下一个请求起，这个块使用 **${args}**。`) + warn);
			}
			case "thinking": {
				if (!args) {
					const shown = block.thinking || this.settings.thinking || "default";
					return done(L(`Thinking in this block: **${shown}**. Levels: ${THINKING_LEVELS.join(", ")}.`, `这个块的思考强度：**${shown}**。可选：${THINKING_LEVELS.join("、")}。`));
				}
				if (!reset && !THINKING_LEVELS.includes(args.toLowerCase())) return done(L(`Unknown level “${args}”. Levels: ${THINKING_LEVELS.join(", ")}.`, `没有“${args}”这个级别。可选：${THINKING_LEVELS.join("、")}。`));
				block.thinking = reset ? "" : args.toLowerCase();
				return done(reset ? L("Back to the thinking level in the settings.", "已恢复为设置中的思考强度。") : L(`From the next request on, thinking here is **${block.thinking}**.`, `从下一个请求起，这里的思考强度为 **${block.thinking}**。`));
			}
			case "compact": {
				const cache = this.backend.capabilities.compact ? this.sessionCache() : null;
				const s = block.session;
				if (!cache || !s || !cache.exists(s.id))
					return done(L("Nothing to compact: this block's conversation is read from the note itself each time.", "没有可压缩的内容：这个块的对话每次都直接从笔记中读取。"));
				const prev = block.taskId ? this.ledger.get(block.taskId) : undefined;
				if (prev && !prev.active) this.ledger.remove(prev.id);
				const task = this.ledger.add(new Task(newId("t"), "request", L(`Compacting “${block.topic}”`, `正在压缩“${block.topic}”`), block.notePath));
				this.taskNotes.adopt(task, block.id, block.topic, "request");
				task.artifacts = prev ? [...prev.artifacts] : [];
				task.steps = prev ? [...prev.steps] : [];
				task.usage = prev?.usage ? { ...prev.usage } : null;
				task.model = prev?.model ?? null;
				task.blockId = block.id;
				block.taskId = task.id;
				block.phase = "thinking";
				// The compacted session still stands for the same visible turns: its fingerprint is kept.
				block.session = null;
				this.persist();
				try {
					await this.runAgent(task, {
						prompt: "",
						tools: REQUEST_TOOLS,
						control: { type: "compact", ...(args ? { customInstructions: args } : {}) },
						session: s.id,
						model: block.model,
						thinking: block.thinking,
						onPhase: (p) => (block.agentPhase = p),
					});
					block.session = s;
					block.agentPhase = null;
					// How full the context is now is known only after the next reply.
					task.context = null;
					task.end("completed", L(`Compacted “${block.topic}”`, `已压缩“${block.topic}”`));
					return done(L("Compacted: the agent now carries a summary of the earlier rounds. The note is unchanged.", "已压缩：Agent 现在带着前面各轮的摘要继续。笔记没有改动。"));
				} catch (e) {
					const r = this.finishWithError(task, e, L(`Could not compact “${block.topic}”`, `无法压缩“${block.topic}”`));
					block.agentPhase = null;
					// A failed compaction leaves the session as it was; a stopped one may not have.
					block.session = r === "failed" ? s : null;
					return done(r === "failed" ? L(`Could not compact: ${task.error ?? ""}`, `无法压缩：${task.error ?? ""}`) : L("Stopped.", "已停止。"));
				}
			}
		}
	}

	/* ───────────── Transparency: what the agent changed in the vault ───────────── */

	/**
	 * Record a vault change on the task whose agent made it: any task (explain, recall, request…) whose
	 * agent is running a tool call — the learner's own shell, write or edit tools, or MCP — or just finished one.
	 */
	onVaultChange(kind: "created" | "edited" | "deleted", file: TAbstractFile, oldPath?: string) {
		if (this.toolScope() !== "full" || !(file instanceof TFile)) return;
		// The document cache is the plugin's own, never the agent's. Its folder (in the plugin's own, or
		// `.icap/docs/` before) raises no vault events; the visible folder of earlier versions does, while
		// it is being moved.
		if (file.path.startsWith(LEGACY_DIR + "/")) return;
		// Task notes and Activity.base are the plugin's own record of a task, not something its agent changed.
		if (this.taskNotes.owns(file.path) || (oldPath && this.taskNotes.owns(oldPath))) return;
		const now = Date.now();
		const tasks = this.ledger.tasks.filter((t) => t.toolsRunning > 0 || now - t.toolEndedAt < TOOL_GRACE_MS);
		if (!tasks.length) return;
		// The learner typing in a note at the same time is not the agent.
		if (kind === "edited" && this.isBeingEdited(file.path)) return;
		for (const t of tasks) {
			// The task's own note is written by the plugin itself (blocks, kept results).
			if (kind === "edited" && file.path === t.notePath) continue;
			if (oldPath) {
				const created = t.artifacts.find((a) => a.kind === "created" && a.path === oldPath);
				if (created) t.artifacts = t.artifacts.map((a) => (a === created ? { ...a, path: file.path, label: basename(file.path) } : a));
				else addArtifact(t, { kind: "edited", path: file.path, label: basename(file.path) });
			} else addArtifact(t, { kind, path: file.path, label: basename(file.path) });
		}
		this.persist();
	}

	private isBeingEdited(path: string): boolean {
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const v = leaf.view;
			if (v instanceof MarkdownView && v.file?.path === path && v.editor.hasFocus()) return true;
		}
		return false;
	}

	/* ───────────── Dialogs: the agent asks in the note (a permission, a connector's sign-in, an extension of the learner's own Pi) ───────────── */

	private async dialog(task: Task, req: DialogRequest, signal: AbortSignal): Promise<DialogAnswer> {
		const existing = task.blockId ? this.blocks.get(task.blockId) : undefined;
		const block = existing ?? (await this.ensureAgentBlock(task));
		if (signal.aborted) return undefined;
		const kind: Turn["kind"] = req.method === "confirm" ? "confirm" : req.method === "select" ? "single" : "text";
		const options = kind === "single" ? (req.options ?? []).map((label, i) => ({ id: String.fromCharCode(97 + i), label })) : undefined;
		const question = [dialogTitle(req.title), req.message?.trim() ?? ""].filter(Boolean).join("\n\n");
		const turn: Turn = {
			id: newId("u"),
			kind,
			question: question || L("The agent asks for input.", "Agent 需要你输入。"),
			options,
			placeholder: req.placeholder,
			draft: req.method === "editor" ? req.prefill : undefined,
			dialog: true,
		};
		block.turns.push(turn);
		block.summary = "";
		block.phase = "waiting";
		task.status = "waiting";
		this.persist();
		this.announceWaiting(task, block);
		this.cueBlock(block, L("your turn", "轮到你了"));
		return new Promise<DialogAnswer>((resolve) => {
			const onAbort = () => {
				// Pi gave up waiting (the extension's timeout): withdraw the question.
				block.dialogResolver = null;
				if (!turn.answer) block.turns = block.turns.filter((t) => t !== turn);
				if (block.phase === "waiting") block.phase = "thinking";
				if (task.status === "waiting") task.status = "processing";
				this.persist();
				resolve(undefined);
			};
			signal.addEventListener("abort", onAbort, { once: true });
			block.dialogResolver = (a) => {
				signal.removeEventListener("abort", onAbort);
				block.dialogResolver = null;
				if (!a) return resolve(undefined);
				if (kind === "confirm") return resolve({ confirmed: !!a.confirmed });
				if (kind === "single") return resolve({ value: options?.find((o) => o.id === a.choices?.[0])?.label ?? "" });
				resolve({ value: a.text ?? "" });
			};
		});
	}

	/* ───────────── Authored blocks (written into the note by a person, e.g. the guide) ───────────── */

	/** The first time an authored fence renders, it becomes a live block with its first question up. */
	adoptAuthored(src: AskSource, notePath: string): AskBlock | null {
		if (!src.id) return null;
		const a = parseAuthored(src);
		if (!a) return null;
		const block = new AskBlock(src.id, a.kind, a.topic, notePath);
		block.authored = true;
		const turn: Turn =
			a.kind === "quiz"
				? { id: newId("u"), kind: a.multi ? "multi" : "single", question: a.question, options: a.options, local: true }
				: a.kind === "recall"
					? { id: newId("u"), kind: "text", question: a.question, placeholder: L("What it is, why it matters, how it works…", "它是什么、为什么重要、怎样运作…"), local: true }
					: { id: newId("u"), kind: "confirm", question: a.question, confirmLabel: a.start, cancelLabel: L("not now", "暂不"), local: true };
		block.turns = [turn];
		block.phase = "idle";
		// An authored recall sits in a note the learner is still reading: the veil waits until they
		// start writing (see AskView), instead of blurring the page as soon as the block renders.
		this.blocks.set(block.id, block);
		this.persist();
		return block;
	}

	/** Drop runtime state for blocks that are about to be written afresh (e.g. a recreated guide). */
	forgetBlocks(ids: string[]) {
		for (const id of ids) {
			const b = this.blocks.get(id);
			if (!b) continue;
			this.stopBlock(b);
			this.blocks.delete(id);
			this.dropSessions(id);
		}
		this.persist();
	}

	/** Start an authored block over: forget what happened, and show its first question again. */
	private async resetAuthored(block: AskBlock) {
		this.stopBlock(block);
		this.blocks.delete(block.id);
		const text = await this.textOf(block.notePath);
		const at = findAskBlock(text, block.id);
		if (!at) return this.persist();
		const inner = text.slice(at.from, at.to).split("\n").slice(1, -1).join("\n");
		this.adoptAuthored(parseAskSource(inner), block.notePath);
		this.persist();
	}

	/** The learner answered an authored block's first question: the agent takes it from there. */
	private async continueAuthored(block: AskBlock, turn: Turn) {
		const file = this.fileOf(block.notePath);
		if (!file) return;
		const text = await this.textOf(block.notePath);
		const pos = findAskBlock(text, block.id)?.from ?? 0;
		if (block.kind === "recall") return this.startCheck(block, turn.answer?.text ?? "", "recall");
		if (block.kind === "agent") {
			if (!turn.answer?.confirmed) {
				block.summary = L("Not now — choose *start over* whenever you want to run it.", "暂不——想做的时候选 *重新开始* 即可。");
				block.phase = "completed";
				return this.persist();
			}
			return this.noteTask("concept", file, block.topic, null, block);
		}
		// quiz: the authored question is the first one; the agent responds to the answer and goes on.
		const ctx = buildContext(this.app, file, text, pos, pos, this.settings.background);
		const material = stripFrontmatter(text).body.replace(/^(`{3,}|~{3,})(?:icap|icpa)-ask[\s\S]*?^\1\s*$/gm, "").slice(0, 12000);
		block.instructions =
			quizPrompt(ctx, material, `the note "${file.basename}"`) +
			"\n- The first question was written by the note's author and has already been asked and answered (see the transcript). Respond to that answer, then ask at most two more questions.";
		await this.resume(block);
	}

	async checkWriting(editor: Editor, file: TFile) {
		const text = editor.getValue();
		let from = editor.posToOffset(editor.getCursor("from"));
		let to = editor.posToOffset(editor.getCursor("to"));
		// A check is about whole thoughts: widen a partial selection to the paragraphs it touches.
		const first = paragraphBounds(text, from);
		const last = paragraphBounds(text, Math.max(from, to - 1));
		from = Math.min(from, first.from);
		to = Math.max(to, last.to);
		const written = text.slice(from, to).trim();
		if (written.length < 12) return void new Notice(L("Write (or select) a few sentences of your own understanding first.", "请先写下（或选中）几句你自己的理解。"));
		const sec = sectionBounds(text, from);
		const topic = sec.title ?? file.basename;
		const block = new AskBlock(newId("q"), "check", topic, file.path);
		block.turns = [{ id: newId("u"), kind: "text", question: "", local: true, inNote: true, answer: { text: written } }];
		try {
			await this.insertBlock(editor, file.path, glossAnchor(text, to), block, L(`Check: ${topic}`, `检查：${topic}`));
		} catch (e) {
			return void new Notice(humanError(e));
		}
		void this.startCheck(block, written, "check");
	}

	async quiz(editor: Editor, file: TFile, scope: "section" | "note") {
		const text = editor.getValue();
		const at = editor.posToOffset(editor.getCursor("from"));
		const selected = editor.getSelection().trim();
		let material: string;
		let topic: string;
		let insertAt: number;
		if (selected.length > 40) {
			material = selected;
			topic = sectionBounds(text, at).title ?? file.basename;
			insertAt = glossAnchor(text, editor.posToOffset(editor.getCursor("to")));
		} else if (scope === "section") {
			const sec = sectionBounds(text, at);
			material = text.slice(sec.from, sec.to);
			topic = sec.title ?? file.basename;
			insertAt = sec.to;
		} else {
			material = stripFrontmatter(text).body;
			topic = file.basename;
			insertAt = text.length;
		}
		const block = new AskBlock(newId("q"), "quiz", topic, file.path);
		block.phase = "preparing";
		try {
			await this.insertBlock(editor, file.path, insertAt, block, L(`Understanding check: ${topic}`, `理解检验：${topic}`));
		} catch (e) {
			return void new Notice(humanError(e));
		}
		const task = this.ledger.add(new Task(newId("t"), "quiz", L(`Understanding check — “${topic}”`, `理解检验——“${topic}”`), file.path));
		const ctx = buildContext(this.app, file, text, at, at, this.settings.background);
		const prompt = quizPrompt(ctx, material.slice(0, 12000), scope === "note" ? `the note "${file.basename}"` : `the section "${topic}"`);
		void this.runBlockTask(block, task, prompt, ASK_TOOLS, L(`Finished understanding check on “${topic}”`, `完成理解检验——“${topic}”`));
	}

	private async startCheck(block: AskBlock, answer: string, mode: "recall" | "check") {
		const file = this.fileOf(block.notePath);
		if (!file) return;
		const text = await this.textOf(block.notePath);
		const pos = findAskBlock(text, block.id)?.from ?? 0;
		const ctx = buildContext(this.app, file, text, pos, pos, this.settings.background);
		const kind: TaskKind = mode;
		const prev = block.taskId ? this.ledger.get(block.taskId) : undefined;
		if (prev && !prev.active) this.ledger.remove(prev.id);
		const task = this.ledger.add(new Task(newId("t"), kind, L(`Checking your explanation of “${block.topic}”`, `正在检查你对“${block.topic}”的解释`), block.notePath));
		// An authored exercise usually sits in its own "try it" section: check against the whole note.
		const prompt = recallPrompt(block.authored ? { ...ctx, section: "" } : ctx, block.topic, answer, mode);
		await this.runBlockTask(block, task, prompt, ASK_TOOLS, L(`Feedback on your explanation of “${block.topic}”`, `对你“${block.topic}”的解释的反馈`));
	}

	private async runBlockTask(
		block: AskBlock,
		task: Task,
		prompt: string,
		tools: string[],
		outcome: string,
		run: { extras?: RunExtras; onSuccess?: () => void | Promise<void> } = {},
	) {
		task.blockId = block.id;
		block.taskId = task.id;
		block.instructions = prompt;
		block.summary = "";
		block.error = null;
		if (block.phase !== "preparing") block.phase = "thinking";
		this.persist();
		try {
			const out = await this.runAgent(task, {
				prompt,
				tools,
				...run.extras,
				onText: (t) => (block.summary = t),
				onPhase: (p) => (block.agentPhase = p),
				onBridge: (op, p) => this.bridge(task, op, p, block),
			});
			// An extension command may do its work without a word; the round still needs a result.
			block.summary = out.trim() || (block.kind === "request" ? L("Done.", "完成。") : "");
			block.phase = "completed";
			await run.onSuccess?.();
			block.agentPhase = null;
			this.cueBlock(block, block.kind === "quiz" ? L("results ready", "结果出来了") : block.kind === "request" ? L("done", "完成") : L("feedback ready", "反馈好了"), 20000);
			// A request's files (created, changed, deleted) are its result; keep them.
			if (block.kind !== "request") setResult(task, { kind: "feedback", path: block.notePath, label: basename(block.notePath) });
			task.end("completed", outcome);
		} catch (e) {
			const r = this.finishWithError(task, e, L(`Interaction on “${block.topic}” stopped`, `“${block.topic}”的交互已停止`));
			block.resolver = null;
			block.dialogResolver = null;
			if (block.current?.dialog && !block.current.answer) block.turns.pop();
			block.agentPhase = null;
			block.phase = r;
			block.error = r === "cancelled" ? null : task.error;
			task.retry = () => void this.resume(block);
		}
		this.persist();
	}

	/** Called by the block UI when the learner submits. */
	async answer(block: AskBlock, turn: Turn, answer: Answer) {
		// A turn takes one answer: a double click, a repeated ⌘↵ or a click during the hand-off is ignored.
		if (turn.answer) return;
		withdrawCue(block.id);
		turn.answer = answer;
		turn.draft = undefined;
		block.veiled = false;
		this.persist();
		if (turn.kind === "review" && turn.review && !block.resolver) {
			// The agent that proposed this edit is gone (Obsidian restarted), but the edit itself is
			// fully known — apply or drop it here instead of re-running the whole task.
			const ok = answer.confirmed ? await this.applyReview(turn.review) : false;
			const task = block.taskId ? this.ledger.get(block.taskId) : undefined;
			if (ok && task) addArtifact(task, { kind: "edited", path: turn.review.path, label: basename(turn.review.path) });
			block.summary = answer.confirmed ? (ok ? L("Change applied.", "已应用修改。") : L("The note changed since; the edit could not be applied.", "笔记在此期间有改动，无法应用这处修改。")) : L("Left the note as it was.", "笔记保持原样。");
			block.phase = "completed";
			this.persist();
			return;
		}
		if (turn.dialog) {
			const resolve = block.dialogResolver;
			block.dialogResolver = null;
			if (resolve) {
				block.phase = "thinking";
				const task = block.taskId ? this.ledger.get(block.taskId) : undefined;
				if (task?.status === "waiting") task.status = "processing";
				resolve(answer);
			}
			this.persist();
			return;
		}
		if (turn.request) {
			await this.startRequest(block);
			return;
		}
		if (turn.final) {
			if (block.kind === "check" && answer.text?.trim()) await this.reviseInNote(block, answer.text.trim());
			await this.keepBlock(block);
			return;
		}
		if (block.kind === "check" && turn.revise && answer.text) await this.reviseInNote(block, answer.text);
		if (block.resolver) {
			const resolve = block.resolver;
			block.resolver = null;
			block.phase = "thinking";
			resolve(this.answerPayload(turn, answer, block));
			return;
		}
		if (block.authored && turn.local && block.turns.indexOf(turn) === 0) {
			await this.continueAuthored(block, turn);
			return;
		}
		if (turn.local && block.kind === "recall" && block.turns.indexOf(turn) === 0) {
			await this.startCheck(block, answer.text ?? "", "recall");
			return;
		}
		await this.resume(block);
	}

	private answerPayload(turn: Turn, a: Answer, block?: AskBlock): Json {
		if (turn.kind === "confirm" || turn.kind === "review") return { status: "answered", confirmed: !!a.confirmed };
		// In a learning interaction every answer deserves a response; remind the agent where it goes.
		const next =
			block && block.kind !== "agent" && block.kind !== "request"
				? "Respond to this answer: put feedback + verdict on it in your next ask_learner call, or in your final message."
				: undefined;
		if (turn.kind === "single" || turn.kind === "multi") {
			const labels = (a.choices ?? []).map((id) => turn.options?.find((o) => o.id === id)?.label ?? id);
			return { status: "answered", choices: a.choices ?? [], chosen: labels, ...(next ? { next } : {}) };
		}
		return { status: "answered", text: a.text ?? "", ...(next ? { next } : {}) };
	}

	private async reviseInNote(block: AskBlock, revised: string) {
		const original = [...block.turns].reverse().find((t) => t.inNote || (t.revise && t.answer?.text && t.answer.text !== revised));
		const prev = block.turns.find((t) => t.inNote)?.answer?.text;
		const old = prev ?? original?.answer?.text;
		if (!old) return;
		const ok = await this.writeAndShow(block.notePath, "follow", (text) => {
			const end = findAskBlock(text, block.id)?.from ?? text.length;
			const i = text.lastIndexOf(old, end);
			return i === -1 ? null : { from: i, to: i + old.length, insert: revised };
		});
		if (ok) {
			const first = block.turns.find((t) => t.inNote);
			if (first?.answer) first.answer.text = revised;
		}
	}

	/** Restart an interrupted/failed/stopped interaction with what happened so far. */
	async resume(block: AskBlock) {
		if (block.kind === "request") return this.startRequest(block);
		const instructions = block.instructions;
		if (!instructions) {
			const first = block.turns[0];
			if (block.kind === "recall" && first?.answer?.text) return this.startCheck(block, first.answer.text, "recall");
			if (block.kind === "check" && first?.answer?.text) return this.startCheck(block, first.answer.text, "check");
			if (block.authored && first?.answer) return this.continueAuthored(block, first);
			return;
		}
		const transcript = transcriptOf(block);
		const kind: TaskKind = block.kind === "agent" ? "note" : block.kind;
		// One interaction = one ledger line: the continuation replaces the interrupted/stopped/failed row.
		const prev = block.taskId ? this.ledger.get(block.taskId) : undefined;
		if (prev && !prev.active) this.ledger.remove(prev.id);
		const firstRun = block.authored && !prev;
		const title = prev?.title ?? (firstRun && block.kind === "quiz" ? L(`Understanding check — “${block.topic}”`, `理解检验——“${block.topic}”`) : L(`Continuing “${block.topic}”`, `继续“${block.topic}”`));
		const task = this.ledger.add(new Task(newId("t"), kind, title, block.notePath));
		const answered = block.turns.length > 0 && !!block.current?.answer;
		const prompt = block.turns.length
			? continuationPrompt(transcript + (answered ? "" : "\n(The last question is still unanswered; ask it again.)"), instructions, firstRun)
			: instructions;
		// The pending unanswered turn will be asked again by the agent.
		if (block.current && !block.current.answer && !block.current.local) block.turns.pop();
		const outcome =
			block.kind === "quiz"
				? L(`Finished understanding check on “${block.topic}”`, `完成理解检验——“${block.topic}”`)
				: block.kind === "agent"
					? L(`Finished “${block.topic}”`, `完成“${block.topic}”`)
					: L(`Feedback on your explanation of “${block.topic}”`, `对你“${block.topic}”的解释的反馈`);
		await this.runBlockTask(block, task, prompt, block.kind === "agent" ? NOTE_TOOLS : ASK_TOOLS, outcome);
		block.instructions = instructions;
	}

	stopBlock(block: AskBlock) {
		const t = block.taskId ? this.ledger.get(block.taskId) : undefined;
		if (t?.active) this.cancelTask(t);
	}

	async clearBlock(block: AskBlock) {
		withdrawCue(block.id);
		if (block.authored) return this.resetAuthored(block);
		if (block.live) return this.endSession(block);
		this.stopBlock(block);
		block.settled = "cleared";
		await spliceFile(this.app, block.notePath, (text) => askReplacement(text, block.id, ""));
		this.blocks.delete(block.id);
		this.dropSessions(block.id);
		this.persist();
	}

	async removeOrphan(path: string, id: string) {
		await spliceFile(this.app, path, (text) => askReplacement(text, id, ""));
	}

	/**
	 * Keeping a recall is itself a constructive act: the learner writes the version of their
	 * explanation they now stand behind (pre-filled with their first attempt). That — not the
	 * dialogue — is what goes into the note.
	 */
	beginFinal(block: AskBlock) {
		const first = block.turns.find((t) => t.answer?.text)?.answer?.text ?? "";
		const inNote = block.kind === "check";
		block.turns.push({
			id: newId("u"),
			kind: "text",
			local: true,
			final: true,
			question: inNote
				? L("Revise what you wrote above, in your own words — the paragraph in your note will be replaced with this.", "用你自己的话修改上面写的内容——笔记中的那段话会被替换成这里写的。")
				: L(`Now write **${escapeMd(block.topic)}** the way you understand it — this is what stays in your note.`, `现在按你的理解写下 **${escapeMd(block.topic)}**——这就是留在笔记里的内容。`),
			placeholder: L("Your explanation, in your own words…", "你的解释，用你自己的话…"),
			draft: first,
		});
		block.phase = "finalizing";
		this.focusOnMount.add(block.id);
		this.persist();
	}

	cancelFinal(block: AskBlock) {
		if (block.current?.final) block.turns.pop();
		block.phase = "completed";
		this.persist();
	}

	/**
	 * End a session: its block leaves the note. The record above it is already there and stays, the
	 * learner's to keep or delete; a round that had not finished is not in it.
	 */
	async endSession(block: AskBlock) {
		withdrawCue(block.id);
		this.stopBlock(block);
		block.settled = "kept";
		await spliceFile(this.app, block.notePath, (text) => askReplacement(text, block.id, ""));
		this.blocks.delete(block.id);
		this.dropSessions(block.id);
		this.persist();
	}

	async keepBlock(block: AskBlock) {
		if (block.live) return this.endSession(block);
		const md = keptMarkdown(block, this.ledger.get(block.taskId ?? "")?.artifacts ?? []);
		const ok = await this.writeAndShow(block.notePath, "follow", (text) => askReplacement(text, block.id, md));
		if (!ok) return void new Notice(L("Could not find this interaction in the note.", "在笔记中找不到这段交互。"));
		block.settled = "kept";
		this.blocks.delete(block.id);
		// What the learner kept is in the note now; the agent's working context is not needed any more.
		this.dropSessions(block.id);
		const t = block.taskId ? this.ledger.get(block.taskId) : undefined;
		if (t) {
			t.outcome = `${t.outcome || block.topic} · ` + L("kept in note", "已留在笔记里");
			if (block.kind !== "request") setResult(t, { kind: "kept", path: block.notePath, label: basename(block.notePath) });
		}
		this.persist();
	}

	async blockToNote(block: AskBlock) {
		const file = this.fileOf(block.notePath);
		if (!file) return;
		await this.noteTask("from-interaction", file, transcriptOf(block) + (block.summary ? `\nFinal feedback: ${block.summary}` : ""), null);
	}

	/* ───────────────────────── Bridge (Pi → document) ───────────────────────── */

	private async bridge(task: Task, op: string, p: Json, block: AskBlock | null): Promise<Json> {
		switch (op) {
			case "ask": {
				const b = block ?? (await this.ensureAgentBlock(task));
				return this.ask(task, b, p);
			}
			case "create_note":
				return this.createNote(task, p);
			case "propose_edit": {
				const b = block ?? (await this.ensureAgentBlock(task));
				return this.proposeEdit(task, b, p);
			}
			default:
				return { status: "error", message: `Unknown operation ${op}` };
		}
	}

	private agentAnchor = new Map<string, number>();

	private async ensureAgentBlock(task: Task): Promise<AskBlock> {
		const existing = task.blockId ? this.blocks.get(task.blockId) : undefined;
		if (existing) return existing;
		const block = new AskBlock(newId("q"), "agent", task.title.replace(/^.*?“|”.*$/g, "") || "this note", task.notePath);
		block.taskId = task.id;
		block.phase = "thinking";
		task.blockId = block.id;
		const text = await this.textOf(task.notePath);
		const at = this.agentAnchor.get(task.id) ?? text.length;
		await this.insertBlock(editorFor(this.app, task.notePath), task.notePath, at, block, task.title);
		return block;
	}

	private ask(task: Task, block: AskBlock, p: Json): Promise<Json> {
		const prev = [...block.turns].reverse().find((t) => t.answer);
		if (prev && typeof p.feedback === "string" && p.feedback.trim()) {
			prev.feedback = p.feedback.trim();
			const v = p.verdict;
			if (v === "holds" || v === "partly" || v === "reconsider") prev.verdict = v;
		}
		const kind = (["single", "multi", "text", "confirm"] as const).includes(p.kind as never) ? (p.kind as Turn["kind"]) : "text";
		const lastText = [...block.turns].reverse().find((t) => t.answer?.text)?.answer?.text;
		const options = Array.isArray(p.options)
			? (p.options as Json[]).map((o, i) => ({ id: String(o.id ?? String.fromCharCode(97 + i)), label: tidyOptionLabel(String(o.label ?? "")) }))
			: undefined;
		const turn: Turn = {
			id: newId("u"),
			kind,
			question: tidyQuestion(String(p.question ?? ""), kind === "single" || kind === "multi" ? (options?.length ?? 0) : 0),
			options,
			placeholder: typeof p.placeholder === "string" ? p.placeholder : undefined,
			revise: kind === "text" && p.revise === true,
			confirmLabel: typeof p.confirm_label === "string" ? p.confirm_label : undefined,
			cancelLabel: typeof p.cancel_label === "string" ? p.cancel_label : undefined,
		};
		if (turn.revise && lastText) turn.draft = lastText;
		block.turns.push(turn);
		block.summary = "";
		block.phase = "waiting";
		task.status = "waiting";
		this.persist();
		this.announceWaiting(task, block);
		this.cueBlock(block, L("your turn", "轮到你了"));
		return new Promise((resolve) => {
			block.resolver = resolve;
		});
	}

	private announceWaiting(task: Task, block: AskBlock) {
		const active = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (active?.file?.path === block.notePath) return;
		const n = new Notice(L(`A question is waiting in “${basename(block.notePath)}”.`, `“${basename(block.notePath)}”里有一个问题在等你。`), 6000);
		n.messageEl.addEventListener("click", () => void this.reveal(task));
	}

	/**
	 * Where new notes from a task in `file` go (prompts.ts, placementRule): the learner's folder if they
	 * set one; else the agent chooses, told where related notes are and how the vault is laid out.
	 */
	placementFor(file: TFile): Placement {
		const here = file.parent?.path === "/" ? "" : (file.parent?.path ?? "");
		const fixed = this.settings.notesFolder;
		if (fixed) return { fixed, here, near: [], folders: [] };
		const near = new Set<string>();
		for (const l of this.app.metadataCache.getFileCache(file)?.links ?? []) {
			const to = this.app.metadataCache.getFirstLinkpathDest(l.link.split("#")[0], file.path);
			const dir = to?.parent?.path;
			if (to && dir !== undefined) near.add(dir === "/" ? "" : dir);
			if (near.size >= 8) break;
		}
		// Two levels deep, at most 40: the plugin's own folder (task notes) is not a place for study notes.
		const own = this.settings.taskNotes === "on" ? this.taskNotes.home : null;
		const folders: string[] = [];
		const walk = (f: TFolder, depth: number) => {
			for (const c of f.children) {
				if (!(c instanceof TFolder) || c.name.startsWith(".") || c.path === own || folders.length >= 40) continue;
				folders.push(c.path);
				if (depth < 2) walk(c, depth + 1);
			}
		};
		walk(this.app.vault.getRoot(), 1);
		return { fixed: "", here, near: [...near].filter((d) => d !== own), folders };
	}

	private async createNote(task: Task, p: Json): Promise<Json> {
		const title = String(p.title ?? "").trim();
		const type: NoteType = p.type === "canvas" || p.type === "base" ? p.type : "note";
		let content = String(p.content ?? "");
		if (!title || !content.trim()) return { status: "error", message: "title and content are required" };
		if (type !== "note") {
			// The file itself, not a note about it: a fence around it would make it unreadable.
			content = content.trim().replace(/^```[\w-]*\n([\s\S]*?)\n```$/, "$1");
			const problem = structureProblem(type, content);
			if (problem) return { status: "error", message: `Not created: ${problem}` };
			if (type === "canvas") content = JSON.stringify(JSON.parse(content), null, "\t");
		}
		const here = this.fileOf(task.notePath);
		const folder = String(p.folder ?? "").trim() || this.settings.notesFolder || here?.parent?.path || "";
		const path = await uniqueNotePath(this.app, folder === "/" ? "" : folder, title, NOTE_EXT[type]);
		const created = await this.app.vault.create(path, content.trimEnd() + "\n");
		// Tool-level metadata only: later explanations must not take this note for the learner's own words.
		if (type === "note" && this.settings.markGenerated) await this.app.fileManager.processFrontMatter(created, (fm: Record<string, unknown>) => void (fm["generated-by"] = GENERATED_BY)).catch(() => undefined);
		addArtifact(task, { kind: "created", path, label: basename(path) });
		this.persist();
		return { status: "created", path, link: `[[${basename(path)}]]` };
	}

	private async proposeEdit(task: Task, block: AskBlock, p: Json): Promise<Json> {
		const path = String(p.path ?? "");
		const file = this.fileOf(path) ?? this.fileOf(path + ".md");
		if (!file) return { status: "error", message: `No note at ${path}` };
		const find = String(p.find ?? "");
		const text = await this.textOf(file.path);
		if (find && !text.includes(find)) return { status: "error", message: "The text to replace was not found in the note." };
		const replace = String(p.replace ?? "");
		// A canvas or base must still open after the edit.
		const kind = noteTypeOf(file.path);
		if (kind !== "note") {
			const after = find ? text.replace(find, () => replace) : text + replace;
			const broken = structureProblem(kind, after);
			if (broken) return { status: "error", message: `After this edit the ${kind} would not open: ${broken}` };
		}
		// Refused before the learner sees anything: the rules the prompt states, enforced.
		const problem = editProblem(text, find, replace);
		if (problem === "visual")
			return {
				status: "error",
				message: "An edit to an existing note cannot add an ```icap-ui visual. Put the visual in your reply to the learner instead (or in a new note you create with create_note).",
			};
		if (problem === "block")
			return {
				status: "error",
				message: "That edit touches an ICAP block (an ```icap-ask fence), which belongs to the plugin. Edit only the learner's own text, outside those blocks.",
			};
		// Put the question up and turn it into a reviewable diff *before* waiting for the learner.
		const pending = this.ask(task, block, { kind: "confirm", question: String(p.summary ?? L("Proposed change", "建议的修改")) });
		const turn = block.current!;
		turn.kind = "review";
		turn.review = { path: file.path, find, replace, summary: String(p.summary ?? "") };
		this.persist();
		const a = await pending;
		if (!a.confirmed) return { status: "declined" };
		const ok = await this.applyReview(turn.review);
		if (ok) addArtifact(task, { kind: "edited", path: file.path, label: basename(file.path) });
		this.persist();
		return ok ? { status: "accepted" } : { status: "error", message: "The note changed; the edit could not be applied." };
	}

	/* ───────────── What the built-in agent's own tools may do (agent/permissions.ts) ───────────── */

	private backups: Backups | null = null;

	/** The originals of the files the agent's tools change, in the plugin's own folder. */
	private backupStore(): Backups {
		this.backups ??= new Backups(this.app.vault.adapter, `${this.plugin.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.plugin.manifest.id}`}/backups`);
		return this.backups;
	}

	/** Remove the originals that are older than a month. */
	pruneBackups() {
		void this.backupStore().prune();
	}

	/**
	 * The agent's edit or write tool wants a file to hold `content` (agent/desktop/tool-ops.ts). By the
	 * tool scope and the confirmation mode this refuses, shows the learner the change and waits, or lets it
	 * land at once; either way the original is kept first, and the file is recorded on the task.
	 *
	 * `rel`: the vault path, when the file is inside the vault's folder (its Obsidian folder included);
	 * the plugin then writes it itself, through the open editor when there is one. Without `rel` the
	 * answer "direct" tells the backend to write.
	 */
	private async writeFile(task: Task, p: Json): Promise<Json> {
		const abs = String(p.path ?? "");
		const rel = typeof p.rel === "string" ? p.rel : undefined;
		const target: WriteTarget = p.target === "protected" || p.target === "outside" ? p.target : "vault";
		const content = String(p.content ?? "");
		const shown = rel ?? abs;
		const decision = writeDecision(this.toolScope(), this.confirmMode(), target, rel !== undefined);
		if (decision === "refuse") {
			return { status: "refused", message: `"${shown}" is outside the vault: in this setup files are written only inside it.` };
		}
		const adapter = this.app.vault.adapter;
		const file = rel !== undefined ? this.fileOf(rel) : null;
		// The file as the tool read it: from disk, which is what its edit was computed against.
		let before: string | null;
		try {
			before = rel !== undefined ? ((await adapter.exists(rel)) ? await adapter.read(rel) : null) : ((await this.backend.files?.readText(abs)) ?? null);
		} catch {
			before = null;
		}
		if (before === content) return { status: "written" };
		const change: Hunk = before === null ? { find: "", replace: content, at: 0 } : hunk(before, content);
		if (file && target === "vault") {
			// The rules the prompt states for propose_edit hold for these tools too, before the learner sees anything.
			const kind = noteTypeOf(file.path);
			if (kind !== "note") {
				const broken = structureProblem(kind, content);
				if (broken) return { status: "error", message: `After this change the ${kind} would not open: ${broken}` };
			} else {
				const problem = editProblem(before ?? "", change.find, change.replace);
				if (problem === "visual") return { status: "error", message: "A change to an existing note cannot add an ```icap-ui visual. Put the visual in your reply to the learner instead (or in a new note)." };
				if (problem === "block") return { status: "error", message: "That change touches an ICAP block (an ```icap-ask fence), which belongs to the plugin. Change only the learner's own text, outside those blocks." };
			}
		}
		const review: NonNullable<Turn["review"]> = {
			path: shown,
			find: change.find,
			replace: change.replace,
			// The path stands above the diff already: say whose change this is.
			summary: before === null ? L("A new file the agent wants to create", "Agent 想新建的文件") : L("A change the agent's file tool wants to make", "Agent 的文件工具想做的修改"),
			at: change.at,
			...(before === null ? { create: true } : {}),
			...(rel === undefined ? { outside: true } : {}),
		};
		if (decision === "ask") {
			const block = (task.blockId ? this.blocks.get(task.blockId) : undefined) ?? (await this.ensureAgentBlock(task));
			const pending = this.ask(task, block, { kind: "confirm", question: review.summary });
			const turn = block.current!;
			turn.kind = "review";
			turn.review = review;
			this.persist();
			const a = await pending;
			if (!a.confirmed) return { status: "declined", message: "The learner declined this change; the file is as it was." };
		}
		await this.backupStore().keep(task.id, shown, before);
		if (rel === undefined) {
			// Outside the vault the backend writes; the change is the task's all the same.
			this.noteChange(task, review, before === null ? "created" : "edited", decision === "direct");
			return { status: "direct" };
		}
		const ok = await this.applyChange(review, content);
		if (!ok) return { status: "error", message: "The file changed in the meantime; the change could not be applied. Read it again." };
		this.noteChange(task, review, before === null ? "created" : "edited", decision === "direct");
		return { status: "written" };
	}

	/**
	 * Record a file the agent's tools changed on its task. A change that landed without being asked about
	 * (auto-accepted) also leaves its diff in the task's block, as a review already decided, so the learner
	 * can open what happened; it is not part of the conversation and is not kept in the note.
	 */
	private noteChange(task: Task, review: NonNullable<Turn["review"]>, kind: "created" | "edited", landedByItself: boolean) {
		if (!review.outside) addArtifact(task, { kind, path: review.path, label: basename(review.path) });
		// A file outside the vault has no link in the note, but its round still changed a file.
		else task.round = [...task.round, { kind, path: review.path, label: basename(review.path) }];
		const block = task.blockId ? this.blocks.get(task.blockId) : undefined;
		if (landedByItself && block) {
			block.turns.push({ id: newId("u"), kind: "review", question: review.summary, review, answer: { confirmed: true }, confirmLabel: L("applied", "已应用"), control: true });
		}
		this.persist();
	}

	/** Write a change the learner agreed to (or need not be asked about) into the vault's folder. */
	private async applyChange(r: NonNullable<Turn["review"]>, content?: string): Promise<boolean> {
		const file = this.fileOf(r.path);
		if (file) {
			// An existing note: only the changed lines, in the note as it is now, through the open editor.
			return this.writeAndShow(r.path, "point", (t) => {
				const at = locate(t, { find: r.find, replace: r.replace, at: r.at ?? 0 });
				return at ? { ...at, insert: r.replace } : null;
			});
		}
		// A new file, or one Obsidian does not index (its own folder): written whole.
		const adapter = this.app.vault.adapter;
		const text = content ?? r.replace;
		try {
			const dir = r.path.split("/").slice(0, -1).join("/");
			if (dir && !(await adapter.exists(dir))) await adapter.mkdir(dir);
			if (r.create && (await adapter.exists(r.path))) return false;
			await adapter.write(r.path, text);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * The built-in agent wants to run a shell command or call one of the learner's connectors
	 * (agent/desktop/icap-extension.ts). Asked in the task's block unless the confirmation mode lets it run,
	 * or the learner already said "always" for this block. "Always" lasts as long as the block: it is never
	 * written to the settings, and never covers a command that names a protected folder.
	 */
	private async permit(task: Task, p: Json): Promise<Json> {
		const connector = p.kind === "connector";
		const guarded = p.protected === true;
		const decision = actionDecision(this.toolScope(), this.confirmMode(), guarded);
		if (decision === "refuse") return { status: "refused", message: connector ? "Connectors are not available in this setup." : "The shell is not available in this setup." };
		if (decision === "direct") return { status: "allowed" };
		const tool = String(p.tool ?? "");
		const key = connector ? `connector:${tool}` : "shell";
		const block = (task.blockId ? this.blocks.get(task.blockId) : undefined) ?? (await this.ensureAgentBlock(task));
		if (!guarded && block.allowed.has(key)) return { status: "allowed" };
		const once = L("Allow once", "允许这一次");
		const always = connector ? L("Always allow this tool in this block", "本块内总是允许这个工具") : L("Always allow commands in this block", "本块内总是允许命令");
		const deny = L("Deny", "拒绝");
		const what = connector
			? `**${connectorLabel(tool)}**\n\n\`\`\`json\n${clipText(JSON.stringify(p.input ?? {}, null, 2), 1200)}\n\`\`\``
			: `\`\`\`sh\n${clipText(String(p.command ?? ""), 2000)}\n\`\`\``;
		const answer = await this.dialog(
			task,
			{
				method: "select",
				title: connector ? L("The agent wants to use a connector", "Agent 想使用一个 Connector") : L("The agent wants to run a command", "Agent 想运行一条命令"),
				message: guarded ? `${what}\n\n${L("It names a protected folder (Obsidian's or Pi's own), so it always asks.", "它涉及受保护的文件夹（Obsidian 或 Pi 自己的），所以总是要问。")}` : what,
				// A command that names a protected folder is decided one at a time.
				options: guarded ? [once, deny] : [once, always, deny],
			},
			new AbortController().signal,
		);
		const chosen = answer && "value" in answer ? answer.value : "";
		if (chosen === always) block.allowed.add(key);
		if (chosen === once || chosen === always) return { status: "allowed" };
		return { status: "denied", message: connector ? "The learner did not allow this connector call." : "The learner did not allow this command." };
	}

	private applyReview(r: NonNullable<Turn["review"]>): Promise<boolean> {
		// A change from the agent's file tools (writeFile), decided after its agent was gone: inside the vault it can still be applied.
		if (r.at !== undefined || r.create) return r.outside ? Promise.resolve(false) : this.applyChange(r);
		return this.writeAndShow(r.path, "point", (t) => {
			if (!r.find) return { from: t.length, to: t.length, insert: (t.endsWith("\n") ? "\n" : "\n\n") + r.replace };
			const i = t.indexOf(r.find);
			return i === -1 ? null : { from: i, to: i + r.find.length, insert: r.replace };
		});
	}

	/**
	 * Write into a note and show what changed: if the note is open, the written text is washed
	 * with ink for a moment (see editor/fresh.ts). "follow": the text replaces what the learner is
	 * looking at (keep, write it up) — keep it on screen. "point": it lands elsewhere (an applied
	 * edit) — don't move the learner; if it is off screen, an edge cue points to it.
	 */
	private async writeAndShow(path: string, mode: "follow" | "point", compute: (text: string) => Splice | null): Promise<boolean> {
		let applied = null as Splice | null;
		const ok = await spliceFile(this.app, path, (t) => (applied = compute(t)));
		const s = applied;
		if (!ok || !s) return ok;
		const editor = editorFor(this.app, path);
		const cm = editor ? cmOf(editor) : null;
		const lead = s.insert.length - s.insert.trimStart().length;
		const body = s.insert.trim();
		if (!cm || !body) return ok;
		const from = s.from + lead;
		const to = from + body.length;
		flashRange(cm, from, to);
		if (mode === "follow") {
			// After the block becomes plain Markdown (shorter or taller), bring the result back into view.
			window.setTimeout(() => {
				if (cm.dom.isConnected) cm.dispatch({ effects: EditorView.scrollIntoView(Math.min(from, cm.state.doc.length), { y: "nearest", yMargin: 64 }) });
			}, 60);
		} else if (this.cmsShowing(path).includes(cm)) {
			const marker = { pos: from };
			const owner = `edit:${from}:${Date.now()}`;
			cue(cm, {
				label: L("edit applied", "已应用修改"),
				owner,
				ttl: 12000,
				pos: () => (marker.pos <= cm.state.doc.length ? marker.pos : null),
				go: () => {
					cm.dispatch({ effects: EditorView.scrollIntoView(marker.pos, { y: "center" }) });
					window.setTimeout(() => flashRange(cm, marker.pos, Math.min(marker.pos + body.length, cm.state.doc.length)), 250);
				},
			});
		}
		return ok;
	}

	/* Guidance: point to things that need the learner when they are off screen (editor/cue.ts). */

	private cueBlock(block: AskBlock, label: string, ttl?: number) {
		for (const cm of this.cmsShowing(block.notePath)) {
			cue(cm, {
				label,
				owner: block.id,
				ttl,
				pos: () => findAskBlock(cm.state.doc.toString(), block.id)?.from ?? null,
				go: () => void this.openAt(block.notePath, block.id, null),
			});
		}
	}

	private cueGloss(gloss: Gloss, label: string) {
		for (const cm of this.cmsShowing(gloss.notePath)) {
			cue(cm, {
				label,
				owner: gloss.id,
				ttl: 20000,
				pos: () => anchorsIn(cm, this.field).find((a) => a.id === gloss.id)?.anchor ?? null,
				go: () => void this.openAt(gloss.notePath, null, gloss.id),
			});
		}
	}

	/** Editors in the active window's main area that show this note (cues only make sense there). */
	private cmsShowing(path: string): EditorView[] {
		const active = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (active?.file?.path !== path) return [];
		const cm = cmOf(active.editor);
		return cm ? [cm] : [];
	}

	/** Give the keyboard back to the note's editor. */
	focusEditor(path: string) {
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const v = leaf.view;
			if (v instanceof MarkdownView && v.file?.path === path) {
				v.editor.focus();
				return;
			}
		}
	}

	/**
	 * Keyboard route from the text into the document's interactions: focus the explanation or
	 * question nearest below the cursor (or the last one above it).
	 */
	focusNearestInteraction(view: MarkdownView) {
		const cm = cmOf(view.editor);
		const root = view.containerEl;
		const items = [...root.querySelectorAll<HTMLElement>(".icap-gloss, .icap-ask:not(.is-orphan)")].filter((el) => el.offsetParent !== null);
		if (!items.length) return void new Notice(L("No explanation or question in this note yet.", "这篇笔记里还没有解释或问题。"));
		const y = cm ? (cm.coordsAtPos(cm.state.selection.main.head)?.top ?? 0) : 0;
		const target = items.find((el) => el.getBoundingClientRect().bottom > y) ?? items[items.length - 1];
		target.scrollIntoView({ block: "nearest" });
		const input = target.matches(".icap-ask")
			? target.querySelector<HTMLElement>("textarea, [role=radio][tabindex='0'], [role=checkbox][tabindex='0'], .icap-confirm button, .icap-actions .icap-primary")
			: null;
		(input ?? target).focus();
	}

	/* ───────────────────────── Agent-assisted notes ───────────────────────── */

	async noteTask(kind: NoteTaskKind, file: TFile, input: string, editor: Editor | null, into?: AskBlock) {
		const titles: Record<NoteTaskKind, string> = {
			concept: L(`Writing a concept note — “${short(input)}”`, `正在写概念笔记——“${short(input)}”`),
			collect: L(`Collecting key concepts — “${file.basename}”`, `正在整理关键概念——“${file.basename}”`),
			compare: L(`Writing a comparison — ${short(input)}`, `正在写对比——${short(input)}`),
			"from-interaction": L(`Turning an interaction into a note — “${file.basename}”`, `正在把交互写成笔记——“${file.basename}”`),
		};
		const task = this.ledger.add(new Task(newId("t"), "note", titles[kind], file.path));
		// Carried out inside a request block, it is that block's task; otherwise a task of its own.
		this.taskNotes.adopt(task, into?.kind === "request" ? into.id : task.id, noteTaskName(kind, file.basename, input), into?.kind === "request" ? "request" : "note");
		const text = editor ? editor.getValue() : await this.textOf(file.path);
		let at = editor ? editor.posToOffset(editor.getCursor("to")) : text.length;
		if (into) {
			// Carried out inside an existing block: its questions, proposed edits and result land there.
			task.blockId = into.id;
			into.taskId = task.id;
			into.phase = "thinking";
			into.summary = "";
			into.error = null;
			at = findAskBlock(text, into.id)?.from ?? at;
		}
		this.agentAnchor.set(task.id, editor ? glossAnchor(text, at) : text.length);
		const ctx = buildContext(this.app, file, text, at, at, this.settings.background);
		const prompt = notePrompt(ctx, kind, input, this.placementFor(file));
		try {
			const out = await this.runAgent(task, {
				prompt,
				tools: NOTE_TOOLS,
				onBridge: (op, p) => this.bridge(task, op, p, task.blockId ? this.blocks.get(task.blockId) ?? null : null),
			});
			const created = task.artifacts.filter((a) => a.kind === "created");
			const outcome = created.length
				? created.length === 1
					? L(`Created “${created[0].label}”`, `已新建“${created[0].label}”`)
					: L(`Created ${created.length} notes`, `已新建 ${created.length} 篇笔记`)
				: firstSentence(out) || L("Finished — no notes created", "完成——没有新建笔记");
			const block = task.blockId ? this.blocks.get(task.blockId) : undefined;
			if (block) {
				block.summary = out.trim();
				block.phase = "completed";
				this.cueBlock(block, L("done", "完成"), 20000);
			}
			task.end("completed", outcome);
			if (created.length) {
				const n = new Notice(outcome + L(". Open the activity ledger to see them.", "。打开活动面板查看。"), 5000);
				n.messageEl.addEventListener("click", () => void this.showActivity());
			}
		} catch (e) {
			this.finishWithError(task, e, L("Could not create the notes", "无法新建笔记"));
			task.retry = () => void this.noteTask(kind, file, input, null, into && this.blocks.get(into.id) === into ? into : undefined);
			const block = task.blockId ? this.blocks.get(task.blockId) : undefined;
			if (block) {
				block.phase = task.status === "cancelled" ? "cancelled" : "failed";
				block.error = task.error;
			}
		}
		this.persist();
	}

	/* ───────────────────────── Navigation ───────────────────────── */

	/**
	 * Show the activity: Activity.base, where request and note tasks are listed as notes. Something that
	 * waits for the learner and has no note (a recall, a check, a quiz) is where "activity" leads first.
	 * Without the Bases core plugin, the plugin's own list opens instead.
	 */
	async showActivity() {
		const waiting = this.ledger.waiting.find((t) => !this.taskNotes.has(t));
		if (waiting) return this.reveal(waiting);
		// Without Bases, or in a vault that does not record tasks as notes, the plugin's own list.
		if (!basesEnabled(this.app) || this.settings.taskNotes !== "on") return void (this.ledger.open = !this.ledger.open);
		const file = await this.taskNotes.ensureBase(true).catch(() => null);
		if (!file) return void (this.ledger.open = !this.ledger.open);
		// By the leaf's state, not its view: a tab not shown since startup has no view yet.
		const open = this.app.workspace.getLeavesOfType("bases").find((l) => l.getViewState().state?.file === file.path);
		if (open) return void this.app.workspace.setActiveLeaf(open, { focus: true });
		await this.app.workspace.getLeaf("tab").openFile(file);
	}

	/** The learner asks for the task notes of recent activity that are missing (deleted, or never written). */
	async rebuildTaskNotes() {
		if (this.settings.taskNotes !== "on")
			return void new Notice(L("Tasks are not recorded as notes in this vault. Turn on Record tasks as notes in the settings (Files).", "这个库没有把任务记录成笔记。请在设置的「文件」中打开「把任务记录成笔记」。"));
		const made = await this.taskNotes.restore(this.ledger.tasks).catch((e) => {
			console.error("ICAP: could not rebuild task notes", e);
			return -1;
		});
		if (made < 0) return void new Notice(L("Could not rebuild the task notes; see the console.", "无法重建任务笔记，详见控制台。"));
		new Notice(
			made
				? L(`Rebuilt ${made} task ${made === 1 ? "note" : "notes"} in “${this.taskNotes.folder}”.`, `已在“${this.taskNotes.folder}”重建 ${made} 篇任务笔记。`)
				: L("No task note is missing for the recent activity (the latest 60 tasks are kept).", "最近的活动没有缺失的任务笔记（只保留最近 60 个任务）。"),
		);
	}

	/**
	 * After load: record tasks this device was running when Obsidian closed, and, once per vault, turn the
	 * activity earlier versions kept in plugin data into task notes.
	 */
	async startTaskNotes() {
		this.taskNotes.adoptInterrupted();
		await this.taskNotes.sync();
		// The activity of earlier versions becomes task notes only in a vault that records them.
		if (this.settings.taskNotes !== "on") return;
		await this.taskNotes.addActivityView().catch((e) => console.error("ICAP: could not add the activity view to Activity.base", e));
		if (this.settings.taskNotesMigrated) return;
		const made = await this.taskNotes.migrate(this.ledger.tasks).catch((e) => {
			console.error("ICAP: could not migrate the activity to task notes", e);
			return -1;
		});
		if (made < 0) return;
		this.settings.taskNotesMigrated = true;
		this.persist();
		if (made) announceMigration(this.taskNotes.folder, made);
	}

	/** Recording was turned on: the recent tasks it skipped get their notes, and Activity.base is made. */
	async startRecording() {
		this.settings.taskNotesMigrated = true;
		this.persist();
		await this.taskNotes.restore(this.ledger.tasks).catch((e) => console.error("ICAP: could not write task notes", e));
		await this.taskNotes.ensureBase(true).catch((e) => console.error("ICAP: could not make Activity.base", e));
	}

	async reveal(task: Task) {
		const path = task.artifacts.find((a) => a.kind === "created")?.path ?? task.notePath;
		await this.openAt(path, task.blockId, task.glossId);
	}

	async openPath(path: string) {
		await this.openAt(path, null, null);
	}

	/**
	 * The activity: a task leads back to where it was asked, in the note it came from: its block while
	 * the block is there, else the record kept in its place, else the note itself. `source` is the task
	 * note's link to that note, `request` its name (the request). False when there is no such note.
	 */
	async openTask(id: string, source: string | null, request: string, from = ""): Promise<boolean> {
		const task = this.taskNotes.taskOf(id);
		const path = task?.notePath ?? (source ? this.app.metadataCache.getFirstLinkpathDest(source, from)?.path : undefined);
		if (!path || !this.fileOf(path)) return false;
		const blockId = task?.blockId ?? id;
		await this.openAt(path, this.blocks.has(blockId) ? blockId : null, null, (text) => findRequestRecord(text, request));
		return true;
	}

	/** Open a note at a block, a gloss, or (`find`) a place in its text. */
	private async openAt(path: string, blockId: string | null, glossId: string | null, find?: (text: string) => number | null) {
		const file = this.fileOf(path);
		if (!file) return void new Notice(L("That note no longer exists.", "那篇笔记已经不存在了。"));
		let view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (view?.file?.path !== path) {
			const leaf = this.app.workspace.getLeaf(false);
			await leaf.openFile(file);
			view = leaf.view instanceof MarkdownView ? leaf.view : null;
		}
		if (!view) return;
		const editor = view.editor;
		const text = editor.getValue();
		let offset: number | null = find?.(text) ?? null;
		if (blockId && this.blocks.has(blockId)) offset = findAskBlock(text, blockId)?.from ?? offset;
		const g = glossId ? this.glosses.get(glossId) : undefined;
		if (g) offset = g.anchor;
		if (offset === null) return;
		const pos = editor.offsetToPos(offset);
		editor.scrollIntoView({ from: pos, to: pos }, true);
		if (blockId) {
			window.setTimeout(() => {
				const el = view.containerEl.querySelector<HTMLElement>(`[data-ask="${blockId}"]`);
				el?.querySelector<HTMLElement>("textarea, [role=radio], [role=checkbox], button.icap-primary")?.focus();
				el?.dispatchEvent(new CustomEvent("icap-arrive")); // the view marks where to look
			}, 120);
		}
		if (g) g.focusToken++;
	}
}

/* ───────────────────────── pure helpers ───────────────────────── */

export function cmOf(editor: Editor): EditorView | null {
	return ((editor as unknown as { cm?: EditorView }).cm ?? null);
}

/** What makes a canvas's or a base's text unreadable for Obsidian, or null. */
function structureProblem(type: "canvas" | "base", text: string): string | null {
	if (type === "canvas") return canvasProblem(text);
	let data: unknown;
	try {
		data = parseYaml(text);
	} catch (e) {
		return `The base is not valid YAML: ${(e as Error).message}`;
	}
	return baseProblem(data);
}

function basename(path: string) {
	return path.split("/").pop()!.replace(/\.md$/, "");
}

const short = (s: string) => shortTitle(s);

function firstSentence(s: string) {
	const t = s.replace(/\s+/g, " ").trim();
	const m = t.match(/^(.{1,120}?[.!?。！？])(\s|$)/);
	return (m ? m[1] : t.slice(0, 120)).trim();
}

function escapeMd(s: string) {
	return s.replace(/([*_`[\]])/g, "\\$1");
}

export function humanError(e: unknown): string {
	const msg = e instanceof Error ? e.message : String(e);
	if (e instanceof SetupNeeded) return msg;
	if (/api key|unauthor|401|403/i.test(msg)) return L("The model provider refused the request — check the credentials (Model providers, in the settings).", "模型服务商拒绝了请求——请检查凭证（设置中的“模型服务商”）。");
	if (/ETIMEDOUT|ECONNRESET|network|fetch failed/i.test(msg)) return L("Network problem reaching the model.", "连接模型时出现网络问题。");
	return msg.replace(/\s+/g, " ").slice(0, 220);
}

/** Set a task's own result (explanation, feedback, kept), keeping the files its agent touched. */
function setResult(task: Task, a: Artifact) {
	task.artifacts = [a, ...task.artifacts.filter((x) => FILE_KINDS.has(x.kind))];
}

/** Add a file to a task's result once; a file created and then deleted again leaves no trace. */
function addArtifact(task: Task, a: Artifact) {
	task.artifacts = withArtifact(task.artifacts, a);
	// The same file, as this run's own doing (a request block: its latest round).
	task.round = withArtifact(task.round, a);
}

function withArtifact(list: Artifact[], a: Artifact): Artifact[] {
	const has = (kind: Artifact["kind"]) => list.some((x) => x.kind === kind && x.path === a.path);
	if (a.kind === "deleted" && has("created")) return list.filter((x) => x.path !== a.path);
	if (has(a.kind) || (a.kind === "edited" && has("created"))) return list;
	return [...list.filter((x) => !(a.kind === "deleted" && x.kind === "edited" && x.path === a.path)), a];
}

/** What a note-making task is called as a task note: its subject, without the progressive verb of the ledger line. */
function noteTaskName(kind: NoteTaskKind, noteName: string, input: string): string {
	switch (kind) {
		case "concept":
			return L(`Concept note — ${short(input)}`, `概念笔记——${short(input)}`);
		case "collect":
			return L(`Key concepts — ${noteName}`, `关键概念——${noteName}`);
		case "compare":
			return L(`Comparison — ${short(input)}`, `对比——${short(input)}`);
		case "from-interaction":
			return L(`Note from an interaction — ${noteName}`, `交互整理成的笔记——${noteName}`);
	}
}
