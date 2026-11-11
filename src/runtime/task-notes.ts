import { Notice, TFile, normalizePath, type App } from "obsidian";
import { uniqueNotePath } from "../dsl/doc-ops";
import { cacheHit, roundCost, totalTokens } from "../agent/usage";
import { COST_UNKNOWN, TASK_MARK, activityBase, applyTaskProperties, linkTo, renderTaskNote, taskFileName, taskStatus, type TaskNote } from "../dsl/task-notes";
import { L } from "../i18n";
import type { AskBlock, Task } from "./state.svelte";

export const BASE_NAME = "Activity.base";
export const TASKS_DIR = "Tasks";
/** Tasks of this device that were live at the last write; a restart finds them here and records the interruption. */
const LIVE_KEY = "icap-live-tasks";

export interface TaskNotesHost {
	app: App;
	/** ICAP's visible folder (a setting): Activity.base in it, new task notes in its `Tasks/`. */
	home(): string;
	tasks(): Task[];
	block(id: string | null): AskBlock | undefined;
	/** The learner is typing in this note right now: its properties are written later. */
	beingEdited(path: string): boolean;
	/** Activity.base has been generated once for this vault; from then on it is the learner's. */
	baseMade(): boolean;
	setBaseMade(): void;
}

interface Adopted {
	noteId: string;
	request: string;
	origin: "request" | "note";
}

/** Resolves once the metadata cache has read every note (at once, if it already has). */
function indexed(app: App): Promise<void> {
	const cache = app.metadataCache as typeof app.metadataCache & { initialized?: boolean };
	if (cache.initialized !== false) return Promise.resolve();
	return new Promise((resolve) => {
		const ref = cache.on("resolved", () => {
			cache.offref(ref);
			resolve();
		});
	});
}

/** Bases is a core plugin the learner can turn off; without it the activity is the plugin's own list. */
export function basesEnabled(app: App): boolean {
	const internal = (app as unknown as { internalPlugins?: { getEnabledPluginById?: (id: string) => unknown } }).internalPlugins;
	return !!internal?.getEnabledPluginById?.("bases");
}

/**
 * Task notes (FORMAT.md, version 4): each note-making task of this device, and each request block that
 * amounts to a task (see `substantial`), is mirrored into a note with `icap-*` properties, which Activity.base lists. Written only on a real change
 * of state, and only by the device that runs the task, so two synced devices never write the same note.
 * A note is found by its `icap-id`, never by its path: the learner may rename or move it.
 */
export class TaskNotes {
	/** task id → its note, for the tasks this device runs (or ran and has not recorded the end of). */
	private adopted = new Map<string, Adopted>();
	/** icap-id → path, for notes this session has written (the metadata cache lags behind a new file). */
	private paths = new Map<string, string>();
	private queue: Promise<void>;
	private retry: number | null = null;

	constructor(private host: TaskNotesHost) {
		// Nothing is looked up by `icap-id` before Obsidian has indexed the vault's properties: a note that
		// exists but is not indexed yet would be written a second time.
		this.queue = indexed(host.app);
	}

	get home(): string {
		return normalizePath(this.host.home().trim() || "ICAP");
	}
	/** Where new task notes go. */
	get folder(): string {
		return normalizePath(`${this.home}/${TASKS_DIR}`);
	}
	get basePath(): string {
		return normalizePath(`${this.home}/${BASE_NAME}`);
	}

	/** This device runs `task`: from now on its state is recorded in the note with `noteId`. */
	adopt(task: Task, noteId: string, request: string, origin: Adopted["origin"]) {
		this.adopted.set(task.id, { noteId, request, origin });
	}

	has(task: Task): boolean {
		return task.kind === "request" || task.kind === "note";
	}

	/** A file the plugin itself writes here: never an agent's change. */
	owns(path: string): boolean {
		if (path === this.basePath) return true;
		for (const p of this.paths.values()) if (p === path) return true;
		const file = this.host.app.vault.getAbstractFileByPath(path);
		return file instanceof TFile && this.host.app.metadataCache.getFileCache(file)?.frontmatter?.icap === TASK_MARK;
	}

	/** Tasks that were live on this device when Obsidian closed: their notes still say `running`. */
	adoptInterrupted() {
		const live = this.host.app.loadLocalStorage(LIVE_KEY) as Record<string, Adopted> | null;
		if (!live || typeof live !== "object") return;
		for (const t of this.host.tasks()) {
			const a = live[t.id];
			if (a?.noteId) this.adopted.set(t.id, a);
		}
	}

