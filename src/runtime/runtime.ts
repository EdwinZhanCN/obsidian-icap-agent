import { FileSystemAdapter, MarkdownView, Notice, TFile, type App, type Editor, type TAbstractFile } from "obsidian";
import { EditorView } from "@codemirror/view";
import { mount, unmount } from "svelte";
import { SvelteMap } from "svelte/reactivity";
import type IcapPlugin from "../main";
import { PiSession, probeCommands, probeModels, type AgentPhase, type Control, type DialogAnswer, type DialogRequest } from "../agent/pi-session";
import { ensureDir, removeSessions, reusable, sessionExists, sessionId, sessionSig } from "../agent/session-cache";
import { ensureSkills } from "../agent/icap-skills";
import { extractLinks } from "../dsl/links";
import { THINKING_LEVELS, isIcapCommand, parseCommand, type CommandProvider, type IcapCommandName, type SlashCommand } from "../dsl/commands";
import { L } from "../i18n";
import { GENERATED_BY } from "../settings";
import { glossLabelUI } from "../ui/phrases";
import { vaultCommand } from "../agent/vault-tools";
import { DocStore, CACHE_DIR, formatOf, type Loaded } from "../docs/store";
import { documentsCommand, readDocument } from "../docs/tools";
import { applySummaries, documentPrompt, parseSummaries, summaryBatches } from "../docs/summaries";
import { homedir } from "os";
import { join } from "path";
import {
	blockContext,
	commandContext,
	continuationPrompt,
	explainPrompt,
	followUpPrompt,
	notePrompt,
	quizPrompt,
	recallPrompt,
	requestPrompt,
	systemPrompt,
	type GlossMode,
	type NoteTaskKind,
} from "../agent/prompts";
import { buildContext } from "../context";
import { answerText, coveredTranscript, transcriptOf, withReply } from "./transcript";
import { calloutBlock, editProblem, evidenceCallout, findAskBlock, isoDate, parseAskSource, parseAuthored, requestRecord, type AskSource, glossCallout, newId, serializeAsk, splitSources, tidyOptionLabel, tidyQuestion, verdictGlyph, dialogTitle, type Depth } from "../dsl/blocks";
import { askReplacement, blockInsertion, editorFor, spliceFile, uniqueNotePath, type Splice } from "../dsl/doc-ops";
import { flashRange } from "../editor/fresh";
import { clearCues, cue, withdrawCue } from "../editor/cue";
import { glossAnchor, paragraphBounds, sectionBounds, stripFrontmatter } from "../dsl/text";
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

const READ_TOOLS = ["read", "grep", "find", "ls", "obsidian", "read_document", "documents"];
const ASK_TOOLS = [...READ_TOOLS, "ask_learner"];
const NOTE_TOOLS = [...READ_TOOLS, "ask_learner", "create_note", "propose_edit"];
const REQUEST_TOOLS = NOTE_TOOLS;
/** A file change this soon after one of a task's tool calls ended is still that call's (watchers lag). */
const TOOL_GRACE_MS = 3000;
/** Artifacts that describe files the agent touched, kept whatever the task's own result is. */
const FILE_KINDS = new Set<Artifact["kind"]>(["created", "edited", "deleted"]);

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
	session?: { id: string; dir: string };
	/** A runtime control (compact) instead of a prompt. */
	control?: Control;
}

