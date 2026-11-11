import { gunzipSync, gzipSync, strFromU8, strToU8 } from "fflate";
import { TFile, type App } from "obsidian";
import type { ExternalFiles } from "../agent/backend";
import { parseDocx } from "./docx";
import { parseEpub } from "./epub";
import { DOC_EXTENSIONS, PARSER, buildTree, type DocFormat, type DocTree } from "./model";
import { carrySummaries } from "./summaries";
import { parsePdf } from "./pdf";

/**
 * The document cache, in the plugin's own folder (`<config>/plugins/icap-agent/docs/`; FORMAT.md,
 * "Document cache"):
 *
 *     docs/index.json          path → { hash, size, mtime } of every document read
 *     docs/<hash>/tree.json    the DocTree (structure, summaries)
 *     docs/<hash>/text.json.gz the units' text, a JSON array of strings, gzipped
 *
 * Keyed by the file's content, so a document is parsed once, and a renamed or copied one is not
 * parsed again. In the plugin's folder, so the learner's vault holds nothing they did not put there,
 * and Obsidian never shows or indexes it. Each device can prepare its own.
 */

/** Where the cache was in format 3 to 5: a dot-folder in the vault's root. Moved by `adoptOld`. */
export const HIDDEN_DIR = ".icap/docs";
/** Where the cache was until format 3: a visible folder. Moved by `adoptOld`. */
export const LEGACY_DIR = "icap/docs";
/** Earlier places of the cache, newest first, each with the folder that held it. */
const OLD_DIRS = [
	{ dir: HIDDEN_DIR, parent: ".icap" },
	{ dir: LEGACY_DIR, parent: "icap" },
];
/** Units of this many documents stay in memory. */
const LRU = 6;

interface IndexEntry {
	hash: string;
	size: number;
	mtime: number;
}
interface IndexFile {
	version: 1;
	files: Record<string, IndexEntry>;
}

export interface Loaded {
	path: string;
	tree: DocTree;
	units: string[];
}

export function formatOf(path: string): DocFormat | null {
	const ext = path.split(".").pop()?.toLowerCase() ?? "";
	return (DOC_EXTENSIONS as readonly string[]).includes(ext) ? (ext as DocFormat) : null;
}

export class DocStore {
	private index: IndexFile | null = null;
	private memory = new Map<string, string[]>();
	private building = new Map<string, Promise<Loaded>>();
	private adopted: Promise<void> | null = null;
	/** Called after a document was parsed for the first time (summaries hook here). */
	onBuilt?: (l: Loaded) => void;

	/**
	 * `dir`: the cache folder (the runtime gives the plugin's own `docs/`); `files`: documents outside
	 * the vault (absolute paths), when the backend can reach them.
	 */
	constructor(
		private app: App,
		private files: ExternalFiles | null = null,
		readonly dir = HIDDEN_DIR,
	) {}

	private get indexPath() {
		return `${this.dir}/index.json`;
	}

	private get adapter() {
		return this.app.vault.adapter;
	}

	private async readIndex(): Promise<IndexFile> {
		if (this.index) return this.index;
		await (this.adopted ??= this.adoptOld());
		try {
			const parsed = JSON.parse(await this.adapter.read(this.indexPath)) as IndexFile;
			this.index = parsed?.version === 1 && parsed.files ? parsed : { version: 1, files: {} };
		} catch {
			this.index = { version: 1, files: {} };
		}
		return this.index;
	}

	/**
	 * The cache of an earlier version (`.icap/docs/`, before that `icap/docs/`) becomes this one, so
	 * nothing is parsed again; when this device already has a cache, the old one is deleted. Only the
	 * cache's own entries are touched, and the old folder goes only when nothing else is left in it.
	 */
	private async adoptOld() {
		for (const old of OLD_DIRS) if (old.dir !== this.dir) await this.adoptFrom(old.dir, old.parent);
	}

