import { parseEvidenceComment, type Depth, type Verdict } from "./blocks";
import { TASK_MARK, linkPath } from "./task-notes";

/**
 * The reference reader for FORMAT.md: what a tool reading a vault sees in one note. Pure, so other
 * implementations (the Hub) can test against the same fixtures (test/fixtures/format/).
 */

export interface NoteRecords {
	/** The note says `generated-by: icap-agent` (or legacy `icpa-agent`): its text is not evidence. */
	agentWritten: boolean;
	records: KeptRecord[];
	/** Ids of live ```icap-ask blocks: in progress, nothing to read from them. */
	live: string[];
	/** Format 4: the note is a task note (`icap: task`): one request or note-making task, as its properties say. */
	task?: TaskRecord;
}

export interface TaskRecord {
	id: string;
	/** As written. Known values: draft, queued, running, needs-you, review, done, failed, cancelled. */
	status: string;
	/** Link targets (vault paths without `.md`) of the notes the task is about. */
	source: string[];
	/** Link targets of the files the task created or changed. */
	changed: string[];
	started?: string;
	ended?: string;
	/** US dollars for all runs of the task, or "unknown". Absent on a task that has not ended and not yet reached a model. */
	cost?: number | "unknown";
	/** Tokens in and out, cached ones included. */
	tokens?: number;
	/** Share of the prompt read from the cache, 0–100. */
	cache?: number;
}

export interface KeptRecord {
	kind: "recall" | "check" | "quiz" | "gloss" | "request";
	/** Callout type as written: feedback, practice, gloss, request. */
	callout: string;
	/** The callout title as written (for people; may have been edited). */
	title: string;
	/** 1-based line of the callout's first line. */
	line: number;
	/** What it is about: the comment's topic; for older records, the title without date and mark. */
	topic: string;
	id?: string;
	date?: string;
	verdict?: Verdict;
	counts?: { holds: number; partly: number; reconsider: number };
	depth?: Depth[];
	/** Recall and check: the learner's words the record judges (the paragraphs directly above). */
	learnerText?: string;
	/** Written before format 1: no comment, so no id, date or verdict. */
	legacy?: true;
}

