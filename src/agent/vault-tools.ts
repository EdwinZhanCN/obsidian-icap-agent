/**
 * The read-only Obsidian tools behind the ICAP extension's `obsidian` and `read_document` tools.
 *
 * Command names, parameters and JSON output follow the Obsidian CLI (search, search:context, read,
 * links, backlinks, outline, properties, aliases, tags, files), but run in-process through the App
 * API: the learner needs neither Obsidian 1.12's CLI nor to enable it. Nothing here writes.
 */
import { promises as fs } from "fs";
import { isAbsolute, resolve } from "path";
import { TFile, getAllTags, loadPdfJs, parseFrontMatterAliases, prepareSimpleSearch, type App } from "obsidian";
import { MAX_CHARS, cap, hasTag, parsePages, parseQuery, within } from "./doc-pages";

type Json = Record<string, unknown>;

export const VAULT_COMMANDS = ["search", "search:context", "read", "links", "backlinks", "outline", "properties", "aliases", "tags", "files"] as const;

function err(message: string): Json {
	return { status: "error", message };
}

/** `path` is exact (vault-relative, ".md" optional); `file` resolves like a wikilink. */
function target(app: App, p: Json): TFile | null {
	const path = typeof p.path === "string" ? p.path.trim().replace(/^\/+/, "") : "";
	if (path) {
		const f = app.vault.getAbstractFileByPath(path) ?? app.vault.getAbstractFileByPath(path + ".md");
		return f instanceof TFile ? f : null;
	}
	const name = typeof p.file === "string" ? p.file.trim().replace(/^\[\[|\]\]$/g, "") : "";
	return name ? app.metadataCache.getFirstLinkpathDest(name, "") : null;
}

function limitOf(p: Json, dflt: number, max: number): number {
	const n = Number(p.limit);
	return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), max) : dflt;
}

export async function vaultCommand(app: App, p: Json): Promise<Json> {
	const command = String(p.command ?? "");
	const named = !!(p.file || p.path);
	const needsFile = ["read", "links", "backlinks", "outline", "properties"].includes(command) || ((command === "aliases" || command === "tags") && named);
	const file = needsFile ? target(app, p) : null;
	if (needsFile && !file) return err(`No note found for ${p.path ? `path "${p.path}"` : p.file ? `file "${p.file}"` : "this command (give file or path)"}.`);
	switch (command) {
		case "search":
		case "search:context":
			return search(app, p, command === "search:context");
		case "read": {
			const c = cap(await app.vault.cachedRead(file!));
			return { path: file!.path, content: c.text, truncated: c.truncated || undefined };
		}
		case "links": {
			const cache = app.metadataCache.getFileCache(file!);
			const seen = new Map<string, { link: string; path: string | null }>();
			for (const l of [...(cache?.links ?? []), ...(cache?.embeds ?? [])]) {
				const link = l.link.split("#")[0];
				if (!link || seen.has(link)) continue;
				seen.set(link, { link, path: app.metadataCache.getFirstLinkpathDest(link, file!.path)?.path ?? null });
			}
			return { path: file!.path, links: [...seen.values()].map((l) => ({ ...l, resolved: !!l.path })) };
		}
		case "backlinks": {
			const out: { path: string; count: number }[] = [];
			for (const [src, targets] of Object.entries(app.metadataCache.resolvedLinks)) {
				const n = targets[file!.path];
				if (n && src !== file!.path) out.push({ path: src, count: n });
			}
			out.sort((a, b) => b.count - a.count);
			return { path: file!.path, backlinks: out.slice(0, limitOf(p, 200, 1000)), total: out.length };
		}
		case "outline": {
			const hs = app.metadataCache.getFileCache(file!)?.headings ?? [];
			return { path: file!.path, headings: hs.map((h) => ({ level: h.level, heading: h.heading, line: h.position.start.line + 1 })) };
		}
		case "properties":
			return { path: file!.path, properties: app.metadataCache.getFileCache(file!)?.frontmatter ?? {} };
		case "aliases": {
			if (file) return { path: file.path, aliases: parseFrontMatterAliases(app.metadataCache.getFileCache(file)?.frontmatter) ?? [] };
			const out: { path: string; aliases: string[] }[] = [];
			for (const f of app.vault.getMarkdownFiles()) {
				const a = parseFrontMatterAliases(app.metadataCache.getFileCache(f)?.frontmatter);
				if (a?.length) out.push({ path: f.path, aliases: a });
			}
			return { aliases: out.slice(0, limitOf(p, 500, 2000)), total: out.length };
		}
		case "tags": {
			if (file) {
				const c = app.metadataCache.getFileCache(file);
				return { path: file.path, tags: Array.from(new Set(c ? (getAllTags(c) ?? []) : [])) };
			}
			const counts = new Map<string, number>();
			for (const f of app.vault.getMarkdownFiles()) {
				const c = app.metadataCache.getFileCache(f);
				for (const t of new Set(c ? (getAllTags(c) ?? []) : [])) counts.set(t, (counts.get(t) ?? 0) + 1);
			}
			const tags = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([tag, count]) => ({ tag, count }));
			return { tags: tags.slice(0, limitOf(p, 300, 2000)), total: tags.length };
		}
		case "files": {
			const folder = typeof p.folder === "string" ? p.folder.trim().replace(/^\/+|\/+$/g, "") : "";
			const ext = typeof p.ext === "string" ? p.ext.trim().replace(/^\./, "").toLowerCase() : "";
			const all = app.vault
				.getFiles()
				.filter((f) => (!folder || f.path.startsWith(folder + "/")) && (!ext || f.extension.toLowerCase() === ext))
				.map((f) => f.path)
				.sort();
			return { files: all.slice(0, limitOf(p, 500, 5000)), total: all.length };
		}
		default:
			return err(`Unknown command "${command}". Use one of: ${VAULT_COMMANDS.join(", ")}.`);
	}
}

