import { L } from "../i18n";
/**
 * The Markdown DSL.
 *
 * Interactive Block — a fenced block whose source stays small and human readable; the
 * live state (answers, feedback) is held by the Block Runtime and persisted in plugin data.
 *
 *     ```icap-ask
 *     id: q7f3a2
 *     kind: recall
 *     ---
 *     Explain RAII in your own words.
 *     ```
 *
 * Kept results are written back as plain Markdown + native callouts, so they read well even
 * without this plugin:
 *
 *     > [!gloss] RAII
 *     > …explanation…
 */
import { splitLines } from "./text";
import { UI_LANG } from "../genui/widget";

export const ASK_LANG = "icap-ask";
/** The fence language before the plugin was renamed ICPA → ICAP. Still read (and rendered), never written. */
export const LEGACY_ASK_LANG = "icpa-ask";
/** Either fence language, for matching notes written before or after the rename. */
export const ASK_LANG_RE = "(?:icap|icpa)-ask";

export interface AskSource {
	id: string;
	kind: string;
	body: string;
	/** Every `key: value` line above the `---`. */
	header?: Record<string, string>;
}

/**
 * An authored block: an ```icap-ask fence written by a person (e.g. in the guide) rather than
 * inserted by the runtime. It starts with its first question already on the page.
 *
 *   kind: quiz    body = question, then `- [ ] option` lines   (`choose: many` for multi-select)
 *   kind: recall  body = what to explain from memory
 *   kind: agent   body = a request the agent carries out when the learner says go
 */
export interface AuthoredBlock {
	kind: "quiz" | "recall" | "agent";
	topic: string;
	question: string;
	options: { id: string; label: string }[];
	multi: boolean;
	start: string;
}

