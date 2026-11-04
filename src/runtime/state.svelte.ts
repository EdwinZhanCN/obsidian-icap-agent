import type { AgentPhase } from "../agent/pi-session";
import type { GlossMode } from "../agent/prompts";

/* ───────────────────────── Activity: tasks ───────────────────────── */

export type TaskStatus = "processing" | "waiting" | "completed" | "failed" | "cancelled";
export type TaskKind = "explain" | "recall" | "check" | "quiz" | "note" | "request";

export interface Artifact {
	kind: "gloss" | "created" | "edited" | "deleted" | "kept" | "feedback";
	path: string;
	label: string;
}

export interface TaskRecord {
	id: string;
	kind: TaskKind;
	title: string;
	notePath: string;
	status: TaskStatus;
	outcome: string;
	artifacts: Artifact[];
	error: string | null;
	createdAt: number;
	endedAt: number | null;
	blockId: string | null;
	glossId: string | null;
	interrupted?: boolean;
}

export class Task {
	id: string;
	kind: TaskKind;
	title: string;
	notePath: string;
	createdAt: number;
	blockId: string | null = null;
	glossId: string | null = null;
	status = $state<TaskStatus>("processing");
	phase = $state<AgentPhase>("starting");
	outcome = $state("");
	artifacts = $state<Artifact[]>([]);
	error = $state<string | null>(null);
	endedAt = $state<number | null>(null);
	/** Was live when Obsidian (or the plugin) closed. */
	interrupted = false;
	cancel: (() => void) | null = null;
	retry: (() => void) | null = null;
	/** Tool calls of this task's agent now running, and when the last one ended (file-change attribution). */
	toolsRunning = 0;
	toolEndedAt = 0;

	constructor(id: string, kind: TaskKind, title: string, notePath: string, createdAt = Date.now()) {
		this.id = id;
		this.kind = kind;
		this.title = title;
		this.notePath = notePath;
		this.createdAt = createdAt;
	}

	get active() {
		return this.status === "processing" || this.status === "waiting";
	}

	end(status: Exclude<TaskStatus, "processing" | "waiting">, outcome?: string, error?: string) {
		this.status = status;
		if (outcome !== undefined) this.outcome = outcome;
		if (error !== undefined) this.error = error;
		this.endedAt = Date.now();
		this.cancel = null;
	}

	toJSON(): TaskRecord {
		return {
			id: this.id,
			kind: this.kind,
			title: this.title,
			notePath: this.notePath,
			status: this.status,
			outcome: this.outcome,
			artifacts: $state.snapshot(this.artifacts),
			error: this.error,
			createdAt: this.createdAt,
			endedAt: this.endedAt,
			blockId: this.blockId,
			glossId: this.glossId,
			interrupted: this.interrupted || undefined,
		};
	}

	static from(r: TaskRecord): Task {
		const t = new Task(r.id, r.kind, r.title, r.notePath, r.createdAt);
		// A task that was live when Obsidian closed cannot still be running.
		const live = r.status === "processing" || r.status === "waiting";
		t.status = live ? "cancelled" : r.status;
		t.interrupted = live || !!r.interrupted;
		t.outcome = r.outcome === "Interrupted when Obsidian closed" ? "" : r.outcome;
		t.artifacts = r.artifacts ?? [];
		t.error = r.error;
		t.endedAt = r.endedAt ?? r.createdAt;
		t.blockId = r.blockId;
		t.glossId = r.glossId;
		return t;
	}
}

export class Ledger {
	tasks = $state<Task[]>([]);
	open = $state(false);

	get active() {
		return this.tasks.filter((t) => t.active);
	}
	get waiting() {
		return this.tasks.filter((t) => t.status === "waiting");
	}

	add(task: Task) {
		this.tasks = [task, ...this.tasks].slice(0, 80);
		return task;
	}

	get(id: string) {
		return this.tasks.find((t) => t.id === id);
	}

	remove(id: string) {
		this.tasks = this.tasks.filter((t) => t.id !== id);
	}

	clearFinished() {
		this.tasks = this.tasks.filter((t) => t.active);
	}
}

/* ───────────────────────── Explanation: glosses ───────────────────────── */

export interface GlossSection {
	id: string;
	mode: GlossMode;
	label: string;
	text: string;
	sources: string[];
	status: "streaming" | "done" | "failed" | "cancelled";
	error?: string;
	taskId: string | null;
}

export class Gloss {
	id: string;
	notePath: string;
	selection: string;
	/** Last known anchor/term offsets, used to re-attach the gloss when the note is reopened. */
	anchor: number;
	termFrom: number;
	termTo: number;
	sections = $state<GlossSection[]>([]);
	state = $state<"open" | "kept" | "dismissed">("open");
	collapsed = $state(false);
	/** Focus request token: the widget focuses itself when this changes. */
	focusToken = $state(0);

	constructor(id: string, notePath: string, selection: string, anchor: number, termFrom: number, termTo: number) {
		this.id = id;
		this.notePath = notePath;
		this.selection = selection;
		this.anchor = anchor;
		this.termFrom = termFrom;
		this.termTo = termTo;
	}