	private async adoptFrom(from: string, parent: string) {
		const a = this.adapter;
		try {
			if (!(await a.exists(from))) return;
			const adopt = !(await a.exists(this.indexPath));
			const old = await a.list(from);
			for (const path of [...old.files, ...old.folders]) {
				const name = path.split("/").pop()!;
				const folder = old.folders.includes(path);
				if (folder ? !/^[0-9a-f]{64}$/.test(name) : name !== "index.json") continue;
				const to = `${this.dir}/${name}`;
				if (adopt && !(await a.exists(to))) {
					await this.ensureDir(this.dir);
					await a.rename(path, to);
				} else if (folder) await a.rmdir(path, true);
				else await a.remove(path);
			}
			for (const dir of [from, parent]) {
				const left = await a.list(dir);
				if (left.folders.length || left.files.some((f) => !f.endsWith("/.DS_Store"))) break;
				await a.rmdir(dir, true);
			}
		} catch {
			// What could not be moved stays where it was; those documents are parsed again.
		}
	}

	private async saveIndex() {
		if (!this.index) return;
		await this.ensureDir(this.dir);
		await this.adapter.write(this.indexPath, JSON.stringify(this.index, null, "\t"));
	}

	private async ensureDir(dir: string) {
		if (!(await this.adapter.exists(dir))) await this.adapter.mkdir(dir);
	}

	/** Size, mtime and bytes of a vault path or an absolute path. */
	private async stat(path: string): Promise<{ size: number; mtime: number } | null> {
		const f = this.app.vault.getAbstractFileByPath(path);
		if (f instanceof TFile) return { size: f.stat.size, mtime: f.stat.mtime };
		if (!this.files?.isAbsolute(path)) return null;
		return this.files.stat(path);
	}

	private async bytes(path: string): Promise<Uint8Array> {
		const f = this.app.vault.getAbstractFileByPath(path);
		if (f instanceof TFile) return new Uint8Array(await this.app.vault.readBinary(f));
		if (!this.files) throw new Error(`Could not read "${path}".`);
		return this.files.read(path);
	}

	/** The cached tree for a path when it is still fresh, without parsing anything. */
	async cached(path: string): Promise<DocTree | null> {
		const entry = (await this.readIndex()).files[path];
		const st = await this.stat(path);
		if (!entry || !st || entry.size !== st.size || entry.mtime !== st.mtime) return null;
		return this.readTree(entry.hash);
	}

	/** The cached tree, if it was written by this parser. */
	async readTree(hash: string): Promise<DocTree | null> {
		const t = await this.readAnyTree(hash);
		return t?.parser === PARSER ? t : null;
	}

	private async readAnyTree(hash: string): Promise<DocTree | null> {
		try {
			const t = JSON.parse(await this.adapter.read(`${this.dir}/${hash}/tree.json`)) as DocTree;
			return t?.version === 1 ? t : null;
		} catch {
			return null;
		}
	}

	async writeTree(tree: DocTree) {
		await this.ensureDir(`${this.dir}/${tree.hash}`);
		await this.adapter.write(`${this.dir}/${tree.hash}/tree.json`, JSON.stringify(tree));
	}

	async units(hash: string): Promise<string[]> {
		const hit = this.memory.get(hash);
		if (hit) {
			this.memory.delete(hash);
			this.memory.set(hash, hit);
			return hit;
		}
		const gz = new Uint8Array(await this.adapter.readBinary(`${this.dir}/${hash}/text.json.gz`));
		const units = JSON.parse(strFromU8(gunzipSync(gz))) as string[];
		this.memory.set(hash, units);
		while (this.memory.size > LRU) this.memory.delete(this.memory.keys().next().value!);
		return units;
	}

	/** The document, parsed now if the cache has nothing fresh for it. */
	load(path: string, onProgress?: (done: number, total: number) => void): Promise<Loaded> {
		const running = this.building.get(path);
		if (running) return running;
		const p = this.loadNow(path, onProgress).finally(() => this.building.delete(path));
		this.building.set(path, p);
		return p;
	}