export function parseAuthored(src: AskSource): AuthoredBlock | null {
	const h = src.header ?? {};
	if (!/^(yes|true)$/i.test(h.authored ?? "")) return null;
	if (src.kind !== "quiz" && src.kind !== "recall" && src.kind !== "agent") return null;
	const lines = src.body.split("\n");
	const options: { id: string; label: string }[] = [];
	const question: string[] = [];
	for (const l of lines) {
		const m = l.match(/^\s*[-*]\s+\[[ xX]?\]\s+(.+)$/);
		if (m && src.kind === "quiz") options.push({ id: String.fromCharCode(97 + options.length), label: m[1].trim() });
		else if (!options.length) question.push(l);
	}
	const q = question.join("\n").trim();
	if (!q || (src.kind === "quiz" && options.length < 2)) return null;
	return {
		kind: src.kind,
		topic: h.topic?.trim() || q.split("\n")[0].replace(/[*_`]/g, "").slice(0, 60),
		question: q,
		options,
		multi: /^(many|multi|multiple)$/i.test(h.choose ?? ""),
		start: h.start?.trim() || "go ahead",
	};
}

export function newId(prefix = ""): string {
	return prefix + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
}

export function fenceFor(body: string): string {
	const runs = body.match(/`{3,}/g) || [];
	const longest = runs.reduce((m, r) => Math.max(m, r.length), 2);
	return "`".repeat(Math.max(3, longest + 1));
}

export function serializeAsk(src: AskSource): string {
	const body = src.body.trim();
	const f = fenceFor(body);
	return `${f}${ASK_LANG}\nid: ${src.id}\nkind: ${src.kind}\n---\n${body}\n${f}`;
}

export function parseAskSource(source: string): AskSource {
	const lines = source.split("\n");
	const header: Record<string, string> = {};
	let i = 0;
	for (; i < lines.length; i++) {
		const l = lines[i];
		if (l.trim() === "---") {
			i++;
			break;
		}
		const m = l.match(/^\s*([a-z_]+)\s*:\s*(.*)$/i);
		if (m) header[m[1].toLowerCase()] = m[2].trim();
		else break;
	}
	return { id: header.id ?? "", kind: header.kind ?? "agent", body: lines.slice(i).join("\n").trim(), header };
}

/** Locate a whole ```icap-ask fence with the given id. Range covers the fence lines only. */
export function findAskBlock(text: string, id: string): { from: number; to: number } | null {
	const lines = splitLines(text);
	for (let i = 0; i < lines.length; i++) {
		const open = lines[i].text.match(new RegExp(`^(\`{3,}|~{3,})\\s*${ASK_LANG_RE}\\s*$`));
		if (!open) continue;
		const fence = open[1];
		let j = i + 1;
		let hasId = false;
		for (; j < lines.length; j++) {
			if (lines[j].text.trim() === fence) break;
			if (lines[j].text.trim() === `id: ${id}`) hasId = true;
		}
		if (hasId && j < lines.length) return { from: lines[i].from, to: lines[j].to };
		i = j;
	}
	return null;
}

const FENCE_OPEN = (lang: string) => new RegExp(`^\\s*(\`{3,}|~{3,})\\s*${lang}\\b`);

/** Every ICAP block in a note: each ```icap-ask (or legacy ```icpa-ask) fence, its fence lines included. */
export function askFenceRanges(text: string): { from: number; to: number }[] {
	const lines = splitLines(text);
	const out: { from: number; to: number }[] = [];
	for (let i = 0; i < lines.length; i++) {
		const open = lines[i].text.match(FENCE_OPEN(ASK_LANG_RE));
		if (!open) continue;
		let j = i + 1;
		while (j < lines.length && lines[j].text.trim() !== open[1]) j++;
		out.push({ from: lines[i].from, to: lines[Math.min(j, lines.length - 1)].to });
		i = j;
	}
	return out;
}

const countOpenings = (md: string, lang: string) => md.split("\n").filter((l) => FENCE_OPEN(lang).test(l)).length;

/**
 * Why an edit the agent proposes (propose_edit: replace the first `find` in `text` with `replace`;
 * an empty `find` appends) must be refused, if it must:
 * - "visual": it adds an ```icap-ui visual. Visuals go in a reply or in a note the agent creates,
 *   never into the learner's existing notes;
 * - "block": it touches an ICAP block (an ```icap-ask fence), or writes a new one. Those are the plugin's.
 */
export function editProblem(text: string, find: string, replace: string): "visual" | "block" | undefined {
	if (countOpenings(replace, UI_LANG) > countOpenings(find, UI_LANG)) return "visual";
	if (countOpenings(replace, ASK_LANG_RE) > countOpenings(find, ASK_LANG_RE)) return "block";
	if (!find) return undefined;
	const i = text.indexOf(find);
	if (i < 0) return undefined;
	if (askFenceRanges(text).some((r) => i < r.to && i + find.length > r.from)) return "block";
	return undefined;
}

function quote(md: string): string {
	return md
		.trim()
		.split("\n")
		.map((l) => (l.length ? `> ${l}` : ">"))
		.join("\n");
}

/** Whitespace collapsed to single spaces: how a topic is written in a title and in a comment. */
function oneLine(s: string): string {
	return s.replace(/\s+/g, " ").trim();
}

/**
 * A kept explanation. `record` (format 2) puts a `<!-- icap gloss … -->` comment above the callout:
 * the day it was kept, the full term, and which follow-ups about depth the learner asked for.
 */
export function glossCallout(term: string, body: string, sources: string[], record?: { id: string; date: string; depth?: Depth[] }): string {
	const title = oneLine(term);
	const short = title.length > 60 ? title.slice(0, 57) + "…" : title;
	let md = body.trim();
	if (sources.length) md += `\n\n*${L("Sources", "来源")}: ${sources.join(", ")}*`;
	const callout = `> [!gloss] ${short}\n${quote(md)}`;
	if (!record) return callout;
	return `${evidenceComment({ kind: "gloss", id: record.id, date: record.date, topic: title, depth: record.depth?.length ? record.depth : undefined })}\n${callout}`;
}

export function calloutBlock(type: string, title: string, body: string): string {
	return `> [!${type}] ${title}\n${quote(body)}`;
}

export type Verdict = "holds" | "partly" | "reconsider";
/** A gloss follow-up about depth: *Plainly.* (plainer) or *Deeper.* (deeper). */
export type Depth = "plainer" | "deeper";

/**
 * What a kept record says about itself, so that the note stays the learning record (FORMAT.md):
 * what it was about, when it was kept and, for a recall, check or quiz, how it went. Recalls,
 * checks and quizzes write the date and verdict twice — in the callout title for the reader
 * (`· 2026-11-06 · ✓`) and in an HTML comment on the line above for tools
 * (`<!-- icap recall id=q7f3a2 date=2026-11-06 verdict=holds topic="RAII" -->`). A gloss has
 * only the comment.
 */
export interface Evidence {
	kind: "recall" | "check" | "quiz" | "gloss";
	id: string;
	/** ISO calendar date (local), the day the block was kept. */
	date: string;
	/** What the record is about, in the learner's or the note's words (format 2). */
	topic?: string;
	verdict?: Verdict;
	/** Quiz: how the answered questions went. */
	counts?: { holds: number; partly: number; reconsider: number };
	/** Gloss: the follow-ups about depth the learner asked for. */
	depth?: Depth[];
	/** Recall: how many paragraphs above the comment are the learner's answer, when more than one. */
	paragraphs?: number;
}

/** The local calendar date as `YYYY-MM-DD`. */
export function isoDate(ms = Date.now()): string {
	const d = new Date(ms);
	const p = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * A quoted comment value (FORMAT.md, "The comment"): `\` escapes `\`, `"` and `>`, so the value
 * never contains a bare quote or the `-->` that would end the comment.
 */
export function quoteValue(s: string): string {
	return `"${oneLine(s).replace(/[\\">]/g, (c) => "\\" + c)}"`;
}

export function evidenceComment(e: Evidence): string {
	const f = [`id=${e.id}`, `date=${e.date}`];
	if (e.verdict) f.push(`verdict=${e.verdict}`);
	if (e.counts) f.push(`holds=${e.counts.holds}`, `partly=${e.counts.partly}`, `reconsider=${e.counts.reconsider}`);
	if (e.depth?.length) f.push(`depth=${e.depth.join(",")}`);
	if (e.paragraphs && e.paragraphs > 1) f.push(`paragraphs=${e.paragraphs}`);
	if (e.topic && oneLine(e.topic)) f.push(`topic=${quoteValue(e.topic)}`);
	return `<!-- icap ${e.kind} ${f.join(" ")} -->`;
}

const EVIDENCE_RE = /^<!--\s*icap\s+(recall|check|quiz|gloss)\s+(.*?)\s*-->\s*$/;

/** Whether a line is a record comment (`<!-- icap recall … -->` and the like). */
export function isEvidenceComment(line: string): boolean {
	return EVIDENCE_RE.test(line);
}
/** One `key=value` field: a bare value has no spaces or quotes; a quoted one takes `\` escapes. */
const FIELD_RE = /([A-Za-z][\w-]*)=(?:"((?:[^"\\]|\\.)*)"|([^\s"]*))/g;

