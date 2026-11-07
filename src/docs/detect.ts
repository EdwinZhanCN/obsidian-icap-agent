import type { Heading } from "./model";

/**
 * Headings of a PDF without bookmarks, from layout statistics alone (no LLM), after the idea of
 * PageIndex Flash (VectifyAI/PageIndex, MIT): the body text's size is the most common one; lines
 * clearly larger than it, short, not repeated on many pages and not a table-of-contents entry are
 * heading candidates; their sizes rank into levels, and numbering ("2.3", "第三章") refines them.
 * Pure: works on lines a PDF reader has already assembled.
 */

export interface PdfLine {
	page: number;
	text: string;
	/** Font size in PDF units. */
	size: number;
	/** Distance from the top of the page, 0–1 (for headers and footers). */
	top: number;
	bold?: boolean;
	/** Left edge, 0–1 of the page width, and the column it sits in (0 = left or full width, 1 = right). */
	x?: number;
	column?: number;
	/** Nothing else shares its row: a line set apart, as headings are. */
	alone?: boolean;
}

/** A text item as PDF.js gives it (getTextContent). */
export interface PdfItem {
	str: string;
	transform: number[];
	width?: number;
	height?: number;
	fontName?: string;
	hasEOL?: boolean;
}

function itemSize(it: PdfItem): number {
	const [a, b, , d] = it.transform;
	return Math.abs(it.height || Math.hypot(b, d) || Math.abs(a)) || 0;
}