	/**
	 * The activity of earlier versions lived only in plugin data. Its request and note tasks become task
	 * notes once, so nothing vanishes from the activity on upgrade. The same data gives the same file
	 * names on every device, and a note that already carries the id is left alone, so a second device (or
	 * a second run) adds nothing.
	 */
	async migrate(tasks: Task[]): Promise<number> {
		return this.restore(tasks);
	}

	/**
	 * Write the task notes that are missing for ended request and note tasks still in the ledger (plugin
	 * data keeps the latest 60). Used once on upgrade, and whenever the learner asks to rebuild: a note they
	 * deleted is never brought back unasked.
	 */
	async restore(tasks: Task[]): Promise<number> {
		await indexed(this.host.app);
		let made = 0;
		// Oldest first: names that collide get their suffix in the same order everywhere.
		for (const t of [...tasks].reverse()) {
			if ((t.kind !== "request" && t.kind !== "note") || t.active) continue;
			const noteId = t.kind === "request" && t.blockId ? t.blockId : t.id;
			if (this.find(noteId)) continue;
			// Named after the conversation's first request while its block is still there; else the ledger's line.
			const first = this.host.block(t.blockId)?.turns.find((x) => x.request && !x.control)?.answer?.text?.trim();
			if ((await this.write(t, { noteId, request: (t.kind === "request" && first) || t.title, origin: t.kind })) === "written") made++;
		}
		if (made) await this.ensureBase();
		return made;
	}

	/** Record what changed. Calls are serialized; a failed write is reported once and never blocks the task. */
	sync() {
		this.queue = this.queue
			.then(() => this.syncNow())
			.catch((e) => console.error("ICAP: could not write a task note", e));
		return this.queue;
	}

	private async syncNow() {
		if (!this.adopted.size) return;
		const byId = new Map(this.host.tasks().map((t) => [t.id, t]));
		let deferred = false;
		let wrote = false;
		for (const [taskId, a] of Array.from(this.adopted)) {
			const task = byId.get(taskId);
			// Gone from the ledger: replaced by the block's next round, or cleared. Its note stays as it is.
			if (!task) {
				this.adopted.delete(taskId);
				continue;
			}
			// Whether this write records the task's end is decided before it: the task may end while the file
			// is being written, and that end must still get its own write.
			const final = !task.active;
			const result = await this.write(task, a);
			if (result === "deferred") deferred = true;
			else {
				if (result === "written") wrote = true;
				if (final) this.adopted.delete(taskId);
			}
		}
		this.host.app.saveLocalStorage(LIVE_KEY, this.adopted.size ? Object.fromEntries(this.adopted) : null);
		if (wrote && !this.host.baseMade()) await this.ensureBase();
		if (deferred && this.retry === null) {
			this.retry = window.setTimeout(() => {
				this.retry = null;
				void this.sync();
			}, 3000);
		}
	}

	private model(task: Task, a: Adopted): TaskNote {
		const block = this.host.block(task.blockId);
		const changed: string[] = [];
		for (const art of task.artifacts) {
			if ((art.kind === "created" || art.kind === "edited") && !changed.includes(art.path)) changed.push(art.path);
		}
		return {
			id: a.noteId,
			status: taskStatus({ status: task.status, reviewing: block?.awaiting?.kind === "review" }),
			source: task.notePath || null,
			changed,
			started: task.createdAt,
			ended: task.active ? null : (task.endedAt ?? task.createdAt),
			cost: !task.usage ? null : task.usage.costKnown ? roundCost(task.usage.cost) : COST_UNKNOWN,
			tokens: task.usage ? totalTokens(task.usage) : null,
			cache: task.usage ? cacheHit(task.usage) : null,
		};
	}

