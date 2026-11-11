import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("obsidian", () => {
	class TFile {
		constructor(public path: string) {}
	}
	return { TFile, MarkdownView: class {}, Notice: class {}, normalizePath: (p: string) => p.replace(/\/+/g, "/").replace(/^\/|\/$/g, "") };
});

import { TFile, type App } from "obsidian";
import { readRecords } from "../dsl/records";
import type { AskBlock, Task } from "./state.svelte";
import { BASE_NAME, TaskNotes, type TaskNotesHost } from "./task-notes";

/** The frontmatter of the notes this module writes: scalars and block lists. */
function frontmatter(text: string): Record<string, unknown> | undefined {
	if (!text.startsWith("---\n")) return undefined;
	const out: Record<string, unknown> = {};
	let list: string[] | null = null;
	for (const line of text.slice(4, text.indexOf("\n---", 4)).split("\n")) {
		const item = /^\s+-\s+(.*)$/.exec(line);
		if (item && list) {
			list.push(JSON.parse(item[1]) as string);
			continue;
		}
		const kv = /^([\w-]+):\s*(.*)$/.exec(line);
		if (!kv) continue;
		if (kv[2]) out[kv[1]] = kv[2].startsWith('"') ? JSON.parse(kv[2]) : kv[2];
		else out[kv[1]] = list = [];
	}
	return out;
}

function render(fm: Record<string, unknown>, body: string): string {
	const lines = ["---"];
	for (const [k, v] of Object.entries(fm)) {
		if (Array.isArray(v)) lines.push(`${k}:`, ...v.map((x) => `  - ${JSON.stringify(x)}`));
		else lines.push(`${k}: ${String(v)}`);
	}
	return [...lines, "---", body].join("\n");
}

/** A vault in memory, with the parts of the App the module touches. */
function vault(initial: Record<string, string> = {}) {
	const files = new Map(Object.entries(initial));
	const handles = new Map<string, TFile>();
	const folders = new Set<string>();
	const local = new Map<string, unknown>();
	let writes = 0;
	const handle = (path: string) => {
		if (!files.has(path)) return folders.has(path) ? { path } : null;
		if (!handles.has(path)) handles.set(path, new (TFile as unknown as new (p: string) => TFile)(path));
		return handles.get(path)!;
	};
	const app = {
		vault: {
			getAbstractFileByPath: handle,
			getMarkdownFiles: () => [...files.keys()].filter((p) => p.endsWith(".md")).map((p) => handle(p) as TFile),
			createFolder: async (p: string) => void folders.add(p),
			create: async (p: string, text: string) => {
				if (files.has(p)) throw new Error("exists");
				files.set(p, text);
				writes++;
				return handle(p);
			},
		},
		metadataCache: { getFileCache: (f: TFile) => ({ frontmatter: frontmatter(files.get(f.path) ?? "") }) },
		fileManager: {
			processFrontMatter: async (f: TFile, fn: (fm: Record<string, unknown>) => void) => {
				const text = files.get(f.path)!;
				const fm = frontmatter(text) ?? {};
				fn(fm);
				files.set(f.path, render(fm, text.slice(text.indexOf("\n---", 4) + 5)));
				writes++;
			},
		},
		loadLocalStorage: (k: string) => local.get(k) ?? null,
		saveLocalStorage: (k: string, v: unknown) => void (v === null ? local.delete(k) : local.set(k, v)),
	};
	return {
		app: app as unknown as App,
		files,
		local,
		rename(from: string, to: string) {
			files.set(to, files.get(from)!);
			files.delete(from);
			handles.delete(from);
		},
		get writes() {
			return writes;
		},
	};
}

function task(over: Partial<Task>): Task {
	const t = { id: "t1", kind: "request", title: "“What is RAII?”", notePath: "C++.md", status: "processing", createdAt: Date.UTC(2026, 10, 10, 14, 2), endedAt: null, blockId: "b1", artifacts: [], steps: [{ tool: "read", detail: "C++.md" }], ...over } as unknown as Task;
	Object.defineProperty(t, "active", { get: () => t.status === "processing" || t.status === "waiting" });
	return t;
}

function setup(v: ReturnType<typeof vault>, tasks: Task[], opts: { editing?: () => boolean; blocks?: Record<string, AskBlock> } = {}) {
	let baseMade = false;
	const host: TaskNotesHost = {
		app: v.app,
		home: () => "ICAP",
		tasks: () => tasks,
		block: (id) => (id ? opts.blocks?.[id] : undefined),
		beingEdited: () => opts.editing?.() ?? false,
		baseMade: () => baseMade,
		setBaseMade: () => void (baseMade = true),
	};
	return new TaskNotes(host);
}

const statusOf = (v: ReturnType<typeof vault>, path: string) => readRecords(v.files.get(path)!).task?.status;

