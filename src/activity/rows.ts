/**
 * The activity view's model, pure: a task note's properties as a row, a task's steps as spans on its
 * strip, the few words the view prints, and a task as text for the clipboard. Everything a row shows
 * comes from the note (FORMAT.md v5), so a task from another device or an earlier version still shows;
 * only the strip, the tool calls and the error need the live task.
 */
import { linkPath, isTaskStatus, localDateTime, TASK_MARK, type TaskNoteStatus } from "../dsl/task-notes";
import type { AgentPhase } from "../agent/backend";
import type { PhaseMark, Step, Task } from "../runtime/state.svelte";

export interface ActivityRow {
	path: string;
	title: string;
	id: string;
	status: TaskNoteStatus | null;
	source: string | null;
	changed: string[];
	started: number | null;
	ended: number | null;
	cost: number | "unknown" | null;
	tokens: number | null;
	model: string | null;
}

export interface ActivityGroup {
	/** The Bases group's value as text; null when the view is not grouped. */
	key: string | null;
	rows: ActivityRow[];
}
export interface ActivityData {
	groups: ActivityGroup[];
}

/** How the view groups statuses: what moves, what waits on the learner, what is over. */
export type Tone = "live" | "you" | "done" | "failed" | "stopped" | "idle";

export function tone(s: TaskNoteStatus | null): Tone {
	switch (s) {
		case "running":
		case "queued":
			return "live";
		case "needs-you":
		case "review":
			return "you";
		case "done":
			return "done";
		case "failed":
			return "failed";
		case "cancelled":
			return "stopped";
		default:
			return "idle";
	}
}

/** "2026-11-10T14:02:10" as written by `localDateTime` (a Date & time property), local time. */
export function parseLocal(v: unknown): number | null {
	if (typeof v !== "string") return null;
	const m = /^(\d{4})-(\d\d)-(\d\d)(?:[T ](\d\d):(\d\d)(?::(\d\d))?)?$/.exec(v.trim());
	if (!m) return null;
	const t = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)).getTime();
	return Number.isFinite(t) ? t : null;
}

const links = (v: unknown): string[] =>
	(Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]).map(linkPath).filter((x): x is string => !!x);

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);

/** A task note's frontmatter as a row; null for a note that is not one (the learner widened the filter). */
export function rowOf(path: string, title: string, fm: Record<string, unknown> | null | undefined): ActivityRow | null {
	if (!fm || fm.icap !== TASK_MARK) return null;
	const status = fm["icap-status"];
	const cost = fm["icap-cost"];
	const model = fm["icap-model"];
	return {
		path,
		title,
		id: typeof fm["icap-id"] === "string" ? fm["icap-id"] : "",
		status: isTaskStatus(status) ? status : null,
		source: links(fm["icap-source"])[0] ?? null,
		changed: links(fm["icap-changed"]),
		started: parseLocal(fm["icap-started"]),
		ended: parseLocal(fm["icap-ended"]),
		cost: cost === "unknown" ? "unknown" : num(cost),
		tokens: num(fm["icap-tokens"]),
		model: typeof model === "string" && model.trim() ? model.trim() : null,
	};
}

/* ───────────── steps on the strip ───────────── */

/** read: looked at something · write: changed or made something · ask: waited on the learner. */
export type StepKind = "read" | "write" | "ask";

const WRITES = new Set(["create_note", "propose_edit", "edit", "write", "bash"]);
const ASKS = new Set(["ask_learner"]);

export function stepKind(tool: string): StepKind {
	if (ASKS.has(tool)) return "ask";
	if (WRITES.has(tool)) return "write";
	return "read";
}

export interface Span {
	index: number;
	kind: StepKind;
	/** Fractions of the strip, 0–1. */
	left: number;
	width: number;
	running: boolean;
	ms: number;
}

/** A step that took no visible time still gets a sliver (fraction of the strip). */
const MIN_WIDTH = 0.012;

/**
 * Timed steps as spans between `start` and `end` (now, for a live task). Steps without times (recorded
 * before they had them) are not drawn: there is nothing honest to place them by.
 */
export function spans(steps: readonly Step[], start: number, end: number): Span[] {
	const total = Math.max(1, end - start);
	const out: Span[] = [];
	steps.forEach((s, index) => {
		if (s.at === undefined) return;
		const from = Math.max(start, Math.min(end, s.at));
		const to = Math.max(from, Math.min(end, s.end ?? end));
		const left = (from - start) / total;
		const width = Math.min(1 - left, Math.max(MIN_WIDTH, (to - from) / total));
		out.push({ index, kind: stepKind(s.tool), left, width, running: s.end === undefined, ms: to - from });
	});
	return out;
}

/**
 * Where the time between steps went: getting ready, waiting for the model's first token, its thinking,
 * its reply, the learner. Drawn under the steps, so a long wait for the provider shows as what it is.
 */
export type PhaseKind = "prep" | "wait" | "think" | "reply" | "you";

export function phaseKind(p: AgentPhase): PhaseKind {
	switch (p) {
		case "starting":
			return "prep";
		case "sending":
		case "awaiting":
		case "retrying":
			return "wait";
		case "thinking":
			return "think";
		case "waiting":
			return "you";
		default:
			return "reply";
	}
}

export interface PhaseSpan {
	kind: PhaseKind;
	left: number;
	width: number;
	ms: number;
	running: boolean;
}