const CALLOUT_RE = /^>\s*\[!(feedback|practice|gloss|request)\][+-]?\s*(.*)$/i;
const GENERATED_BY_RE = /^generated-by:\s*["']?(icap-agent|icpa-agent)["']?\s*$/m;
/** The prefix a quiz title carried before the topic was in a comment, in either interface language. */
const QUIZ_PREFIX_RE = /^(?:Understanding check|理解检验)\s+—\s+/;
const LIVE_RE =/^(`{3,}|~{3,})\s*(?:icap-ask|icpa-ask)\s*$/;

/** The title without the ` · date` and ` · mark` a format 1+ title ends with. */
function titleTopic(title: string): string {
	return title.replace(/(?:\s·\s(?:\d{4}-\d{2}-\d{2}|[✓≈?]))+\s*$/u, "").trim();
}

/** The `n` paragraphs that end on the line before `end` (blank lines separate paragraphs). */
function paragraphsAbove(lines: string[], end: number, n: number): string | undefined {
	let i = end - 1;
	while (i >= 0 && !lines[i].trim()) i--;
	if (i < 0) return undefined;
	const stop = i;
	let left = n;
	for (; i >= 0; i--) {
		if (lines[i].trim()) continue;
		if (--left === 0) break;
		while (i > 0 && !lines[i - 1].trim()) i--;
	}
	const text = lines.slice(i + 1, stop + 1).join("\n").trim();
	if (!text || /^>|^<!--|^#/.test(text)) return undefined;
	return text;
}

/**
 * The `icap-*` properties of a task note. Only the shapes Obsidian writes for them are read: a scalar on
 * the key's line, or a block list of (quoted) links under it.
 */
function readTask(frontmatter: string[]): TaskRecord | undefined {
	const props = new Map<string, string | string[]>();
	let list: string[] | null = null;
	for (const line of frontmatter) {
		const item = /^\s+-\s+(.*)$/.exec(line);
		if (item && list) {
			list.push(unquote(item[1]));
			continue;
		}
		list = null;
		const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
		if (!kv) continue;
		if (kv[2].trim()) props.set(kv[1], unquote(kv[2]));
		else props.set(kv[1], (list = []));
	}
	if (props.get("icap") !== TASK_MARK) return undefined;
	const one = (k: string) => (typeof props.get(k) === "string" ? (props.get(k) as string) : undefined);
	const links = (k: string) => {
		const v = props.get(k);
		const all = Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
		return all.map(linkPath).filter((x): x is string => !!x);
	};
	const task: TaskRecord = { id: one("icap-id") ?? "", status: one("icap-status") ?? "", source: links("icap-source"), changed: links("icap-changed") };
	const started = one("icap-started");
	const ended = one("icap-ended");
	if (started) task.started = started;
	if (ended) task.ended = ended;
	const num = (k: string) => {
		const v = one(k);
		return v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined;
	};
	const cost = one("icap-cost");
	if (cost !== undefined) task.cost = num("icap-cost") ?? "unknown";
	const tokens = num("icap-tokens");
	const cache = num("icap-cache");
	if (tokens !== undefined) task.tokens = tokens;
	if (cache !== undefined) task.cache = cache;
	return task;
}

function unquote(s: string): string {
	const t = s.trim();
	if (t.length >= 2 && t[0] === '"' && t[t.length - 1] === '"') {
		try {
			return JSON.parse(t) as string;
		} catch {
			return t.slice(1, -1);
		}
	}
	if (t.length >= 2 && t[0] === "'" && t[t.length - 1] === "'") return t.slice(1, -1).replace(/''/g, "'");
	return t;
}

export function readRecords(markdown: string): NoteRecords {
	const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
	const out: NoteRecords = { agentWritten: false, records: [], live: [] };
	let i = 0;
	if (lines[0] === "---") {
		const end = lines.indexOf("---", 1);
		if (end > 0) {
			out.agentWritten = GENERATED_BY_RE.test(lines.slice(1, end).join("\n"));
			const task = readTask(lines.slice(1, end));
			if (task) out.task = task;
			i = end + 1;
		}
	}
	for (; i < lines.length; i++) {
		const fence = lines[i].match(LIVE_RE);
		if (fence) {
			const close = new RegExp(`^${fence[1][0]}{${fence[1].length},}\\s*$`);
			let j = i + 1;
			for (; j < lines.length && !close.test(lines[j]); j++) {
				const id = lines[j].match(/^id:\s*(\S+)/);
				if (id && !out.live.includes(id[1])) out.live.push(id[1]);
				if (lines[j] === "---") break;
			}
			while (j < lines.length && !close.test(lines[j])) j++;
			i = j;
			continue;
		}
		const c = lines[i].match(CALLOUT_RE);
		if (!c) continue;
		const callout = c[1].toLowerCase();
		const title = c[2].trim();
		const comment = i > 0 ? parseEvidenceComment(lines[i - 1]) : null;
		const rec: KeptRecord = { kind: "request", callout, title, line: i + 1, topic: titleTopic(title) };
		if (comment) {
			Object.assign(rec, { kind: comment.kind, id: comment.id, date: comment.date });
			if (comment.topic) rec.topic = comment.topic;
			if (comment.verdict) rec.verdict = comment.verdict;
			if (comment.counts) rec.counts = comment.counts;
			if (comment.depth) rec.depth = comment.depth;
		} else if (callout === "request") {
			rec.kind = "request";
		} else if (callout === "gloss") {
			rec.kind = "gloss";
			rec.legacy = true;
		} else {
			// Before format 1 a recall and a check looked the same; a practice callout is a quiz.
			rec.kind = callout === "practice" ? "quiz" : "recall";
			rec.legacy = true;
		}
		if (rec.kind === "quiz" && !comment?.topic) rec.topic = rec.topic.replace(QUIZ_PREFIX_RE, "") || rec.topic;
		if (rec.kind === "recall" || rec.kind === "check") {
			const above = paragraphsAbove(lines, comment ? i - 1 : i, comment?.paragraphs ?? 1);
			if (above) rec.learnerText = above;
		}
		out.records.push(rec);
	}
	return out;
}
