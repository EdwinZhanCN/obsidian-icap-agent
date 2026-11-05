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

function quote(md: string): string {
	return md
		.trim()
		.split("\n")
		.map((l) => (l.length ? `> ${l}` : ">"))
		.join("\n");
}

export function glossCallout(term: string, body: string, sources: string[]): string {
	const title = term.replace(/\s+/g, " ").trim();
	const short = title.length > 60 ? title.slice(0, 57) + "…" : title;
	let md = body.trim();
	if (sources.length) md += `\n\n*${L("Sources", "来源")}: ${sources.join(", ")}*`;
	return `> [!gloss] ${short}\n${quote(md)}`;
}

export function calloutBlock(type: string, title: string, body: string): string {
	return `> [!${type}] ${title}\n${quote(body)}`;
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