/** The command catalog is asked of Pi at most this often (new skills show up without a restart). */
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
	/** The document cache (icap/docs/) behind read_document and documents. */
	docs: DocStore;
	/** Documents whose summaries are being written (by content hash). */
	private summarizing = new Set<string>();
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
		this.docs = new DocStore(plugin.app);
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
		if (this.saveTimer) window.clearTimeout(this.saveTimer);
		this.saveTimer = window.setTimeout(() => {
			this.saveTimer = null;
			void this.plugin.saveState();
		}, 400);
	}

	dispose() {
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

	/** The vault plus the folders the learner allowed outside it (enforced in isolated mode). */
	private allowedRoots(): string[] {
		const home = homedir();
		const extra = this.settings.externalFolders.map((f) => (f === "~" ? home : f.startsWith("~/") ? home + f.slice(1) : f));
		return [this.vaultRoot(), ...extra];
	}

	private vaultRoot(): string {
		const a = this.app.vault.adapter;
		if (a instanceof FileSystemAdapter) return a.getBasePath();
		throw new Error(L("This plugin needs the desktop app (a vault on disk).", "此插件需要桌面版（Vault 在本地磁盘上）。"));
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
			const pi = await this.plugin.pi();
			if (cancelledEarly) throw new Cancelled();
			const config = this.settings.agentConfig;
			const roots = this.allowedRoots();
			const visuals = this.settings.visuals;
			const session = new PiSession({
				pi,
				cwd: this.vaultRoot(),
				config,
				allowedRoots: roots,
				skillPaths: visuals !== "off" ? this.icapSkills() : [],
				systemPrompt: systemPrompt(config, this.settings.preferences, visuals) + (opts.systemExtra ? `\n\n${opts.systemExtra}` : ""),
				prompt: opts.prompt,
				tools: opts.tools,
				model: opts.model || this.settings.model,
				thinking: opts.thinking || this.settings.thinking,
				session: opts.session,
				control: opts.control,
				onText: opts.onText,
				onStep: (tool, detail) => {
					task.addStep(tool, detail);
					this.persist();
				},
				onTool: (running) => {
					task.toolsRunning = Math.max(0, task.toolsRunning + (running ? 1 : -1));
					if (!running) task.toolEndedAt = Date.now();
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
					if (op === "read_document" || op === "documents") return this.documentTool(op, p, config === "isolated" ? roots : null, roots.slice(1));
					return opts.onBridge ? opts.onBridge(op, p) : { status: "error", message: "Not available for this task." };
				},
				// A dialog from one of the learner's own extensions is asked in the task's block.
				onDialog: (req, signal) => this.dialog(task, req, signal),
			});
			task.cancel = () => session.cancel();
			const result = await session.run();
			if (result.aborted) throw new Cancelled();
			return result.text;
		} finally {
			release();
		}
	}

	private finishWithError(task: Task, err: unknown, outcomeOnFail: string): "cancelled" | "failed" {
		if (err instanceof Cancelled) {
			// Keep the task's own title ("Explaining “heap”"); the ledger's status word says "stopped".
			task.end("cancelled");
			return "cancelled";
		}
		const msg = humanError(err);
		task.end("failed", outcomeOnFail, msg);
		return "failed";
	}

	cancelTask(task: Task) {
		task.cancel?.();
	}

	/* ───────────── The `/` catalog: Pi's commands + ICAP's runtime commands ───────────── */

	private commandCache: { key: string; at: number; list: Promise<SlashCommand[]> } | null = null;
	private modelCache: { key: string; at: number; list: Promise<string[]> } | null = null;

	/** Settings changed (agent setup): ask Pi again next time. */
	invalidateCatalog() {
		this.commandCache = null;
		this.modelCache = null;
	}

	private catalogKey() {
		return this.settings.agentConfig;
	}

	private icapCommands(): SlashCommand[] {
		return [
			{ name: "model", source: "icap", description: L("Model for this block only (/model default goes back)", "仅用于这个块的模型（/model default 恢复默认）") },
			{ name: "thinking", source: "icap", description: L("Thinking level for this block only", "仅用于这个块的思考强度") },
			{ name: "compact", source: "icap", description: L("Summarize the earlier rounds for the agent; the note stays as it is", "为 Agent 压缩前面的轮次；笔记保持不变") },
		];
	}

	/** Every command a request block offers. The learner's own come from their Pi (cached). */
	async slashCommands(): Promise<SlashCommand[]> {
		const own = this.icapCommands();
		// "ICAP only" runs Pi without extensions, skills and prompt templates: there is nothing to ask.
		if (this.settings.agentConfig === "isolated") return own;
		const key = this.catalogKey();
		const c = this.commandCache;
		if (!c || c.key !== key || Date.now() - c.at > CATALOG_TTL_MS) {
			const list = (async () => {
				const found = await probeCommands(await this.plugin.pi(), this.vaultRoot());
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
		const key = this.catalogKey();
		const c = this.modelCache;
		if (!c || c.key !== key || Date.now() - c.at > CATALOG_TTL_MS) {
			const list = (async () => {
				return (await probeModels(await this.plugin.pi(), this.vaultRoot(), this.settings.agentConfig)).available;
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
		const settings = this.settings;
		return {
			list: () => this.slashCommands(),
			args: (name) =>
				name === "model" ? this.modelChoices().then((m) => ["default", ...m]) : name === "thinking" ? Promise.resolve(["default", ...THINKING_LEVELS]) : null,
			// Read when shown, so a change of agent setup is reflected without re-rendering the block.
			get note() {
				return settings.agentConfig === "isolated"
					? L("Your own Pi skills and commands are off in “ICAP only” mode (settings → Agent setup).", "“仅 ICAP”模式下不加载你自己的 Pi skills 和命令（设置 → Agent 配置）。")
					: undefined;
			},
		};
	}

	/* ───────────── Request blocks' Pi sessions (a cache of the conversation, agent/session-cache.ts) ───────────── */

	/** Where request blocks' Pi sessions live: next to the plugin, out of the vault's notes. */
	private sessionDir(): string | null {
		const dir = this.plugin.pluginPath();
		if (!dir) return null;
		try {
			return ensureDir(join(dir, "sessions"));
		} catch {
			return null;
		}
	}

	/** ICAP's own skills, written into the plugin folder (inside the vault, readable in isolated mode). */
	private icapSkills(): string[] {
		const dir = this.plugin.pluginPath();
		if (!dir) return [];
		try {
			return ensureSkills(dir);
		} catch {
			return [];
		}
	}

	/** What a session was made under; a session made under another setup is not resumed. */
	private sessionSetup(): string {
		return `${this.settings.agentConfig}|${this.vaultRoot()}`;
	}

	private dropSessions(blockId: string) {
		const dir = this.sessionDir();
		if (dir) removeSessions(dir, { block: blockId });
	}

	/** Remove the sessions of blocks that are no longer open (kept, cleared, or gone with their note). */
	pruneSessions() {
		const dir = this.sessionDir();
		if (dir) removeSessions(dir, { keep: new Set(this.blocks.keys()) });
	}

	/* ───────────── Documents: preparing ahead, summaries ───────────── */

	/**
	 * Prepare every document in the vault (when the setting is on), one at a time so Obsidian stays
	 * responsive, then drop cache entries nothing points to. Summaries follow when they are on.
	 */
	/**
	 * The agent's document tools: `read_document` (structure, a node, pages) and `documents` (list,
	 * search). `allowed` limits reading to those roots (isolated mode); `extra` are folders outside the
	 * vault whose documents are listed.
	 */
	async documentTool(op: "read_document" | "documents", p: Record<string, unknown>, allowed: string[] | null = null, extra: string[] = []) {
		if (op === "documents") return documentsCommand(this.app, this.docs, p, extra);
		const r = await readDocument(this.app, this.docs, p, allowed);
		if (typeof r.path === "string") void this.summarizeLater(r.path);
		return r;
	}

	prepareDocuments() {
		if (!this.settings.prepareDocuments && !this.settings.documentSummaries) return;
		const all = this.app.vault
			.getFiles()
			.filter((f) => formatOf(f.path) && !f.path.startsWith(CACHE_DIR + "/"))
			.map((f) => f.path);
		for (const p of all) if (!this.prepQueue.includes(p)) this.prepQueue.push(p);
		void this.drainPrep(true);
	}

	/** A document was added or changed in the vault: prepare it (when the setting is on). */
	onDocumentChange(file: TAbstractFile) {
		if (!this.settings.prepareDocuments || !(file instanceof TFile) || !formatOf(file.path) || file.path.startsWith(CACHE_DIR + "/")) return;
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
			tree.summarized_by = this.settings.model || "Pi default";
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
			section.status = r;
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
		if (this.ledger.get(block.taskId ?? "")?.active) new Notice(L("The agent is still working on this request.", "Agent 还在处理这个请求。"));
		else void this.followUp(block, text);
		return true;
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
	 * fresh session starts from a replay of the turns (see agent/session-cache.ts).
	 *
	 * A request starting with "/" is a command. ICAP's own (/model, /thinking, /compact) are handled
	 * here; any other is sent to Pi verbatim — Pi expands prompt templates and skills, and runs
	 * extension commands, only when the message starts with the command — with the note context in
	 * the system prompt instead of around the message.
	 */
	private async startRequest(block: AskBlock) {
		const file = this.fileOf(block.notePath);
		if (!file) return;
		const i = block.turns.map((t) => !!t.request).lastIndexOf(true);
		const turn = block.turns[i];
		const request = turn?.answer?.text?.trim();
		if (!turn || !request) return;
		const cmd = parseCommand(request);
		if (cmd && isIcapCommand(cmd.name)) return this.runControl(block, turn, cmd.name, cmd.args);
		if (!block.topic) block.topic = short(request);
		// An unanswered question from an interrupted run is asked again by the agent.
		if (block.current && !block.current.answer && !block.current.local) block.turns.pop();
		const text = await this.textOf(block.notePath);
		const pos = findAskBlock(text, block.id)?.from ?? 0;
		const ctx = buildContext(this.app, file, text, pos, pos, this.settings.background);
		const history = transcriptOf(block, block.turns.slice(0, i));
		const sofar = transcriptOf(block, block.turns.slice(i + 1));
		// [[links]] in the request: the files the learner pointed to, resolved like Obsidian does.
		const pointed = extractLinks(request).map((link) => ({ link, path: this.app.metadataCache.getFirstLinkpathDest(link, block.notePath)?.path ?? null }));

		// The session: resumed only if it covers exactly the history; an interrupted round never is.
		const dir = this.settings.rememberContext ? this.sessionDir() : null;
		const setup = this.sessionSetup();
		const resumed = !!dir && !sofar.trim() && reusable(block.session, setup, history) && sessionExists(dir, block.session.id) ? block.session : null;
		let session: { id: string; dir: string } | undefined;
		if (dir) {
			if (resumed) session = { id: resumed.id, dir };
			else {
				removeSessions(dir, { block: block.id });
				block.sessionSeq++;
				session = { id: sessionId(block.id, block.sessionSeq), dir };
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
			prompt = requestPrompt(ctx, block.quote, history, request, pointed) + interrupted;
		}
		// One request block = one ledger line, which keeps the files (and steps) of every round.
		const prev = block.taskId ? this.ledger.get(block.taskId) : undefined;
		if (prev && !prev.active) this.ledger.remove(prev.id);
		const task = this.ledger.add(new Task(newId("t"), "request", `“${short(request)}”`, block.notePath));
		task.artifacts = prev ? [...prev.artifacts] : [];
		task.steps = prev ? [...prev.steps] : [];
		task.stepsDropped = prev?.stepsDropped ?? 0;
		// The session is resumable only if its own messages hold the whole conversation. A command in a
		// fresh session got the earlier turns through the system prompt, which Pi does not store.
		const selfContained = !cmd || !!resumed || (!history.trim() && !sofar.trim());
		await this.runBlockTask(block, task, prompt, REQUEST_TOOLS, L(`Done — “${short(request)}”`, `完成——“${short(request)}”`), {
			extras: { session, systemExtra, model: block.model, thinking: block.thinking },
			onSuccess: () => {
				if (session && selfContained) block.session = { id: session.id, sig: sessionSig(setup, coveredTranscript(block)) };
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
					const shown = block.model || this.settings.model || L("Pi's default", "Pi 默认");
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
				const dir = this.sessionDir();
				const s = block.session;
				if (!dir || !s || !sessionExists(dir, s.id))
					return done(L("Nothing to compact: this block's conversation is read from the note itself each time.", "没有可压缩的内容：这个块的对话每次都直接从笔记中读取。"));
				const prev = block.taskId ? this.ledger.get(block.taskId) : undefined;
				if (prev && !prev.active) this.ledger.remove(prev.id);
				const task = this.ledger.add(new Task(newId("t"), "request", L(`Compacting “${block.topic}”`, `正在压缩“${block.topic}”`), block.notePath));
				task.artifacts = prev ? [...prev.artifacts] : [];
				task.steps = prev ? [...prev.steps] : [];
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
						session: { id: s.id, dir },
						model: block.model,
						thinking: block.thinking,
						onPhase: (p) => (block.agentPhase = p),
					});
					block.session = s;
					block.agentPhase = null;
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
		if (this.settings.agentConfig !== "mine" || !(file instanceof TFile)) return;
		// The document cache is the plugin's own (written while read_document runs), never the agent's.
		if (file.path.startsWith(CACHE_DIR + "/")) return;
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

	/* ───────────── Dialogs from the learner's own Pi extensions ───────────── */

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
			question: question || L("One of your Pi extensions asks for input.", "你的一个 Pi 扩展需要你输入。"),
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
		run: { extras?: RunExtras; onSuccess?: () => void } = {},
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
			run.onSuccess?.();
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
			block.error = r === "failed" ? task.error : null;
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
			if (ok && task) task.artifacts = [...task.artifacts, { kind: "edited", path: turn.review.path, label: basename(turn.review.path) }];
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

	async keepBlock(block: AskBlock) {
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
		n.noticeEl.addEventListener("click", () => void this.reveal(task));
	}

	private async createNote(task: Task, p: Json): Promise<Json> {
		const title = String(p.title ?? "").trim();
		const content = String(p.content ?? "");
		if (!title || !content.trim()) return { status: "error", message: "title and content are required" };
		const here = this.fileOf(task.notePath);
		const folder = String(p.folder ?? "").trim() || this.settings.notesFolder || here?.parent?.path || "";
		const path = await uniqueNotePath(this.app, folder === "/" ? "" : folder, title);
		const created = await this.app.vault.create(path, content.trimEnd() + "\n");
		// Tool-level metadata only: later explanations must not take this note for the learner's own words.
		if (this.settings.markGenerated) await this.app.fileManager.processFrontMatter(created, (fm) => void (fm["generated-by"] = GENERATED_BY)).catch(() => undefined);
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

	private applyReview(r: NonNullable<Turn["review"]>): Promise<boolean> {
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
		const s = applied as Splice | null;
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
		const folder = this.settings.notesFolder || file.parent?.path || "";
		const prompt = notePrompt(ctx, kind, input, folder);
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
				n.noticeEl.addEventListener("click", () => (this.ledger.open = true));
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

	async reveal(task: Task) {
		const path = task.artifacts.find((a) => a.kind === "created")?.path ?? task.notePath;
		await this.openAt(path, task.blockId, task.glossId);
	}

	async openPath(path: string) {
		await this.openAt(path, null, null);
	}

	private async openAt(path: string, blockId: string | null, glossId: string | null) {
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
		let offset: number | null = null;
		if (blockId && this.blocks.has(blockId)) offset = findAskBlock(text, blockId)?.from ?? null;
		const g = glossId ? this.glosses.get(glossId) : undefined;
		if (g) offset = g.anchor;
		if (offset === null) return;
		const pos = editor.offsetToPos(offset);
		editor.scrollIntoView({ from: pos, to: pos }, true);
		if (blockId) {
			window.setTimeout(() => {
				const el = view!.containerEl.querySelector<HTMLElement>(`[data-ask="${blockId}"]`);
				el?.querySelector<HTMLElement>("textarea, [role=radio], [role=checkbox], button.icap-primary")?.focus();
				el?.dispatchEvent(new CustomEvent("icap-arrive")); // the view marks where to look
			}, 120);
		}
		if (g) g.focusToken++;
	}
}

/* ───────────────────────── pure helpers ───────────────────────── */

export function cmOf(editor: Editor): EditorView | null {
	return ((editor as unknown as { cm?: EditorView }).cm ?? null) as EditorView | null;
}

function basename(path: string) {
	return path.split("/").pop()!.replace(/\.md$/, "");
}

function short(s: string) {
	const t = s.replace(/\s+/g, " ").trim();
	return t.length > 40 ? t.slice(0, 38) + "…" : t;
}

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
	if (/ENOENT|not found/i.test(msg) && /pi\b/i.test(msg)) return L("Pi was not found — check the path in settings.", "找不到 Pi——请检查设置中的路径。");
	if (/api key|unauthor|401|403/i.test(msg)) return L("The model provider refused the request — check Pi's credentials.", "模型服务商拒绝了请求——请检查 Pi 的凭证。");
	if (/ETIMEDOUT|ECONNRESET|network|fetch failed/i.test(msg)) return L("Network problem reaching the model.", "连接模型时出现网络问题。");
	return msg.replace(/\s+/g, " ").slice(0, 220);
}

/** Set a task's own result (explanation, feedback, kept), keeping the files its agent touched. */
function setResult(task: Task, a: Artifact) {
	task.artifacts = [a, ...task.artifacts.filter((x) => FILE_KINDS.has(x.kind))];
}

/** Add a file to a task's result once; a file created and then deleted again leaves no trace. */
function addArtifact(task: Task, a: Artifact) {
	const has = (kind: Artifact["kind"]) => task.artifacts.some((x) => x.kind === kind && x.path === a.path);
	if (a.kind === "deleted" && has("created")) {
		task.artifacts = task.artifacts.filter((x) => x.path !== a.path);
		return;
	}
	if (has(a.kind) || (a.kind === "edited" && has("created"))) return;
	task.artifacts = [...task.artifacts.filter((x) => !(a.kind === "deleted" && x.kind === "edited" && x.path === a.path)), a];
}

/** A request block as it stays in the note: each request with its reply, and the files touched. */
function requestMarkdown(block: AskBlock, artifacts: Artifact[]): string {
	const rounds: { request: string; reply: string }[] = [];
	for (const t of block.turns) {
		if (t.control) continue;
		if (t.request) rounds.push({ request: t.answer?.text ?? "", reply: "" });
		if (t.reply && rounds.length) rounds[rounds.length - 1].reply = t.reply;
	}
	if (rounds.length && block.summary.trim()) rounds[rounds.length - 1].reply = block.summary.trim();
	return requestRecord(block.topic, rounds, artifacts);
}

/**
 * What a settled block leaves in the note (FORMAT.md). Recalls, checks and quizzes carry their
 * evidence — the kept date and the verdict — in the callout title and in a comment above it, so
 * the note itself is the learning record. `date` is the day of keeping; the turns have no clock.
 */
export function keptMarkdown(block: AskBlock, artifacts: Artifact[] = [], date = isoDate()): string {
	if (block.kind === "request") return requestMarkdown(block, artifacts);
	const summary = block.summary.trim();
	const verdict = [...block.turns].reverse().find((t) => t.verdict)?.verdict;
	const title = (k: string) => `${k} — ${block.topic}`;
	if (block.kind === "recall") {
		const finalWords =
			block.turns.find((t) => t.final && t.answer?.text)?.answer?.text?.trim() ??
			[...block.turns].reverse().find((t) => (t.revise || block.turns.indexOf(t) === 0) && t.answer?.text)?.answer?.text?.trim() ??
			"";
		const parts = [finalWords];
		const fb = summary || block.turns.map((t) => t.feedback).filter(Boolean).join("\n\n");
		if (fb) parts.push(evidenceCallout("feedback", block.topic, { kind: "recall", id: block.id, date, verdict, topic: block.topic, paragraphs: finalWords ? finalWords.split(/\n[ \t]*\n/).filter((p) => p.trim()).length : undefined }, fb));
		return parts.filter(Boolean).join("\n\n");
	}
	if (block.kind === "check") {
		const fb = summary || block.turns.map((t) => t.feedback).filter(Boolean).join("\n\n");
		return evidenceCallout("feedback", block.topic, { kind: "check", id: block.id, date, verdict, topic: block.topic }, fb || L("Checked.", "已检查。"));
	}
	if (block.kind === "quiz") {
		const lines: string[] = [];
		const counts = { holds: 0, partly: 0, reconsider: 0 };
		block.turns.forEach((t, i) => {
			if (!t.answer) return;
			if (t.verdict) counts[t.verdict]++;
			lines.push(`**${i + 1}.** ${t.question.trim()}`);
			lines.push(`*${L("My answer", "我的回答")}:* ${answerText(t)}${t.verdict ? ` ${verdictGlyph(t.verdict)}` : ""}`);
			lines.push("");
		});
		if (summary) lines.push(summary);
		return evidenceCallout("practice", title(L("Understanding check", "理解检验")), { kind: "quiz", id: block.id, date, counts, topic: block.topic }, lines.join("\n").trim());
	}
	return summary ? calloutBlock("note", block.topic, summary) : "";
}
