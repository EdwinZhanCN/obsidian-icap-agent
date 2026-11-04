/**
 * Pure helpers for the ICPA vault tools (no Obsidian imports, so they can be unit tested).
 */
import { isAbsolute, relative, resolve } from "path";

/** Most pages one read_document call returns, so one call can't flood the agent's context. */
export const MAX_PAGES = 30;
/** Most characters one vault-tool result carries. */
export const MAX_CHARS = 60000;

/**
 * Parse a page selection like "12", "3-7", "3-" or "1,4,9-11" against a document of `total` pages.
 * Empty = from page 1. Returns at most MAX_PAGES pages, in order, without duplicates.
 */
export function parsePages(spec: string | undefined, total: number): { pages: number[]; more: boolean } {
	const want: number[] = [];
	const s = (spec ?? "").trim();
	if (!s) for (let p = 1; p <= total; p++) want.push(p);
	else
		for (const part of s.split(",")) {
			const m = part.trim().match(/^(\d+)\s*(?:-\s*(\d*))?$/);
			if (!m) throw new Error(`Invalid page selection "${part.trim()}". Use e.g. "12", "3-7" or "1,4,9-11".`);
			const a = Number(m[1]);
			const b = m[2] === undefined ? a : m[2] === "" ? total : Number(m[2]);
			for (let p = Math.max(1, a); p <= Math.min(total, b); p++) want.push(p);
		}
	const pages = Array.from(new Set(want));
	return { pages: pages.slice(0, MAX_PAGES), more: pages.length > MAX_PAGES };
}

/** Cut text to MAX_CHARS, saying so. */
export function cap(text: string, max = MAX_CHARS): { text: string; truncated: boolean } {
	return text.length > max ? { text: text.slice(0, max) + "\n…(truncated)", truncated: true } : { text, truncated: false };
}

/** Is `target` (absolute) inside one of `roots` (absolute)? */
export function within(target: string, roots: string[]): boolean {
	return roots.some((root) => {
		const rel = relative(resolve(root), resolve(target));
		return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
	});
}

export interface SearchQuery {
	/** Free text: words that must all appear (Obsidian's simple search). */
	text: string;
	/** path: filters — substrings of the vault path, all must match. */
	paths: string[];
	/** file: filters — substrings of the file name. */
	files: string[];
	/** tag: filters — tags (without "#") the note must have, nested tags included. */
	tags: string[];
}

/** Split an Obsidian-style query into the path:/file:/tag: operators and the remaining words. */
export function parseQuery(q: string): SearchQuery {
	const out: SearchQuery = { text: "", paths: [], files: [], tags: [] };
	const rest: string[] = [];
	const re = /(path|file|tag):(?:"([^"]*)"|(\S+))|("[^"]*"|\S+)/gi;
	for (const m of q.matchAll(re)) {
		if (m[1]) {
			const v = (m[2] ?? m[3] ?? "").trim().toLowerCase();
			if (!v) continue;
			const op = m[1].toLowerCase();
			if (op === "path") out.paths.push(v);
			else if (op === "file") out.files.push(v);
			else out.tags.push(v.replace(/^#/, ""));
		} else rest.push(m[4]);
	}
	out.text = rest.join(" ").replace(/"/g, "").trim();
	return out;
}

/** Does a note's tag list satisfy a tag: filter (exact or a nested child, case-insensitive)? */
export function hasTag(tags: string[], want: string): boolean {
	return tags.some((t) => {
		const x = t.replace(/^#/, "").toLowerCase();
		return x === want || x.startsWith(want + "/");
	});
}