	get term() {
		// The label is plain text: drop Markdown syntax the selection may carry (`code`, **bold**, [[link|alias]]).
		const s = this.selection
			.replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2")
			.replace(/[`*_~=]+/g, "")
			.replace(/\s+/g, " ")
			.trim();
		return s.length > 48 ? s.slice(0, 46) + "…" : s;
	}

	get busy() {
		return this.sections.some((s) => s.status === "streaming");
	}

	get fullText() {
		return this.sections
			.filter((s) => s.status === "done" && s.text.trim())
			.map((s, i) => (i === 0 ? s.text.trim() : `**${s.label}.** ${s.text.trim()}`))
			.join("\n\n");
	}

	get sources() {
		return Array.from(new Set(this.sections.flatMap((s) => s.sources)));
	}
}

/* ───────────────────────── Interactive Blocks ───────────────────────── */

export type TurnKind = "single" | "multi" | "text" | "confirm" | "review";

export interface Answer {
	choices?: string[];
	text?: string;
	confirmed?: boolean;
}

export interface Turn {
	id: string;
	kind: TurnKind;
	question: string;
	options?: { id: string; label: string }[];
	placeholder?: string;
	revise?: boolean;
	confirmLabel?: string;
	cancelLabel?: string;
	review?: { path: string; find: string; replace: string; summary: string };
	/** Plugin-authored turn (e.g. the opening recall prompt); not from the agent. */
	local?: boolean;
	/** For "check": the learner's text lives in the note above the block. */
	inNote?: boolean;
	/** The learner's final write-up, which is what gets kept in the note. */
	final?: boolean;
	/** Request block: one of the learner's own requests (the answer holds their words). */
	request?: boolean;
	/** Request block: the agent's reply to this request, once a later request follows it. */
	reply?: string;
	/** A dialog from one of the learner's own Pi extensions, not an ask_learner question. */
	dialog?: boolean;
	answer?: Answer;
	feedback?: string;
	verdict?: "holds" | "partly" | "reconsider";
	draft?: string;
	draftChoices?: string[];
}

export type BlockKind = "recall" | "check" | "quiz" | "agent" | "request";
export type BlockPhase = "idle" | "preparing" | "thinking" | "waiting" | "completed" | "finalizing" | "failed" | "cancelled" | "interrupted";

export interface BlockRecord {
	id: string;
	kind: BlockKind;
	topic: string;
	notePath: string;
	taskId: string | null;
	instructions: string;
	turns: Turn[];
	phase: BlockPhase;
	summary: string;
	error: string | null;
	settled: "open" | "kept" | "cleared";
	createdAt: number;
	authored?: boolean;
	/** Request block: the text that was selected when it was opened. */
	quote?: string;
}

export class AskBlock {
	id: string;
	kind: BlockKind;
	topic: string;
	notePath: string;
	createdAt: number;
	taskId: string | null = null;
	/** The task prompt, kept so an interrupted interaction can be resumed. */
	instructions = "";
	turns = $state<Turn[]>([]);
	phase = $state<BlockPhase>("idle");
	agentPhase = $state<AgentPhase | null>(null);
	summary = $state("");
	error = $state<string | null>(null);
	veiled = $state(false);
	settled = $state<"open" | "kept" | "cleared">("open");
	/** Written by a person into the note (not inserted by the runtime): clearing resets it instead of removing it. */
	authored = false;
	/** Request block: the text that was selected when it was opened. */
	quote = "";
	/** Resolves the agent's pending ask_learner call; not persisted. */
	resolver: ((answer: Record<string, unknown>) => void) | null = null;
	/** Resolves a pending dialog from one of the learner's extensions; not persisted. */
	dialogResolver: ((answer: Answer | undefined) => void) | null = null;

	constructor(id: string, kind: BlockKind, topic: string, notePath: string, createdAt = Date.now()) {
		this.id = id;
		this.kind = kind;
		this.topic = topic;
		this.notePath = notePath;
		this.createdAt = createdAt;
	}

	get current(): Turn | undefined {
		return this.turns[this.turns.length - 1];
	}

	get awaiting(): Turn | undefined {
		const t = this.current;
		return t && !t.answer && (this.phase === "waiting" || this.phase === "idle" || this.phase === "interrupted" || this.phase === "finalizing") ? t : undefined;
	}

	toJSON(): BlockRecord {
		return {
			id: this.id,
			kind: this.kind,
			topic: this.topic,
			notePath: this.notePath,
			taskId: this.taskId,
			instructions: this.instructions,
			turns: $state.snapshot(this.turns) as Turn[],
			phase: this.phase,
			summary: this.summary,
			error: this.error,
			settled: this.settled,
			createdAt: this.createdAt,
			...(this.authored ? { authored: true } : {}),
			...(this.quote ? { quote: this.quote } : {}),
		};
	}

	static from(r: BlockRecord): AskBlock {
		const b = new AskBlock(r.id, r.kind, r.topic, r.notePath, r.createdAt);
		b.taskId = r.taskId;
		b.instructions = r.instructions ?? "";
		b.authored = !!r.authored;
		b.quote = r.quote ?? "";
		// A dialog from an extension belongs to the Pi process that asked; it is gone after a restart.
		b.turns = (r.turns ?? []).filter((t) => !(t.dialog && !t.answer));
		const live = r.phase === "preparing" || r.phase === "thinking" || r.phase === "waiting";
		b.phase = live ? (r.instructions ? "interrupted" : r.phase === "waiting" ? "idle" : "interrupted") : r.phase;
		b.summary = r.summary ?? "";
		b.error = r.error;
		b.settled = r.settled ?? "open";
		return b;
	}
}
