import { TFile, type App } from "obsidian";
import type { ExternalFiles } from "../agent/backend";
import { MAX_CHARS, MAX_PAGES, cap, parsePages } from "../agent/tools/doc-pages";
import { DOC_EXTENSIONS, describeTree, findNode, outlineText, walkNodes, type DocTree } from "./model";
import { queryTerms, searchUnits, type DocHit } from "./search";
import { formatOf, type DocStore } from "./store";

/**
 * What ICAP's reading tools answer: `read_document` (a document's structure, a node, or units) and
 * `documents` (the library: list and search). Everything comes from the cache (store.ts); a document
 * is parsed the first time it is read. Files outside the vault are reached through `files`, when the
 * backend has them (ExternalFiles in agent/backend.ts).
 */

type Json = Record<string, unknown>;

/** Trees with more nodes than this are shown two levels deep first. */
const OUTLINE_NODES = 400;

function err(message: string): Json {
	return { status: "error", message };
}

/**
 * A path the agent gave → a vault path or an absolute path. `restrict`: an absolute path only inside
 * the vault and the folders the learner allowed.
 */
function locate(app: App, files: ExternalFiles | null, raw: string, restrict: boolean): { path: string } | { error: string } {
	const clean = raw.trim().replace(/^\[\[|\]\]$/g, "");
	if (!clean) return { error: "path is required" };
	const vaultPath = clean.replace(/^\/+/, "");
	const absolute = !!files?.isAbsolute(clean);
	const f = app.vault.getAbstractFileByPath(vaultPath) ?? (absolute ? null : app.metadataCache.getFirstLinkpathDest(clean, ""));
	if (f instanceof TFile) return { path: f.path };
	if (!files || !absolute) return { error: `No file at "${raw}" in the vault.` };
	const abs = files.resolve(clean, restrict);
	if (!abs) return { error: `"${raw}" is outside the vault and the folders the learner allowed.` };
	return { path: abs };
}

function unitWord(tree: DocTree, n: number): string {
	return tree.unit === "page" ? (n === 1 ? "page" : "pages") : n === 1 ? "section" : "sections";
}

/** Units → text blocks, within the per-call limits; says where to continue. */
function readUnits(tree: DocTree, units: string[], wanted: number[], more: boolean): Json {
	const parts: string[] = [];
	let size = 0;
	let last = 0;
	for (const n of wanted) {
		const block = `--- ${tree.unit} ${n} ---\n${(units[n - 1] ?? "").trim()}`;
		if (size + block.length > MAX_CHARS && parts.length) break;
		parts.push(block.length > MAX_CHARS ? cap(block).text : block);
		size += block.length;
		last = n;
	}
	const out: Json = { text: parts.join("\n\n") };
	const end = wanted[wanted.length - 1] ?? 0;
	if (last < end || more) out.next = `More follows; continue with pages: "${last + 1}-${more ? "" : end}".`;
	if (!String(out.text).replace(new RegExp(`--- ${tree.unit} \\d+ ---`, "g"), "").trim()) out.note = tree.format === "pdf" ? "No text layer on these pages (a scan?). Reading it needs OCR." : "These sections have no text.";
	return out;
}

export async function readDocument(app: App, store: DocStore, files: ExternalFiles | null, p: Json, restrict: boolean): Promise<Json> {
	const where = locate(app, files, String(p.path ?? ""), restrict);
	if ("error" in where) return err(where.error);
	const { path } = where;
	if (!formatOf(path)) {
		// Anything else is read as text, as before.
		const f = app.vault.getAbstractFileByPath(path);
		const raw = f instanceof TFile ? await app.vault.cachedRead(f) : files ? await files.readText(path) : null;
		if (raw === null) return err(`Could not read "${path}".`);
		const c = cap(raw);
		return { path, text: c.text, truncated: c.truncated || undefined };
	}
	const { tree, units } = await store.load(path);
	const base: Json = { path, title: tree.title, about: describeTree(tree) };
	if (tree.summary) base.summary = tree.summary;

	if (typeof p.node === "string" || typeof p.node === "number") {
		const node = findNode(tree, String(p.node));
		if (!node) return err(`No node "${p.node}" in ${path}. Read the structure first (structure: true).`);
		const span: number[] = [];
		for (let n = node.start; n <= node.end; n++) span.push(n);
		return { ...base, node: node.node_id, node_title: node.title, range: `${tree.unit} ${node.start}–${node.end}`, ...readUnits(tree, units, span.slice(0, MAX_PAGES), span.length > MAX_PAGES) };
	}
	const pageSpec = typeof p.pages === "string" ? p.pages : p.pages != null ? String(p.pages) : undefined;
	if (pageSpec) {
		const { pages, more } = parsePages(pageSpec, tree.units);
		return { ...base, ...readUnits(tree, units, pages, more) };
	}
	// The structure: what to read next.
	let count = 0;
	for (const _ of walkNodes(tree.structure)) count++;
	const shallow = count > OUTLINE_NODES;
	return {
		...base,
		[tree.unit === "page" ? "pages" : "sections"]: tree.units,
		outline: outlineText(tree, { maxDepth: shallow ? 1 : undefined }),
		hint:
			(shallow ? `Large tree (${count} nodes), shown two levels deep. ` : "") +
			`Read a node with node: "0003" (its ${unitWord(tree, 2)}), or ${unitWord(tree, 2)} with pages: "12-15".` +
			(tree.format === "pdf" ? ` Cite as [[${path.split(/[\\/]/).pop()}#page=12]].` : ""),
	};
}