describe("task notes of running tasks", () => {
	it("creates one note per request block and follows its state, wherever the note is moved", async () => {
		const v = vault();
		const t = task({});
		const tasks = [t];
		const notes = setup(v, tasks);
		notes.adopt(t, "b1", "What is RAII?", "request");
		await notes.sync();
		expect([...v.files.keys()].sort()).toEqual([`ICAP/${BASE_NAME}`, "ICAP/Tasks/What is RAII.md"]);
		expect(readRecords(v.files.get("ICAP/Tasks/What is RAII.md")!).task).toMatchObject({ id: "b1", status: "running", source: ["C++"], changed: [] });
		expect(v.files.get("ICAP/Tasks/What is RAII.md")).toContain("What is RAII?\n\nAsked in [[C++]]");

		// Nothing changed: nothing is written.
		const before = v.writes;
		await notes.sync();
		expect(v.writes).toBe(before);

		v.rename("ICAP/Tasks/What is RAII.md", "Archive/raii.md");
		t.status = "waiting";
		await notes.sync();
		expect(statusOf(v, "Archive/raii.md")).toBe("needs-you");

		(t as { artifacts: unknown }).artifacts = [{ kind: "created", path: "Learning/RAII.md", label: "RAII" }, { kind: "kept", path: "C++.md", label: "" }];
		t.status = "completed";
		t.endedAt = t.createdAt + 60_000;
		await notes.sync();
		const done = readRecords(v.files.get("Archive/raii.md")!).task!;
		expect(done).toMatchObject({ status: "done", changed: ["Learning/RAII"] });
		expect(done.ended).toBeTruthy();
		expect([...v.files.keys()].filter((p) => p.endsWith(".md")).length).toBe(1);

		// The block's next round is a new ledger task with the same block: the same note runs again.
		const next = task({ id: "t2", createdAt: t.createdAt + 120_000 });
		tasks.splice(0, 1, next);
		notes.adopt(next, "b1", "And the heap?", "request");
		await notes.sync();
		const again = readRecords(v.files.get("Archive/raii.md")!).task!;
		expect(again.status).toBe("running");
		expect(again.ended).toBeUndefined();
		expect([...v.files.keys()].filter((p) => p.endsWith(".md")).length).toBe(1);
	});

	it("still records the end of a task that ends while its note is being written", async () => {
		const v = vault();
		const t = task({});
		const notes = setup(v, [t]);
		notes.adopt(t, "b1", "Q", "request");
		await notes.sync();
		// New usage arrives; while that is being written, the run finishes.
		(t as { usage: unknown }).usage = { input: 10, output: 2, cacheRead: 90, cacheWrite: 0, cost: 0.001, costKnown: true, billed: false };
		const fm = v.app.fileManager as unknown as { processFrontMatter: (f: TFile, fn: (fm: Record<string, unknown>) => void) => Promise<void> };
		const real = fm.processFrontMatter;
		let ending: Promise<void> | null = null;
		fm.processFrontMatter = async (f, fn) => {
			await real(f, fn);
			if (ending) return;
			t.status = "completed";
			t.endedAt = t.createdAt + 1000;
			ending = notes.sync();
		};
		await notes.sync();
		await ending;
		expect(readRecords(v.files.get("ICAP/Tasks/Q.md")!).task).toMatchObject({ status: "done", cost: 0.001, tokens: 102, cache: 90 });
	});

	it("writes no note for a question asked in passing, until it becomes a task", async () => {
		const v = vault();
		const t = task({ steps: [] as never });
		const block = { turns: [{ request: true }] } as unknown as AskBlock;
		const tasks = [t];
		const notes = setup(v, tasks, { blocks: { b1: block } });
		notes.adopt(t, "b1", "What is RAII?", "request");
		await notes.sync();
		t.status = "completed";
		t.endedAt = t.createdAt + 1000;
		await notes.sync();
		expect(v.files.size).toBe(0);

		// A follow-up: the conversation is now more than one question and one answer.
		(block as unknown as { turns: unknown[] }).turns.push({ request: true });
		const next = task({ id: "t2", steps: [] as never });
		tasks.splice(0, 1, next);
		notes.adopt(next, "b1", "And the heap?", "request");
		await notes.sync();
		expect(statusOf(v, "ICAP/Tasks/And the heap.md")).toBe("running");

		// A note-making task is always one; so is a single request whose agent used a tool.
		const v2 = vault();
		const n = task({ id: "t3", kind: "note", steps: [] as never, blockId: null });
		const notes2 = setup(v2, [n]);
		notes2.adopt(n, "t3", "Concept note — RAII", "note");
		await notes2.sync();
		expect(statusOf(v2, "ICAP/Tasks/Concept note — RAII.md")).toBe("running");
	});

	it("says review while a proposed edit waits for the learner", async () => {
		const v = vault();
		const t = task({ status: "waiting" });
		const notes = setup(v, [t], { blocks: { b1: { awaiting: { kind: "review" } } as unknown as AskBlock } });
		notes.adopt(t, "b1", "Fix the typo", "request");
		await notes.sync();
		expect(statusOf(v, "ICAP/Tasks/Fix the typo.md")).toBe("review");
	});

	it("does not touch a note the learner is typing in; it catches up later", async () => {
		vi.stubGlobal("window", { setTimeout: () => 1, clearTimeout: () => undefined });
		const v = vault();
		const t = task({});
		let editing = false;
		const notes = setup(v, [t], { editing: () => editing });
		notes.adopt(t, "b1", "Q", "request");
		await notes.sync();
		editing = true;
		t.status = "completed";
		t.endedAt = t.createdAt + 1000;
		await notes.sync();
		expect(statusOf(v, "ICAP/Tasks/Q.md")).toBe("running");
		editing = false;
		await notes.sync();
		expect(statusOf(v, "ICAP/Tasks/Q.md")).toBe("done");
		vi.unstubAllGlobals();
	});

	it("records, after a restart, the task that was running when Obsidian closed", async () => {
		const v = vault();
		const t = task({});
		const first = setup(v, [t]);
		first.adopt(t, "b1", "Q", "request");
		await first.sync();
		expect(statusOf(v, "ICAP/Tasks/Q.md")).toBe("running");

		// The next start loads it as cancelled (Task.from); only this device knows it was its own.
		const loaded = task({ status: "cancelled", endedAt: t.createdAt });
		const second = setup(v, [loaded]);
		second.adoptInterrupted();
		await second.sync();
		expect(statusOf(v, "ICAP/Tasks/Q.md")).toBe("cancelled");
		expect(v.local.size).toBe(0);
	});

	it("treats its notes and the base as its own files, not an agent's changes", async () => {
		const v = vault({ "Mine.md": "---\ntags: x\n---\nhello" });
		const t = task({});
		const notes = setup(v, [t]);
		notes.adopt(t, "b1", "Q", "request");
		await notes.sync();
		expect(notes.owns("ICAP/Tasks/Q.md")).toBe(true);
		expect(notes.owns(`ICAP/${BASE_NAME}`)).toBe(true);
		expect(notes.owns("Mine.md")).toBe(false);
	});
});