/** Obsidian-style search: every word must match, plus the path:, file: and tag: operators. */
async function search(app: App, p: Json, withContext: boolean): Promise<Json> {
	const query = String(p.query ?? "").trim();
	const q = parseQuery(query);
	if (!q.text && !q.paths.length && !q.files.length && !q.tags.length) return err("query is required");
	const match = q.text ? prepareSimpleSearch(q.text) : null;
	const words = q.text.toLowerCase().split(/\s+/).filter(Boolean);
	const folder = typeof p.folder === "string" ? p.folder.trim().replace(/^\/+|\/+$/g, "") : "";
	const limit = limitOf(p, withContext ? 20 : 50, 500);
	const hits: { path: string; score: number; lines?: string[] }[] = [];
	for (const f of app.vault.getMarkdownFiles()) {
		if (folder && !f.path.startsWith(folder + "/")) continue;
		const lower = f.path.toLowerCase();
		if (!q.paths.every((x) => lower.includes(x))) continue;
		if (!q.files.every((x) => f.name.toLowerCase().includes(x))) continue;
		if (q.tags.length) {
			const c = app.metadataCache.getFileCache(f);
			const tags = c ? (getAllTags(c) ?? []) : [];
			if (!q.tags.every((t) => hasTag(tags, t))) continue;
		}
		const text = await app.vault.cachedRead(f);
		const byName = match ? match(f.basename) : null;
		const byText = match ? match(text) : null;
		if (match && !byName && !byText) continue;
		const hit: { path: string; score: number; lines?: string[] } = { path: f.path, score: (byName ? 10 : 0) + (byText?.matches.length ?? 0) };
		if (withContext && words.length) {
			hit.lines = text
				.split("\n")
				.map((l, i) => ({ l, i }))
				.filter(({ l }) => words.some((w) => l.toLowerCase().includes(w)))
				.slice(0, 8)
				.map(({ l, i }) => `${i + 1}: ${l.trim().slice(0, 300)}`);
		}
		hits.push(hit);
	}
	hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
	if (!withContext) return { query, files: hits.slice(0, limit).map((h) => h.path), total: hits.length };
	const out = hits
		.slice(0, limit)
		.map((h) => (h.lines?.length ? h.lines.map((l) => `${h.path}:${l}`).join("\n") : h.path))
		.join("\n");
	const c = cap(out);
	return { query, matches: c.text, files: Math.min(hits.length, limit), total: hits.length };
}