/** Documents (PDF, EPUB, DOCX) in the vault and, when there are any, in the allowed folders outside it. */
async function listDocuments(app: App, files: ExternalFiles | null, folder?: string): Promise<string[]> {
	const prefix = folder ? folder.replace(/^\/+|\/+$/g, "") + "/" : "";
	const out = app.vault
		.getFiles()
		.filter((f) => (DOC_EXTENSIONS as readonly string[]).includes(f.extension.toLowerCase()) && (!prefix || f.path.startsWith(prefix)))
		.map((f) => f.path);
	if (!folder && files) {
		for (const root of files.roots()) {
			const walk = async (dir: string, depth: number) => {
				if (depth > 4 || out.length > 2000) return;
				for (const e of await files.list(dir)) {
					if (e.name.startsWith(".")) continue;
					if (e.folder) await walk(e.path, depth + 1);
					else if (formatOf(e.name)) out.push(e.path);
				}
			};
			await walk(root, 0);
		}
	}
	return out.sort((a, b) => a.localeCompare(b));
}

export async function documentsCommand(app: App, store: DocStore, files: ExternalFiles | null, p: Json): Promise<Json> {
	const command = String(p.command ?? "list");
	const folder = typeof p.folder === "string" && p.folder.trim() ? p.folder.trim() : undefined;
	const paths = await listDocuments(app, files, folder);
	const limit = Math.min(Math.max(1, Number(p.limit) || (command === "search" ? 20 : 200)), 500);
	if (command === "list") {
		const rows: Json[] = [];
		let unread = 0;
		for (const path of paths.slice(0, limit)) {
			const tree = await store.cached(path);
			if (!tree) {
				unread++;
				rows.push({ path, read: false });
				continue;
			}
			const row: Json = { path, title: tree.title, about: describeTree(tree), chapters: tree.structure.slice(0, 12).map((n) => n.title) };
			if (tree.structure.length > 12) (row.chapters as string[]).push(`… +${tree.structure.length - 12} more`);
			if (tree.summary) row.summary = tree.summary;
			rows.push(row);
		}
		return {
			documents: rows,
			total: paths.length,
			...(paths.length > limit ? { more: `${paths.length - limit} more; narrow with folder.` } : {}),
			...(unread ? { note: `${unread} not read yet: read_document parses one the first time (structure: true).` } : {}),
		};
	}
	if (command === "search") {
		const terms = queryTerms(String(p.query ?? ""));
		if (!terms.length) return err("search needs a query.");
		const hits: DocHit[] = [];
		let unread = 0;
		for (const path of paths) {
			const tree = await store.cached(path);
			if (!tree) {
				unread++;
				continue;
			}
			const units = await store.units(tree.hash).catch(() => null);
			if (units) hits.push(...searchUnits(path, tree, units, terms, limit));
		}
		hits.sort((a, b) => b.score - a.score);
		return {
			query: terms.join(" "),
			hits: hits.slice(0, limit).map(({ score: _s, ...h }) => h),
			...(unread ? { note: `${unread} documents are not read yet and were not searched; read_document parses one (structure: true).` } : {}),
		};
	}
	return err(`Unknown command "${command}": use list or search.`);
}