describe("Activity.base", () => {
	it("is generated once and then left to the learner", async () => {
		const v = vault();
		const notes = setup(v, []);
		expect(await notes.ensureBase()).toBeTruthy();
		v.files.set(`ICAP/${BASE_NAME}`, "mine now");
		await notes.ensureBase(true);
		expect(v.files.get(`ICAP/${BASE_NAME}`)).toBe("mine now");
		v.files.delete(`ICAP/${BASE_NAME}`);
		// Deleted: writing a task does not bring it back; asking for the activity does.
		expect(await notes.ensureBase()).toBeNull();
		expect(await notes.ensureBase(true)).toBeTruthy();
	});
});

describe("rebuilding on request", () => {
	it("brings back a deleted note of a task still in the ledger, and only when asked", async () => {
		const v = vault();
		const t = task({ status: "completed", endedAt: 5 });
		const notes = setup(v, [t]);
		notes.adopt(t, "b1", "Q", "request");
		await notes.sync();
		v.files.delete("ICAP/Tasks/Q.md");
		await notes.sync();
		expect(v.files.has("ICAP/Tasks/Q.md")).toBe(false);
		expect(await notes.restore([t])).toBe(1);
		expect(readRecords([...v.files.entries()].find(([p]) => p.startsWith("ICAP/Tasks/"))![1]).task).toMatchObject({ id: "b1", status: "done" });
		expect(await notes.restore([t])).toBe(0);
	});
});

describe("migrating the activity of earlier versions", () => {
	const ledger = () => [
		task({ id: "t5", kind: "explain", title: "Explained “x”", status: "completed", blockId: null }),
		task({ id: "t4", title: "“Same question”", status: "completed", blockId: "b4", endedAt: 5 }),
		task({ id: "t3", kind: "note", title: "Writing a concept note — “RAII”", status: "completed", blockId: null, endedAt: 4 }),
		task({ id: "t2", title: "“Same question”", status: "failed", blockId: "b2", endedAt: 3 }),
		task({ id: "t1", kind: "recall", title: "Recall", status: "completed", blockId: "b1", endedAt: 2 }),
		// One question, one answer, no tool: never a task.
		task({ id: "t0", title: "“Hello”", status: "completed", blockId: "b0", endedAt: 1, steps: [] as never }),
	];

	it("writes request and note tasks once, and nothing on a second run or a second device", async () => {
		const v = vault();
		expect(await setup(v, ledger()).migrate(ledger())).toBe(3);
		const names = [...v.files.keys()].sort();
		expect(names).toEqual([`ICAP/${BASE_NAME}`, "ICAP/Tasks/Same question 2.md", "ICAP/Tasks/Same question.md", "ICAP/Tasks/Writing a concept note — RAII.md"]);
		// Oldest first, so the suffix lands on the same task everywhere.
		expect(readRecords(v.files.get("ICAP/Tasks/Same question.md")!).task).toMatchObject({ id: "b2", status: "failed" });
		expect(readRecords(v.files.get("ICAP/Tasks/Same question 2.md")!).task).toMatchObject({ id: "b4", status: "done" });

		const writes = v.writes;
		expect(await setup(v, ledger()).migrate(ledger())).toBe(0);
		expect(v.writes).toBe(writes);
	});

	it("leaves a running task to the device that runs it", async () => {
		const v = vault();
		expect(await setup(v, []).migrate([task({ status: "processing" })])).toBe(0);
		expect(v.files.size).toBe(0);
	});
});