/** Reads a record comment back; unknown keys are ignored so later versions stay readable. */
export function parseEvidenceComment(line: string): Evidence | null {
	const m = line.trim().match(EVIDENCE_RE);
	if (!m) return null;
	const kv: Record<string, string> = {};
	for (const f of m[2].matchAll(FIELD_RE)) kv[f[1]] = f[2] !== undefined ? f[2].replace(/\\(.)/g, "$1") : f[3];
	if (!kv.id || !/^\d{4}-\d{2}-\d{2}$/.test(kv.date ?? "")) return null;
	const e: Evidence = { kind: m[1] as Evidence["kind"], id: kv.id, date: kv.date };
	if (kv.topic?.trim()) e.topic = kv.topic.trim();
	if (kv.verdict === "holds" || kv.verdict === "partly" || kv.verdict === "reconsider") e.verdict = kv.verdict;
	if (kv.holds !== undefined || kv.partly !== undefined || kv.reconsider !== undefined) {
		const n = (s?: string) => Math.max(0, parseInt(s ?? "0", 10) || 0);
		e.counts = { holds: n(kv.holds), partly: n(kv.partly), reconsider: n(kv.reconsider) };
	}
	const depth = (kv.depth ?? "").split(",").filter((d): d is Depth => d === "plainer" || d === "deeper");
	if (depth.length) e.depth = depth;
	const paras = parseInt(kv.paragraphs ?? "", 10);
	if (paras > 1) e.paragraphs = paras;
	return e;
}

/**
 * A kept callout that carries its evidence: the comment line, then the callout whose title ends
 * with the date and the verdict mark (✓ held, ≈ partly, ? reconsider).
 */
export function evidenceCallout(type: "feedback" | "practice", title: string, e: Evidence, body: string): string {
	const glyph = verdictGlyph(e.verdict);
	const t = `${title.replace(/\s+/g, " ").trim()} · ${e.date}${glyph ? ` · ${glyph}` : ""}`;
	return `${evidenceComment(e)}\n${calloutBlock(type, t, body)}`;
}

/**
 * A finished request block kept as plain Markdown:
 *
 *     > [!request] Learning path for C++
 *     > **Request:** build a learning path from Sources/
 *     >
 *     > Created a path and 12 notes…
 *     >
 *     > **Files:** created [[Learning/Path|Path]] · changed [[C++]] · deleted old.md
 */