/**
 * Read a PDF (or a text file) as text: its outline, and a range of pages.
 * `path` is vault-relative, or absolute; absolute paths must lie inside `allowedRoots` when given
 * (isolated mode), otherwise anything the learner's own agent could read is allowed.
 */
export async function readDocument(app: App, p: Json, allowedRoots: string[] | null): Promise<Json> {
	const raw = String(p.path ?? "").trim();
	if (!raw) return err("path is required");
	let data: ArrayBuffer | null = null;
	let name = raw;
	const inVault = app.vault.getAbstractFileByPath(raw.replace(/^\/+/, ""));
	if (!isAbsolute(raw) || inVault instanceof TFile) {
		const f = inVault instanceof TFile ? inVault : target(app, { path: raw });
		if (!f) return err(`No file at "${raw}" in the vault.`);
		name = f.path;
		if (f.extension.toLowerCase() !== "pdf") {
			const c = cap(await app.vault.cachedRead(f));
			return { path: f.path, text: c.text, truncated: c.truncated || undefined };
		}
		data = await app.vault.readBinary(f);
	} else {
		const abs = resolve(raw);
		if (allowedRoots && !within(abs, allowedRoots)) return err(`"${raw}" is outside the vault and the folders the learner allowed.`);
		const buf = await fs.readFile(abs).catch(() => null);
		if (!buf) return err(`Could not read "${raw}".`);
		if (!/\.pdf$/i.test(abs)) {
			const c = cap(buf.toString("utf8"));
			return { path: abs, text: c.text, truncated: c.truncated || undefined };
		}
		data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
	}
	const pdfjs = await loadPdfJs();
	const doc = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
	try {
		const total: number = doc.numPages;
		const out: Json = { path: name, pages: total };
		if (p.outline !== false) out.outline = await outlineOf(doc);
		if (p.outline === true && !p.pages) return out;
		const { pages, more } = parsePages(typeof p.pages === "string" ? p.pages : p.pages != null ? String(p.pages) : undefined, total);
		const parts: string[] = [];
		let size = 0;
		let last = 0;
		for (const n of pages) {
			const page = await doc.getPage(n);
			const content = await page.getTextContent();
			const text = (content.items as { str?: string; hasEOL?: boolean }[]).map((i) => (i.str ?? "") + (i.hasEOL ? "\n" : "")).join("");
			const block = `--- page ${n} ---\n${text.trim()}`;
			if (size + block.length > MAX_CHARS && parts.length) break;
			parts.push(block);
			size += block.length;
			last = n;
		}
		out.text = parts.join("\n\n");
		const next = last < (pages[pages.length - 1] ?? 0) || more ? last + 1 : null;
		if (next && next <= total) out.next = `More pages follow; continue with pages: "${next}-".`;
		if (!size || !String(out.text).replace(/--- page \d+ ---/g, "").trim()) out.note = "No text layer on these pages (a scan?). Reading it needs OCR.";
		return out;
	} finally {
		void doc.destroy?.();
	}
}

async function outlineOf(doc: any): Promise<{ title: string; page: number | null; depth: number }[]> {
	const items = (await doc.getOutline().catch(() => null)) ?? [];
	const out: { title: string; page: number | null; depth: number }[] = [];
	const walk = async (list: any[], depth: number) => {
		for (const it of list) {
			if (out.length >= 300) return;
			let page: number | null = null;
			try {
				const dest = typeof it.dest === "string" ? await doc.getDestination(it.dest) : it.dest;
				if (Array.isArray(dest) && dest[0]) page = (await doc.getPageIndex(dest[0])) + 1;
			} catch {
				page = null;
			}
			out.push({ title: String(it.title ?? "").trim(), page, depth });
			if (it.items?.length) await walk(it.items, depth + 1);
		}
	};
	await walk(items, 0);
	return out;
}
