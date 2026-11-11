import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("obsidian", () => ({ TFile: class {} }));

import type { App } from "obsidian";
import { DocStore } from "./store";

const HASH = "a".repeat(64);

/** vault.adapter over a map of file paths; folders exist while something is under them. */
function vault(files: Record<string, string>, dir?: string) {
	const fs = new Map(Object.entries(files));
	const dirs = new Set<string>();
	const under = (dir: string) => [...fs.keys(), ...dirs].filter((p) => p.startsWith(dir + "/"));
	const adapter = {
		exists: async (p: string) => fs.has(p) || dirs.has(p) || under(p).length > 0,
		mkdir: async (p: string) => void dirs.add(p),
		read: async (p: string) => {
			if (!fs.has(p)) throw new Error("ENOENT");
			return fs.get(p)!;
		},
		write: async (p: string, data: string) => void fs.set(p, data),
		remove: async (p: string) => void fs.delete(p),
		rmdir: async (p: string) => {
			for (const k of under(p)) {
				fs.delete(k);
				dirs.delete(k);
			}
			dirs.delete(p);
		},
		rename: async (from: string, to: string) => {
			for (const k of [from, ...under(from)]) {
				if (fs.has(k)) fs.set(to + k.slice(from.length), fs.get(k)!);
				fs.delete(k);
				dirs.delete(k);
			}
		},
		list: async (dir: string) => {
			const children = new Set(under(dir).map((p) => `${dir}/${p.slice(dir.length + 1).split("/")[0]}`));
			const out = { files: [] as string[], folders: [] as string[] };
			for (const c of children) (fs.has(c) ? out.files : out.folders).push(c);
			return out;
		},
	};
	const app = { vault: { adapter, getAbstractFileByPath: () => null } } as unknown as App;
	return { store: new DocStore(app, null, dir), paths: () => [...fs.keys()].sort() };
}

const index = (path: string) => JSON.stringify({ version: 1, files: { [path]: { hash: HASH, size: 1, mtime: 1 } } });

describe("the cache of earlier versions (icap/docs/)", () => {
	it("is moved into .icap/docs/, and the visible folder goes", async () => {
		const v = vault({
			"icap/docs/index.json": index("Sources/a.pdf"),
			[`icap/docs/${HASH}/tree.json`]: "{}",
			[`icap/docs/${HASH}/text.json.gz`]: "",
			"icap/docs/.DS_Store": "",
		});
		expect(Object.keys(await v.store.entries())).toEqual(["Sources/a.pdf"]);
		expect(v.paths()).toEqual([`.icap/docs/${HASH}/text.json.gz`, `.icap/docs/${HASH}/tree.json`, ".icap/docs/index.json"]);
	});

	it("is deleted when this device already has a cache", async () => {
		const v = vault({
			".icap/docs/index.json": index("Sources/new.pdf"),
			"icap/docs/index.json": index("Sources/old.pdf"),
			[`icap/docs/${HASH}/tree.json`]: "{}",
		});
		expect(Object.keys(await v.store.entries())).toEqual(["Sources/new.pdf"]);
		expect(v.paths()).toEqual([".icap/docs/index.json"]);
	});

	it("leaves what is not the cache's, and the folders holding it", async () => {
		const v = vault({
			"icap/docs/index.json": index("Sources/a.pdf"),
			"icap/docs/my-notes.md": "mine",
			"icap/docs/drafts/plan.md": "mine",
			"icap/tasks/one.md": "mine",
		});
		await v.store.entries();
		expect(v.paths()).toEqual([".icap/docs/index.json", "icap/docs/drafts/plan.md", "icap/docs/my-notes.md", "icap/tasks/one.md"]);
	});
});

describe("the cache in the plugin's own folder (format 6)", () => {
	const DIR = ".obsidian/plugins/icap-agent/docs";

	it("takes over .icap/docs/, and .icap/ goes when nothing else is in it", async () => {
		const v = vault({ ".icap/docs/index.json": index("Sources/a.pdf"), [`.icap/docs/${HASH}/tree.json`]: "{}" }, DIR);
		expect(Object.keys(await v.store.entries())).toEqual(["Sources/a.pdf"]);
		expect(v.paths()).toEqual([`${DIR}/${HASH}/tree.json`, `${DIR}/index.json`]);
	});

	it("takes over the visible icap/docs/ of an older version too", async () => {
		const v = vault({ "icap/docs/index.json": index("Sources/a.pdf") }, DIR);
		expect(Object.keys(await v.store.entries())).toEqual(["Sources/a.pdf"]);
		expect(v.paths()).toEqual([`${DIR}/index.json`]);
	});
});
