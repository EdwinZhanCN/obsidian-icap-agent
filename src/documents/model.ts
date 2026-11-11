/**
 * The document model behind ICAP's reading tools: any source (PDF, EPUB, DOCX) becomes a list of
 * units — the pages of a PDF, the sections of an EPUB or DOCX — and a tree of titled nodes over them,
 * after PageIndex's tree (VectifyAI/PageIndex, MIT). The agent reads the tree first and then only the
 * nodes it needs. Pure: no Obsidian imports.
 */

export type DocFormat = "pdf" | "epub" | "docx";
export const DOC_EXTENSIONS: readonly DocFormat[] = ["pdf", "epub", "docx"];

/** Where the tree came from. */
export type TocSource = "bookmarks" | "nav" | "headings" | "detected" | "pages" | "unreadable";

export interface DocNode {
	/** 4 digits, zero-padded, in reading order: "0001". */
	node_id: string;
	title: string;
	/** First and last unit, 1-based, inclusive. */
	start: number;
	end: number;
	/** Only when summaries are turned on. */
	summary?: string;
	nodes?: DocNode[];
}

/**
 * Bump when parsing changes what a document becomes (better spacing, better heading detection):
 * trees written by an older parser are parsed again; their summaries are kept when the structure
 * did not change.
 */
export const PARSER = 1;

export interface DocTree {
	/** Cache format version (FORMAT.md, "Document cache"). */
	version: 1;
	/** The parser that wrote it (PARSER). */
	parser: number;
	format: DocFormat;
	/** sha256 of the file's bytes. */
	hash: string;
	title: string;
	/** What one unit is: a PDF page or a section of an EPUB / DOCX. */
	unit: "page" | "section";
	units: number;
	toc_source: TocSource;
	structure: DocNode[];
	/** Whole-document summary, only when summaries are turned on. */
	summary?: string;
	/** The model that wrote the summaries, when there are any. */
	summarized_by?: string;
}

/** A heading found in a source, before it becomes a node. */
export interface Heading {
	/** 1 = top level. */
	level: number;
	title: string;
	/** The unit it starts in, 1-based. */
	unit: number;
}

/** What a format parser hands the document model: the units' text and the headings over them. */
export interface Parsed {
	title: string;
	units: string[];
	headings: Heading[];
	toc_source: TocSource;
}

export function cleanTitle(s: string): string {
	return s.replace(/\s+/g, " ").trim();
}

/**
 * Headings (in reading order) → a tree. Each node runs from its unit to the unit before the next
 * heading at the same or a higher level. Units before the first heading become a "Preface" node and
 * every unit is covered, as in PageIndex.
 */
export function treeFromHeadings(headings: Heading[], units: number): DocNode[] {
	const hs = headings
		.map((h) => ({ ...h, title: cleanTitle(h.title), unit: Math.min(Math.max(1, Math.floor(h.unit)), Math.max(1, units)) }))
		.filter((h) => h.title);
	if (!units) return [];
	if (!hs.length) return [];
	// Units can only move forward; an entry pointing back (a misplaced bookmark) takes the previous unit.
	for (let i = 1; i < hs.length; i++) if (hs[i].unit < hs[i - 1].unit) hs[i].unit = hs[i - 1].unit;
	const minLevel = Math.min(...hs.map((h) => h.level));
	type Open = { node: DocNode; level: number };
	const roots: DocNode[] = [];
	const stack: Open[] = [];
	for (const h of hs) {
		const level = h.level - minLevel + 1;
		while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
		const node: DocNode = { node_id: "", title: h.title, start: h.unit, end: h.unit };
		const parent = stack[stack.length - 1]?.node;
		if (parent) (parent.nodes ??= []).push(node);
		else roots.push(node);
		stack.push({ node, level });
	}
	if (roots[0].start > 1) roots.unshift({ node_id: "", title: "Preface", start: 1, end: roots[0].start - 1 });
	closeEnds(roots, units);
	numberNodes(roots);
	return roots;
}

/** Each node ends where its next sibling starts (or where its parent ends). */
function closeEnds(list: DocNode[], end: number) {
	for (let i = 0; i < list.length; i++) {
		const next = list[i + 1];
		list[i].end = next ? Math.max(list[i].start, next.start - (next.start > list[i].start ? 1 : 0)) : Math.max(list[i].start, end);
		const kids = list[i].nodes;
		if (kids) {
			closeEnds(kids, list[i].end);
			// A child on the page where the next part begins (a shared page) still lies inside its parent.
			list[i].end = Math.max(list[i].end, kids[kids.length - 1].end);
		}
	}
}