export function requestRecord(topic: string, rounds: { request: string; reply: string }[], files: { kind: string; path: string }[]): string {
	const parts: string[] = [];
	for (const r of rounds) {
		if (r.request.trim()) parts.push(`**${L("Request", "请求")}:** ${r.request.trim()}`);
		if (r.reply.trim()) parts.push(r.reply.trim());
	}
	const link = (p: string) => {
		const target = p.replace(/\.md$/, "");
		const name = target.split("/").pop()!;
		return /\.md$/.test(p) ? (target === name ? `[[${name}]]` : `[[${target}|${name}]]`) : `[[${p}]]`;
	};
	const groups: [string, string][] = [
		["created", L("created", "新建")],
		["edited", L("changed", "修改")],
		["deleted", L("deleted", "删除")],
	];
	const listed = groups
		.map(([kind, word]) => {
			const ps = files.filter((f) => f.kind === kind).map((f) => (kind === "deleted" ? f.path : link(f.path)));
			return ps.length ? `${word} ${ps.join(", ")}` : "";
		})
		.filter(Boolean);
	if (listed.length) parts.push(`**${L("Files", "文件")}:** ${listed.join(" · ")}`);
	return calloutBlock("request", topic.replace(/\s+/g, " ").trim() || L("Request", "请求"), parts.join("\n\n") || "—");
}

/** Split a trailing "Sources: [[A]], [[B]]" line produced by the agent. */
export function splitSources(md: string): { body: string; sources: string[] } {
	const lines = md.trimEnd().split("\n");
	const last = lines[lines.length - 1] ?? "";
	const m = last.match(/^\s*\*?(?:Sources?|来源|参考)\s*[:：]\s*(.+?)\*?\s*$/i);
	if (!m) return { body: md.trim(), sources: [] };
	const sources = (m[1].match(/\[\[[^\]]+\]\]|https?:\/\/\S+/g) || []).map((s) => s.trim());
	if (!sources.length) return { body: md.trim(), sources: [] };
	return { body: lines.slice(0, -1).join("\n").trim(), sources };
}

export function verdictGlyph(v?: string | null): string {
	if (v === "holds") return "✓";
	if (v === "partly") return "≈";
	if (v === "reconsider") return "?";
	return "";
}

const OPTION_PREFIX = /^\s*(?:\(\s*[a-hA-H]\s*\)|[a-hA-H][).:]|[a-hA-H]\s+[-–—])\s*/;
const LISTED_OPTION = /^\s*(?:[-*+]\s+)?(?:\(\s*[a-hA-H]\s*\)|[a-hA-H][).:])\s+\S/;

/** Models sometimes letter their own options ("(a) …"); the UI already letters them. */
export function tidyOptionLabel(label: string): string {
	const stripped = label.replace(OPTION_PREFIX, "");
	return stripped.trim() ? stripped.trim() : label.trim();
}

/**
 * When options are passed separately, a trailing lettered list inside the question is a
 * duplicate of them. Remove it so the options appear once, as interactive choices.
 */
export function tidyQuestion(question: string, optionCount: number): string {
	if (optionCount < 2) return question.trim();
	const lines = question.trimEnd().split("\n");
	let i = lines.length;
	while (i > 0 && LISTED_OPTION.test(lines[i - 1])) i--;
	if (lines.length - i < 2) return question.trim();
	return lines.slice(0, i).join("\n").trim() || question.trim();
}

/** Replace an ```icap-ask block; with an empty insert, remove it and close the gap. */
export function askReplacement(text: string, id: string, insert: string): { from: number; to: number; insert: string } | null {
	const r = findAskBlock(text, id);
	if (!r) return null;
	if (insert) return { from: r.from, to: r.to, insert };
	// Removal: close the gap so the surrounding content is separated by exactly one blank line.
	let from = r.from;
	let to = r.to;
	while (from > 0 && text[from - 1] === "\n") from--;
	while (to < text.length && text[to] === "\n") to++;
	const glue = from === 0 ? "" : to >= text.length ? "\n" : "\n\n";
	return { from, to, insert: glue };
}

/**
 * An extension's dialog title as Markdown: the first line bold, the rest as written (bold can't span
 * paragraphs, e.g. a permission gate's "Dangerous command:\n\n  rm -rf x\n\nAllow?"); indented lines stay code.
 */
export function dialogTitle(title: string): string {
	const t = title.trim();
	if (!t) return "";
	const [first, ...rest] = t.split("\n");
	const body = rest
		.join("\n")
		.split("\n")
		.map((l) => (/^\s{2,}\S/.test(l) ? "`" + l.trim().replace(/`/g, "'") + "`" : l))
		.join("\n")
		.trim();
	return [`**${first.trim()}**`, body].filter(Boolean).join("\n\n");
}
