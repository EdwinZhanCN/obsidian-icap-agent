import { describe, expect, it } from "vite-plus/test";
import { Backups, MAX_BYTES, expired, safeName, stamp, type BackupStore } from "./backups";

/** A folder in memory. */
function store() {
	const files = new Map<string, string>();
	const folders = new Set<string>();
	const s: BackupStore = {
		exists: async (p) => files.has(p) || folders.has(p),
		mkdir: async (p) => void folders.add(p),
		write: async (p, d) => void files.set(p, d),
		append: async (p, d) => void files.set(p, (files.get(p) ?? "") + d),
		list: async (p) => ({ files: [...files.keys()].filter((f) => f.startsWith(p + "/") && !f.slice(p.length + 1).includes("/")), folders: [...folders].filter((f) => f.startsWith(p + "/") && !f.slice(p.length + 1).includes("/")) }),
		rmdir: async (p) => {
			folders.delete(p);
			for (const f of [...files.keys()]) if (f.startsWith(p + "/")) files.delete(f);
		},
	};
	return { s, files, folders };
}

const at = new Date(2026, 10, 12, 14, 32, 5);

describe("the original kept before a write", () => {
	it("is a file per write in a folder per day, with an index saying which file it was", async () => {
		const { s, files } = store();
		const b = new Backups(s, "plugin/backups");
		const where = await b.keep("t1", "Notes/Heap.md", "the original\n", at);
		expect(where).toBe("2026-11-12/143205-1-Heap.md");
		expect(files.get("plugin/backups/2026-11-12/143205-1-Heap.md")).toBe("the original\n");
		const index = JSON.parse(files.get("plugin/backups/index.jsonl")!.trim());
		expect(index).toMatchObject({ task: "t1", path: "Notes/Heap.md", file: where });
	});

	it("two writes in the same second do not overwrite each other", async () => {
		const { s, files } = store();
		const b = new Backups(s, "d");
		await b.keep("t", "a.md", "one", at);
		await b.keep("t", "a.md", "two", at);
		expect([...files.keys()].filter((f) => f.endsWith("a.md")).length).toBe(2);
	});

	it("a new file has no original, and a file too large is noted but not copied", async () => {
		const { s, files } = store();
		const b = new Backups(s, "d");
		expect(await b.keep("t", "new.md", null, at)).toBeNull();
		expect(files.size).toBe(0);
		expect(await b.keep("t", "big.bin", "x".repeat(MAX_BYTES + 1), at)).toBeNull();
		expect(JSON.parse(files.get("d/index.jsonl")!.trim())).toEqual({ at: at.toISOString(), task: "t", path: "big.bin" });
	});

	it("a store that fails is not why a change fails", async () => {
		const { s } = store();
		s.write = async () => {
			throw new Error("disk full");
		};
		expect(await new Backups(s, "d").keep("t", "a.md", "x", at)).toBeNull();
	});

	it("names are safe on every platform", () => {
		expect(safeName("C:\\Users\\me\\a:b?.md")).toBe("a_b_.md");
		expect(safeName("notes/日记.md")).toBe("日记.md");
		expect(stamp(at)).toEqual({ day: "2026-11-12", time: "143205" });
	});

	it("days older than a month go, the rest and the index stay", async () => {
		const { s, folders, files } = store();
		const b = new Backups(s, "d");
		folders.add("d");
		for (const day of ["2026-10-01", "2026-10-13", "2026-11-12", "not-a-day"]) folders.add(`d/${day}`);
		files.set("d/2026-10-01/1.md", "old");
		files.set("d/index.jsonl", "{}\n");
		expect(expired(["d/2026-10-12", "d/2026-10-13", "d/x"], at)).toEqual(["d/2026-10-12"]);
		await b.prune(at);
		expect([...folders].sort()).toEqual(["d", "d/2026-10-13", "d/2026-11-12", "d/not-a-day"]);
		expect(files.has("d/2026-10-01/1.md")).toBe(false);
		expect(files.has("d/index.jsonl")).toBe(true);
	});
});