export function numberNodes(list: DocNode[]) {
	let n = 0;
	const walk = (xs: DocNode[]) => {
		for (const x of xs) {
			x.node_id = String(++n).padStart(4, "0");
			if (x.nodes) walk(x.nodes);
		}
	};
	walk(list);
}

/** Parsed text and headings → the tree the cache keeps. */
export function buildTree(format: DocFormat, hash: string, fallbackTitle: string, parsed: Parsed): DocTree {
	const unit = format === "pdf" ? "page" : "section";
	const n = parsed.units.length;
	let structure = parsed.headings.length ? treeFromHeadings(parsed.headings, n) : [];
	let toc = parsed.toc_source;
	if (!structure.length && n) {
		structure = flatTree(n, unit);
		if (toc !== "unreadable") toc = "pages";
	}
	return { version: 1, parser: PARSER, format, hash, title: cleanTitle(parsed.title) || fallbackTitle, unit, units: n, toc_source: toc, structure };
}

/** One node per unit, when nothing better is known: "Page 3" / "Section 3". */
export function flatTree(units: number, unit: DocTree["unit"]): DocNode[] {
	const out: DocNode[] = [];
	for (let i = 1; i <= units; i++) out.push({ node_id: "", title: `${unit === "page" ? "Page" : "Section"} ${i}`, start: i, end: i });
	numberNodes(out);
	return out;
}

export function* walkNodes(list: DocNode[], depth = 0): Generator<{ node: DocNode; depth: number }> {
	for (const node of list) {
		yield { node, depth };
		if (node.nodes) yield* walkNodes(node.nodes, depth + 1);
	}
}

export function findNode(tree: DocTree, id: string): DocNode | undefined {
	const want = id.trim().padStart(4, "0");
	for (const { node } of walkNodes(tree.structure)) if (node.node_id === want) return node;
	return undefined;
}

/** The deepest node containing a unit, for labelling search hits. */
export function nodeAt(tree: DocTree, unit: number): DocNode | undefined {
	let found: DocNode | undefined;
	let list = tree.structure;
	for (;;) {
		const n = list.find((x) => x.start <= unit && unit <= x.end);
		if (!n) return found;
		found = n;
		if (!n.nodes) return found;
		list = n.nodes;
	}
}

function range(t: DocTree, n: DocNode): string {
	const p = t.unit === "page" ? "p." : "§";
	return n.start === n.end ? `${p}${n.start}` : `${p}${n.start}–${n.end}`;
}

/**
 * The tree as compact text for the agent: one line per node, indented by depth, with its range
 * and, when present, its summary. `maxDepth` cuts deeper levels (their parents say how many).
 */
export function outlineText(tree: DocTree, opts: { maxDepth?: number; summaries?: boolean } = {}): string {
	const lines: string[] = [];
	const maxDepth = opts.maxDepth ?? Infinity;
	for (const { node, depth } of walkNodes(tree.structure)) {
		if (depth > maxDepth) continue;
		const hidden = depth === maxDepth && node.nodes?.length ? ` (+${countNodes(node.nodes)} below)` : "";
		const summary = opts.summaries !== false && node.summary ? ` — ${node.summary}` : "";
		lines.push(`${"  ".repeat(depth)}${node.node_id} ${node.title} (${range(tree, node)})${hidden}${summary}`);
	}
	return lines.join("\n");
}

function countNodes(list: DocNode[]): number {
	return Array.from(walkNodes(list)).length;
}

/** "PDF · 412 pages · structure from bookmarks". */
export function describeTree(tree: DocTree): string {
	const what = tree.unit === "page" ? (tree.units === 1 ? "1 page" : `${tree.units} pages`) : tree.units === 1 ? "1 section" : `${tree.units} sections`;
	const from: Record<TocSource, string> = {
		bookmarks: "structure from the PDF's bookmarks",
		nav: "structure from the book's table of contents",
		headings: "structure from the document's headings",
		detected: "structure detected from the layout (may be imperfect)",
		pages: "no structure found: one node per unit",
		unreadable: "no text layer (a scan?): reading it needs OCR",
	};
	return `${tree.format.toUpperCase()} · ${what} · ${from[tree.toc_source]}`;
}