	private async write(task: Task, a: Adopted): Promise<"written" | "same" | "deferred"> {
		const { app } = this.host;
		const note = this.model(task, a);
		const file = this.find(a.noteId);
		if (!file) {
			// A question asked in passing is not a task to keep track of: it gets a note once it amounts to one.
			if (!this.substantial(task, a)) return "same";
			const link = note.source ? linkTo(note.source) : "";
			const origin = !link
				? ""
				: a.origin === "request"
					? L(`Asked in ${link}; the conversation is in that note.`, `在 ${link} 里提出，对话留在那篇笔记里。`)
					: L(`Started from ${link}.`, `从 ${link} 发起。`);
			const path = await uniqueNotePath(app, this.folder, taskFileName(a.request));
			this.paths.set(a.noteId, path);
			await app.vault.create(path, renderTaskNote(note, a.request.replace(/^[“"]+|[”"]+$/g, "").trim() || task.title, origin));
			return "written";
		}
		const have: Record<string, unknown> = { ...app.metadataCache.getFileCache(file)?.frontmatter };
		if (!applyTaskProperties(have, note)) return "same";
		if (this.host.beingEdited(file.path)) return "deferred";
		await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => void applyTaskProperties(fm, note));
		return "written";
	}

	/**
	 * Worth a note of its own: a note-making task always; a request once its agent used a tool, touched a
	 * file, asked the learner something, or the conversation went past one round. A single question with a
	 * single answer stays in its block only (which still shows what it cost).
	 */
	private substantial(task: Task, a: Adopted): boolean {
		if (a.origin === "note") return true;
		if (task.steps?.length || task.status === "waiting") return true;
		if (task.artifacts.some((x) => x.kind === "created" || x.kind === "edited" || x.kind === "deleted")) return true;
		const rounds = this.host.block(task.blockId)?.turns.filter((t) => t.request && !t.control).length ?? 0;
		return rounds > 1;
	}

	/** The note that carries `icap-id: id`, wherever the learner has put it. */
	find(id: string): TFile | null {
		const { app } = this.host;
		const known = this.paths.get(id);
		if (known) {
			const f = app.vault.getAbstractFileByPath(known);
			if (f instanceof TFile) {
				const fm = app.metadataCache.getFileCache(f)?.frontmatter;
				// Not indexed yet (just created), or still ours.
				if (!fm || fm["icap-id"] === id) return f;
			}
			this.paths.delete(id);
		}
		let found: TFile | null = null;
		for (const f of app.vault.getMarkdownFiles()) {
			const fm = app.metadataCache.getFileCache(f)?.frontmatter;
			if (fm?.["icap-id"] === id && fm.icap === TASK_MARK && (!found || f.path < found.path)) found = f;
		}
		if (found) this.paths.set(id, found.path);
		return found;
	}

	/**
	 * Activity.base, generated once and then the learner's: an existing file is never rewritten.
	 * `force` recreates one the learner deleted (they asked to see the activity).
	 */
	async ensureBase(force = false): Promise<TFile | null> {
		const { app } = this.host;
		const existing = app.vault.getAbstractFileByPath(this.basePath);
		if (existing instanceof TFile) {
			this.host.setBaseMade();
			return existing;
		}
		if (this.host.baseMade() && !force) return null;
		if (!app.vault.getAbstractFileByPath(this.home)) await app.vault.createFolder(this.home).catch(() => undefined);
		const file = await app.vault.create(
			this.basePath,
			activityBase({
				status: L("Status", "状态"),
				source: L("Note", "笔记"),
				changed: L("Changed", "改动"),
				started: L("Started", "开始"),
				ended: L("Ended", "结束"),
				minutes: L("Minutes", "用时（分）"),
				cost: L("Cost ($)", "花费（$）"),
				tokens: L("Tokens", "Tokens"),
				cache: L("Cache hit (%)", "缓存命中（%）"),
				needsMe: L("Needs me", "需要我"),
				inProgress: L("In progress", "进行中"),
				all: L("All", "全部"),
			}),
		);
		this.host.setBaseMade();
		return file;
	}

	dispose() {
		if (this.retry !== null) window.clearTimeout(this.retry);
	}
}

/** Told once, after the upgrade that turned the earlier activity into notes. */
export function announceMigration(folder: string, count: number) {
	new Notice(
		L(
			`ICAP now keeps its activity as notes: ${count} earlier ${count === 1 ? "task was" : "tasks were"} written to “${folder}”, listed in ${BASE_NAME} next to it. Change the folder in the settings.`,
			`ICAP 的活动现在以笔记保存：之前的 ${count} 个任务已写入“${folder}”，并列在它旁边的 ${BASE_NAME} 里。文件夹可以在设置里更改。`,
		),
		15000,
	);
}