const CJK = /[\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/;

/** Does a space belong between two pieces that sit `gap` apart on one line? */
function needsSpace(prev: string, next: string, gap: number, size: number): boolean {
	if (!prev || !next || /\s$/.test(prev) || /^\s/.test(next)) return false;
	if (CJK.test(prev.slice(-1)) || CJK.test(next[0])) return false;
	return gap > size * 0.12;
}

/**
 * A page's text in the order the PDF lays it down (which follows columns), with the spaces and line
 * breaks that typesetters such as TeX leave out of the text and express only as gaps.
 */
export function pageText(items: PdfItem[]): string {
	let out = "";
	let prev: { x: number; y: number; end: number; size: number } | null = null;
	for (const it of items) {
		const s = it.str ?? "";
		const [, , , , x, y] = it.transform;
		const size = itemSize(it) || 10;
		// Whitespace items are PDF.js's guesses (TeX kerns become 0.6 pt "spaces"): the gap decides.
		if (s.trim()) {
			if (prev && !out.endsWith("\n")) {
				if (Math.abs(y - prev.y) > prev.size * 0.5) out += "\n";
				else if (needsSpace(out, s, x - prev.end, size)) out += " ";
			}
			out += s;
			prev = { x, y, end: x + (it.width ?? 0), size };
		}
		if (it.hasEOL) out += "\n";
	}
	return out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Text items of one page → lines, top to bottom. A row is split where a wide gap separates its
 * pieces, so the two columns of a paper don't merge into one line.
 */
export function linesOfItems(page: number, items: PdfItem[], pageHeight: number, bold?: (fontName: string) => boolean, pageWidth = 0): PdfLine[] {
	type Piece = { x: number; end: number; s: string; size: number; bold: boolean; eol: boolean };
	const rows: { y: number; pieces: Piece[] }[] = [];
	for (const it of items) {
		const s = it.str ?? "";
		if (!s.trim()) continue;
		const size = itemSize(it);
		if (!size) continue;
		const [, , , , x, y] = it.transform;
		let row = rows.find((r) => Math.abs(r.y - y) <= Math.max(1.5, size * 0.3));
		if (!row) rows.push((row = { y, pieces: [] }));
		row.pieces.push({ x, end: x + (it.width ?? s.length * size * 0.5), s, size, bold: !!(bold && it.fontName && bold(it.fontName)), eol: !!it.hasEOL });
	}
	const width = pageWidth > 0 ? pageWidth : Math.max(1, ...rows.flatMap((r) => r.pieces.map((p) => p.end)));
	const out: (PdfLine & { right: number })[] = [];
	for (const r of rows.sort((p, q) => q.y - p.y)) {
		const ps = r.pieces.sort((p, q) => p.x - q.x);
		const first = out.length;
		let seg: Piece[] = [];
		const emit = () => {
			if (!seg.length) return;
			let text = "";
			let chars = 0;
			let sizeSum = 0;
			let boldChars = 0;
			for (let i = 0; i < seg.length; i++) {
				const p = seg[i];
				if (i && needsSpace(text, p.s, p.x - seg[i - 1].end, p.size)) text += " ";
				text += p.s;
				const n = p.s.trim().length;
				chars += n;
				sizeSum += p.size * n;
				if (p.bold) boldChars += n;
			}
			text = text.replace(/\s+/g, " ").trim();
			if (text)
				out.push({
					page,
					text,
					size: Math.round((chars ? sizeSum / chars : seg[0].size) * 10) / 10,
					top: pageHeight > 0 ? Math.min(1, Math.max(0, 1 - r.y / pageHeight)) : 0.5,
					bold: chars > 0 && boldChars / chars > 0.6,
					x: seg[0].x / width,
					right: seg[seg.length - 1].end / width,
				});
			seg = [];
		};
		for (const p of ps) {
			const last = seg[seg.length - 1];
			// PDF.js ends a column's line with hasEOL; failing that, a gutter is wider than a word space.
			if (last && (last.eol || p.x - last.end > Math.max(last.size, p.size) * 1.5)) emit();
			seg.push(p);
		}
		emit();
		for (let i = first; i < out.length; i++) out[i].alone = out.length - first === 1;
	}
	// Two columns: many lines start right of the middle, many end left of it. Read the left one first.
	const rightStarts = out.filter((l) => l.x! >= 0.45).length;
	const leftEnds = out.filter((l) => l.right <= 0.55).length;
	const twoColumns = rightStarts >= 3 && leftEnds >= 3;
	for (const l of out) l.column = twoColumns && l.x! >= 0.45 ? 1 : 0;
	return out
		.map((l, i) => ({ l, i }))
		.sort((a, b) => a.l.column! - b.l.column! || a.i - b.i)
		.map(({ l: { right: _right, ...l } }) => l);
}

const CJK_NUM = "一二三四五六七八九十百零〇两";
/** Numbering a heading starts with, and the level it implies when it does. */
export function numberingLevel(text: string): number | undefined {
	const t = text.trim();
	if (new RegExp(`^(第[${CJK_NUM}\\d]+[部篇编])`).test(t) || /^part\s+([ivxlc]+|\d+)\b/i.test(t)) return 1;
	if (new RegExp(`^第[${CJK_NUM}\\d]+章`).test(t) || /^(chapter|chap\.)\s+\S+/i.test(t)) return 1;
	if (new RegExp(`^第[${CJK_NUM}\\d]+节`).test(t)) return 2;
	const m = t.match(/^(\d{1,2}(?:\.\d{1,2}){0,3})\.?\s+\S/);
	if (m) return m[1].split(".").length;
	if (new RegExp(`^[${CJK_NUM}]+、`).test(t)) return 2;
	return undefined;
}

/** Written in capitals (at least a few letters, none lower case). */
function isCaps(t: string): boolean {
	const letters = t.replace(/[^A-Za-z]/g, "");
	return letters.length >= 3 && letters === letters.toUpperCase();
}

const TOC_ENTRY = /(\.{3,}|…{2,}|·{3,}|\s{3,})\s*\d+\s*$/;

function looksLikeText(t: string): boolean {
	// A heading is short and is not a sentence that runs on, a bare number, or a caption.
	if (t.length < 2 || t.length > 90) return false;
	if (/^[\d\s.,:;()\-–—/]+$/.test(t)) return false;
	if (/^(figure|fig\.|table|图|表)\s*\d/i.test(t)) return false;
	if (/[,，;；]$/.test(t)) return false;
	// Author lists and addresses on a paper's first page.
	if (/@|https?:\/\//.test(t) || (t.match(/[,，]/g)?.length ?? 0) >= 3) return false;
	return true;
}

export function detectHeadings(lines: PdfLine[], pages: number): Heading[] {
	if (!lines.length) return [];
	// Body size: the size carrying the most characters.
	const weight = new Map<number, number>();
	for (const l of lines) weight.set(l.size, (weight.get(l.size) ?? 0) + l.text.length);
	const body = [...weight.entries()].sort((a, b) => b[1] - a[1])[0][0];

	// Running headers and footers: the same text (digits ignored) near the edge of many pages.
	const edge = new Map<string, Set<number>>();
	const key = (t: string) => t.replace(/\d+/g, "#").toLowerCase();
	for (const l of lines) if (l.top < 0.1 || l.top > 0.9) (edge.get(key(l.text)) ?? edge.set(key(l.text), new Set()).get(key(l.text))!).add(l.page);
	const running = new Set([...edge.entries()].filter(([, ps]) => ps.size >= Math.max(3, pages * 0.2)).map(([k]) => k));

	type Cand = PdfLine & { numbered?: number; lastTop: number };
	const cands: Cand[] = [];
	for (let i = 0; i < lines.length; i++) {
		const l = lines[i];
		if (running.has(key(l.text)) || TOC_ENTRY.test(l.text)) continue;
		const numbered = numberingLevel(l.text);
		const larger = l.size >= body * 1.15;
		const boldNumbered = !!l.bold && numbered !== undefined && l.size >= body * 0.98;
		const chapterWord = numbered === 1 && /^(第|chapter|part)/i.test(l.text) && l.size >= body;
		// A bold line set apart at body size, not a sentence: a run-in heading of reports and handouts.
		const boldLine = !!l.bold && !!l.alone && l.size >= body * 0.98 && l.text.length <= 80 && !/[.。!?！？]$/.test(l.text);
		if (!(larger || boldNumbered || chapterWord || boldLine) || !looksLikeText(l.text)) continue;
		// A heading broken over two lines: same page, column, size and weight, right below.
		const prev = cands[cands.length - 1];
		if (
			prev &&
			prev.page === l.page &&
			prev.column === l.column &&
			prev.size === l.size &&
			!!prev.bold === !!l.bold &&
			isCaps(prev.text) === isCaps(l.text) &&
			l.top > prev.lastTop &&
			l.top - prev.lastTop <= 0.05 &&
			prev.text.length + l.text.length < 120 &&
			numbered === undefined
		) {
			prev.text = /[A-Za-z]-$/.test(prev.text) ? prev.text.slice(0, -1) + l.text : `${prev.text} ${l.text}`;
			prev.lastTop = l.top;
			continue;
		}
		cands.push({ ...l, numbered, lastTop: l.top });
	}
	for (const c of cands) c.text = c.text.replace(/\s*[:：]$/, "");
	// Too many candidates means the "large" text is ordinary (slides, posters): nothing reliable.
	if (cands.length < 2 || cands.length > Math.max(12, pages * 4)) return [];

	// Sizes rank into levels, larger first; at most four.
	const sizes = [...new Set(cands.map((c) => c.size))].sort((a, b) => b - a);
	const merged: number[] = [];
	for (const s of sizes) if (!merged.length || merged[merged.length - 1] - s > Math.max(0.6, body * 0.06)) merged.push(s);
	const group = (s: number) => {
		const i = merged.findIndex((m) => s >= m - Math.max(0.6, body * 0.06));
		return i < 0 ? merged.length - 1 : i;
	};
	// Within one size, bold ranks above regular.
	// Within one size, bold ranks above regular, and ALL CAPS above mixed case.
	const style = (c: Cand) => group(c.size) * 4 + (c.bold ? 0 : 2) + (isCaps(c.text) ? 0 : 1);
	const styles = [...new Set(cands.map(style))].sort((a, b) => a - b);
	const sizeLevel = (c: Cand) => Math.min(4, styles.indexOf(style(c)) + 1);
	// The title on the first page is the document's, not a chapter: drop a lone largest line there.
	const top = merged[0];
	const topStyle = Math.min(...cands.map(style));
	const atTop = cands.filter((c) => style(c) === topStyle && c.size >= top - 0.6);
	const dropTitle = atTop.length === 1 && atTop[0].page <= 2 && cands.length > 2;

	const out: Heading[] = [];
	for (const c of cands) {
		if (dropTitle && c === atTop[0]) continue;
		// Numbering says more than size: "2.3" is a second level whatever its font.
		const level = c.numbered ?? sizeLevel(c) - (dropTitle ? 1 : 0);
		out.push({ level: Math.max(1, level), title: c.text, unit: c.page });
	}
	return out;
}

/** The document's title from its first page: the largest text there, clearly above the body size. */
export function detectTitle(lines: PdfLine[]): string {
	const weight = new Map<number, number>();
	for (const l of lines) weight.set(l.size, (weight.get(l.size) ?? 0) + l.text.length);
	if (!weight.size) return "";
	const body = [...weight.entries()].sort((a, b) => b[1] - a[1])[0][0];
	const first = lines.filter((l) => l.page === lines[0].page && l.top < 0.6);
	const max = Math.max(...first.map((l) => l.size));
	if (!(max >= body * 1.2)) return "";
	const parts: string[] = [];
	let lastTop = -1;
	for (const l of first) {
		if (Math.abs(l.size - max) > 0.6) continue;
		if (lastTop >= 0 && l.top - lastTop > 0.08) break;
		parts.push(l.text);
		lastTop = l.top;
	}
	const t = parts.join(" ").replace(/\s+/g, " ").trim();
	return t.length >= 3 && t.length <= 200 ? t : "";
}

/** Metadata titles that name a file or a tool rather than the document. */
export function junkTitle(t: string): boolean {
	return !t.trim() || /\.(dvi|tex|pdf|docx?|pptx?|indd|qxd)$/i.test(t.trim()) || /^(microsoft (word|powerpoint)\s*-|untitled|unknown$)/i.test(t.trim());
}

