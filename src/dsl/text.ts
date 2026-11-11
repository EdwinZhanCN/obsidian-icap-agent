/**
 * Pure Markdown-structure helpers over raw note text (offset based). Kept free of
 * Obsidian/CodeMirror imports so they can be unit tested.
 */

export interface Line {
	n: number;
	from: number;
	to: number; // exclusive of the newline
	text: string;
}

export function splitLines(text: string): Line[] {
	const lines: Line[] = [];
	let from = 0;
	let n = 0;
	for (const raw of text.split("\n")) {
		lines.push({ n, from, to: from + raw.length, text: raw });
		from += raw.length + 1;
		n++;
	}
	return lines;
}

export function lineAt(lines: Line[], offset: number): Line {
	let lo = 0;
	let hi = lines.length - 1;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (lines[mid].from <= offset) lo = mid;
		else hi = mid - 1;
	}
	return lines[lo];
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const FENCE = /^\s*(`{3,}|~{3,})/;
const LIST = /^(\s*)([-*+]|\d+[.)])\s+/;

export function frontmatterEnd(lines: Line[]): number {
	if (lines[0]?.text !== "---") return -1;
	for (let i = 1; i < lines.length; i++) if (lines[i].text === "---" || lines[i].text === "...") return i;
	return -1;
}

/** Map of line index → true for lines inside fenced code (including fence lines). */
export function fencedLines(lines: Line[]): boolean[] {
	const inside = new Array<boolean>(lines.length).fill(false);
	let open: string | null = null;
	for (let i = 0; i < lines.length; i++) {
		const m = lines[i].text.match(FENCE);
		if (open) {
			inside[i] = true;
			if (m && m[1][0] === open[0] && m[1].length >= open.length && lines[i].text.trim() === m[1]) open = null;
		} else if (m) {
			open = m[1];
			inside[i] = true;
		}
	}
	return inside;
}

export function headingLevel(line: string): number {
	const m = line.match(HEADING);
	return m ? m[1].length : 0;
}

export function headingTrail(text: string, offset: number): string[] {
	const lines = splitLines(text);
	const fenced = fencedLines(lines);
	const at = lineAt(lines, offset).n;
	const trail: { level: number; title: string }[] = [];
	for (let i = 0; i <= at; i++) {
		if (fenced[i]) continue;
		const m = lines[i].text.match(HEADING);
		if (!m) continue;
		const level = m[1].length;
		while (trail.length && trail[trail.length - 1].level >= level) trail.pop();
		trail.push({ level, title: m[2].trim() });
	}
	return trail.map((t) => t.title);
}

function isBlank(s: string) {
	return s.trim() === "";
}

/** The paragraph (run of non-blank, non-heading lines) containing the offset. */
export function paragraphBounds(text: string, offset: number): { from: number; to: number } {
	const lines = splitLines(text);
	const fenced = fencedLines(lines);
	const at = lineAt(lines, offset).n;
	let start = at;
	let end = at;
	const stop = (i: number) => isBlank(lines[i].text) || headingLevel(lines[i].text) > 0 || fenced[i] !== fenced[at];
	if (stop(at) && !fenced[at]) return { from: lines[at].from, to: lines[at].to };
	while (start > 0 && !stop(start - 1)) start--;
	while (end < lines.length - 1 && !stop(end + 1)) end++;
	return { from: lines[start].from, to: lines[end].to };
}

/**
 * Where a gloss for a selection ending at `offset` should open: after the list item,
 * paragraph, table or code fence that contains it. Returns the offset of the END of
 * that block's last line.
 */
export function glossAnchor(text: string, offset: number): number {
	const lines = splitLines(text);
	const fenced = fencedLines(lines);
	let i = lineAt(lines, offset).n;
	if (fenced[i]) {
		while (i < lines.length - 1 && fenced[i + 1]) i++;
		return lines[i].to;
	}
	const list = lines[i].text.match(LIST);
	if (list) {
		const indent = list[1].length;
		while (i < lines.length - 1) {
			const next = lines[i + 1].text;
			if (isBlank(next) || LIST.test(next) || headingLevel(next) > 0) break;
			if (next.match(/^\s*/)![0].length <= indent) break;
			i++;
		}
		return lines[i].to;
	}
	while (i < lines.length - 1) {
		const next = lines[i + 1].text;
		if (isBlank(next) || headingLevel(next) > 0 || fenced[i + 1]) break;
		if (LIST.test(next) && !LIST.test(lines[i].text)) break;
		i++;
	}
	return lines[i].to;
}

/** Section = from the heading above the offset to just before the next heading of same or higher level. */
export function sectionBounds(text: string, offset: number): { from: number; to: number; title: string | null; level: number } {
	const lines = splitLines(text);
	const fenced = fencedLines(lines);
	const at = lineAt(lines, offset).n;
	const fmEnd = frontmatterEnd(lines);
	let start = -1;
	let level = 0;
	for (let i = at; i >= 0; i--) {
		if (fenced[i]) continue;
		const l = headingLevel(lines[i].text);
		if (l) {
			start = i;
			level = l;
			break;
		}
	}
	let end = lines.length - 1;
	for (let i = Math.max(at, start) + 1; i < lines.length; i++) {
		if (fenced[i]) continue;
		const l = headingLevel(lines[i].text);
		if (l && (level === 0 || l <= level)) {
			end = i - 1;
			break;
		}
	}
	while (end > Math.max(start, 0) && isBlank(lines[end].text)) end--;
	const fromLine = start === -1 ? Math.max(fmEnd + 1, 0) : start;
	const title = start === -1 ? null : lines[start].text.replace(HEADING, "$2").trim();
	return { from: lines[fromLine].from, to: lines[end].to, title, level };
}

export function stripFrontmatter(text: string): { body: string; frontmatter: string } {
	const lines = splitLines(text);
	const end = frontmatterEnd(lines);
	if (end === -1) return { body: text, frontmatter: "" };
	return {
		frontmatter: lines.slice(1, end).map((l) => l.text).join("\n"),
		body: text.slice(lines[end].to + 1),
	};
}

/** Trim a long string around a focus offset, keeping whole lines where possible. */
export function window(text: string, focusFrom: number, focusTo: number, budget: number): string {
	if (text.length <= budget) return text;
	const half = Math.max(0, Math.floor((budget - (focusTo - focusFrom)) / 2));
	let from = Math.max(0, focusFrom - half);
	let to = Math.min(text.length, focusTo + half);
	const nl = text.lastIndexOf("\n", from);
	if (nl !== -1 && from - nl < 200) from = nl + 1;
	const nl2 = text.indexOf("\n", to);
	if (nl2 !== -1 && nl2 - to < 200) to = nl2;
	return (from > 0 ? "…\n" : "") + text.slice(from, to) + (to < text.length ? "\n…" : "");
}

/**
 * During streaming, close unbalanced fences and display math so partially received
 * Markdown renders as the shape it is going to have, instead of swallowing the page.
 */
export function balanceStreamingMarkdown(md: string): string {
	let out = md;
	const lines = splitLines(md);
	let open: string | null = null;
	for (const l of lines) {
		const m = l.text.match(FENCE);
		if (!m) continue;
		if (!open) open = m[1];
		else if (m[1][0] === open[0] && l.text.trim() === m[1]) open = null;
	}
	if (open) out += `\n${open}`;
	const displayMath = (out.match(/\$\$/g) || []).length;
	if (displayMath % 2 === 1) out += "\n$$";
	return out;
}

/**
 * A short title from free text (a request, a concept): one line, about `max` characters. It never
 * cuts a `[[link]]` in two: a link that crosses the cut stays whole when it ends soon after, or the
 * title ends before it.
 */
export function shortTitle(s: string, max = 40): string {
	const t = s.replace(/\s+/g, " ").trim();
	if (t.length <= max) return t;
	let cut = max - 2;
	const open = t.lastIndexOf("[[", cut);
	if (open >= 0 && t.indexOf("]]", open) === -1) cut = open;
	else if (open >= 0 && t.indexOf("]]", open) + 2 > cut) {
		const end = t.indexOf("]]", open) + 2;
		cut = end - cut <= 30 ? end : open;
	}
	const head = t.slice(0, cut).trimEnd();
	return head.length === t.length ? head : `${head}…`;
}