	private async loadNow(path: string, onProgress?: (done: number, total: number) => void): Promise<Loaded> {
		const format = formatOf(path);
		if (!format) throw new Error(`"${path}" is not a PDF, EPUB or Word document.`);
		const st = await this.stat(path);
		if (!st) throw new Error(`Could not read "${path}".`);
		const index = await this.readIndex();
		const entry = index.files[path];
		if (entry && entry.size === st.size && entry.mtime === st.mtime) {
			const tree = await this.readTree(entry.hash);
			if (tree) {
				const units = await this.units(entry.hash).catch(() => null);
				if (units) return { path, tree, units };
			}
		}
		const data = await this.bytes(path);
		const hash = await sha256(data);
		// The same content under another name (renamed, copied, another device): reuse it.
		let tree = await this.readTree(hash);
		let units = tree ? await this.units(hash).catch(() => null) : null;
		let fresh = false;
		if (!tree || !units) {
			const parsed = format === "pdf" ? await parsePdf(data, onProgress) : format === "epub" ? parseEpub(data) : parseDocx(data);
			const name = path.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, "");
			tree = buildTree(format, hash, name, parsed);
			units = parsed.units;
			// Parsed again by a newer parser: summaries of parts that are still the same are kept.
			const old = await this.readAnyTree(hash);
			if (old) carrySummaries(old, tree);
			await this.ensureDir(`${this.dir}/${hash}`);
			await this.adapter.writeBinary(`${this.dir}/${hash}/text.json.gz`, toArrayBuffer(gzipSync(strToU8(JSON.stringify(units)), { level: 6 })));
			await this.writeTree(tree);
			this.memory.set(hash, units);
			fresh = true;
		}
		index.files[path] = { hash, size: st.size, mtime: st.mtime };
		await this.saveIndex();
		const loaded = { path, tree, units };
		if (fresh) this.onBuilt?.(loaded);
		return loaded;
	}

	/** Every path the cache knows, with its entry. */
	async entries(): Promise<Record<string, IndexEntry>> {
		return { ...(await this.readIndex()).files };
	}

	/**
	 * Forget vault paths that no longer exist and delete cached documents nothing points to. Absolute
	 * paths (folders outside the vault) are kept: the index is shared, and on another device they may
	 * simply not exist.
	 */
	async prune() {
		const index = await this.readIndex();
		let changed = false;
		for (const path of Object.keys(index.files)) {
			if (absolutePath(path, this.files)) continue;
			if (!(await this.stat(path))) {
				delete index.files[path];
				changed = true;
			}
		}
		if (changed) await this.saveIndex();
		const used = new Set(Object.values(index.files).map((e) => e.hash));
		const listed = await this.adapter.list(this.dir).catch(() => ({ folders: [] as string[], files: [] as string[] }));
		for (const dir of listed.folders) {
			const hash = dir.split("/").pop()!;
			if (/^[0-9a-f]{64}$/.test(hash) && !used.has(hash)) await this.adapter.rmdir(dir, true).catch(() => undefined);
		}
	}
}

/** Hex SHA-256 of the bytes (Web Crypto: the same digest on every platform). */
async function sha256(data: Uint8Array): Promise<string> {
	const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data as Uint8Array<ArrayBuffer>));
	return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Is an index entry an absolute path (a document outside the vault)? Asked of the backend's files
 * when there are any; otherwise by its shape, since vault paths never start with "/" or a drive.
 */
function absolutePath(path: string, files: ExternalFiles | null): boolean {
	return files ? files.isAbsolute(path) : /^(?:[/\\]|[A-Za-z]:[/\\])/.test(path);
}

function toArrayBuffer(u: Uint8Array): ArrayBuffer {
	return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}