/** Phase changes as spans between `start` and `end`; the time before the first change is getting ready. */
export function phaseSpans(marks: readonly PhaseMark[], start: number, end: number): PhaseSpan[] {
	if (!marks.length) return [];
	const total = Math.max(1, end - start);
	const pieces: { kind: PhaseKind; from: number }[] = [];
	if (marks[0].at > start) pieces.push({ kind: "prep", from: start });
	for (const m of marks) {
		const kind = phaseKind(m.phase);
		if (pieces.at(-1)?.kind !== kind) pieces.push({ kind, from: Math.max(start, Math.min(end, m.at)) });
	}
	return pieces.map((p, i) => {
		const to = i + 1 < pieces.length ? pieces[i + 1].from : end;
		return { kind: p.kind, left: (p.from - start) / total, width: Math.max(0, to - p.from) / total, ms: Math.max(0, to - p.from), running: i === pieces.length - 1 };
	}).filter((p) => p.ms > 0 || p.running);
}

/* ───────────── words ───────────── */

/** "0.8s", "7.2s", "48s", "4m 38s", "2h 05m". */
export function duration(ms: number): string {
	const s = Math.max(0, ms) / 1000;
	if (s < 10) return `${s.toFixed(1)}s`;
	if (s < 60) return `${Math.floor(s)}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ${String(Math.floor(s % 60)).padStart(2, "0")}s`;
	return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

/** The model's own name, without the provider (and an OpenRouter-style vendor prefix). */
export function modelName(model: string): string {
	return model.slice(model.lastIndexOf("/") + 1);
}

/** "≈$0.042"; null when unknown or not yet known. Task notes record list-price estimates. */
export function costText(cost: ActivityRow["cost"]): string | null {
	if (typeof cost !== "number") return null;
	const t = cost >= 1 ? cost.toFixed(2) : cost >= 0.01 ? cost.toFixed(3).replace(/0$/, "") : cost.toFixed(4);
	return `≈$${t}`;
}

/* ───────────── a task as text ───────────── */

/** What `taskText` reads of a task; the live `Task` has all of it. */
export type TaskFacts = Pick<Task, "kind" | "title" | "notePath" | "status" | "createdAt" | "endedAt" | "model" | "error" | "interrupted" | "steps" | "stepsDropped" | "phases">;

const PHASE_TEXT: Record<PhaseKind, string> = { prep: "starting", wait: "waiting for the model", think: "thinking", reply: "replying", you: "waiting for the learner" };

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
/** Later lines of a value line up under its first. */
const hang = (s: string, by: number) => s.trim().replace(/\n/g, "\n" + " ".repeat(by));

/**
 * A task as plain text, for the clipboard: what it was and how it ended, its error, where its time went,
 * and each tool call the activity kept with what the call returned. It goes into a bug report, so its
 * labels are English in every interface language, and nothing the task holds is shortened again.
 */
export function taskText(t: TaskFacts, now = Date.now()): string {
	const live = t.status === "processing" || t.status === "waiting";
	const end = live ? now : (t.endedAt ?? t.createdAt);
	const started = localDateTime(t.createdAt).replace("T", " ");
	/** The time of day; with the date when it is not the day the task started. */
	const clock = (ms: number) => {
		const at = localDateTime(ms).replace("T", " ");
		return at.startsWith(started.slice(0, 10)) ? at.slice(11) : at;
	};
	// A request block is one task for all its rounds: it starts again with each round (its start, its error
	// and its phases are the latest round's) and keeps the tool calls of the rounds before.
	const rounds = t.steps.some((s) => s.at !== undefined && s.at < t.createdAt);

	const lines = [`ICAP task · ${t.kind} · ${t.status}${t.interrupted ? " (interrupted)" : ""}`, `title: ${oneLine(t.title)}`, `note: ${t.notePath}`];
	if (t.model) lines.push(`model: ${t.model}`);
	lines.push(`${rounds ? "latest round" : "started"}: ${started} · ${live ? "running for" : "took"} ${duration(end - t.createdAt)}`);

	const spent = new Map<PhaseKind, number>();
	for (const p of phaseSpans(t.phases, t.createdAt, end)) spent.set(p.kind, (spent.get(p.kind) ?? 0) + p.ms);
	if (spent.size) lines.push(`time: ${[...spent].map(([kind, ms]) => `${PHASE_TEXT[kind]} ${duration(ms)}`).join(" · ")}`);

	if (t.error) lines.push(`error: ${hang(t.error, 2)}`);

	if (t.steps.length) {
		const all = t.steps.length + t.stepsDropped;
		lines.push("", `tool calls: ${all}${t.stepsDropped ? ` (the first ${t.stepsDropped} were not kept)` : ""}`);
		let earlier = rounds;
		for (const s of t.steps) {
			if (earlier && s.at !== undefined && s.at >= t.createdAt) {
				lines.push("-- latest round --");
				earlier = false;
			}
			// Like the list: a call too quick to matter (under 0.1 s) has no time.
			const took = s.at === undefined ? "" : s.end === undefined ? (live ? "running" : "did not end") : s.end - s.at < 100 ? "" : duration(s.end - s.at);
			lines.push([s.at === undefined ? "" : clock(s.at), s.tool, s.detail, took, s.error ? "failed" : ""].filter(Boolean).join(" · "));
			if (s.out) lines.push(`    ${hang(s.out, 4)}`);
		}
	}
	return lines.join("\n");
}
