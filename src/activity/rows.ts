/**
 * The activity view's model, pure: a task note's properties as a row, a task's steps as spans on its
 * strip, and the few words the view prints. Everything a row shows comes from the note (FORMAT.md v5),
 * so a task from another device or an earlier version still shows; only the strip needs the live task.
 */
import { linkPath, isTaskStatus, TASK_MARK, type TaskNoteStatus } from "../dsl/task-notes";
import type { Step } from "../runtime/state.svelte";

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
