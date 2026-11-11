/**
 * Task notes (FORMAT.md, version 5): a request or a note-making task as a Markdown note with `icap-*`
 * properties, so Obsidian's Bases can list them. Pure: what a task note says, and the Activity base.
 *
 * Property keys and status values are English markers (other tools read them); only the display names in
 * the generated base follow the interface language.
 */

export const TASK_MARK = "task";

/** The Bases view type the plugin registers for the activity (src/activity/view.svelte.ts). */
export const ACTIVITY_VIEW_TYPE = "icap-activity";

/** The eight values of `icap-status`. `draft` and `queued` are not written yet (no dispatch in this version). */
export const TASK_STATUSES = ["draft", "queued", "running", "needs-you", "review", "done", "failed", "cancelled"] as const;
export type TaskNoteStatus = (typeof TASK_STATUSES)[number];

export const isTaskStatus = (v: unknown): v is TaskNoteStatus => typeof v === "string" && (TASK_STATUSES as readonly string[]).includes(v);

/** What the runtime knows of a task, reduced to what its note records. */
export interface TaskFacts {
	status: "processing" | "waiting" | "completed" | "failed" | "cancelled";
	/** The learner is being shown a proposed edit to apply or decline. */
	reviewing: boolean;
}

/**
 * The runtime's states as `icap-status`. A task waiting on the learner is `needs-you`, unless what it
 * waits for is their decision on a proposed edit: `review`. A task that was stopped, or was running when
 * Obsidian closed, is `cancelled` (it can be continued from its block; nothing re-runs it by itself).
 */
export function taskStatus(t: TaskFacts): TaskNoteStatus {
	switch (t.status) {
		case "processing":
			return "running";
		case "waiting":
			return t.reviewing ? "review" : "needs-you";
		case "completed":
			return "done";
		case "failed":
			return "failed";
		case "cancelled":
			return "cancelled";
	}
}

export interface TaskNote {
	id: string;
	status: TaskNoteStatus;
	/** Vault path of the note the task is about (where its block lives). */
	source: string | null;
	/** Vault paths of files the task created or changed. */
	changed: string[];
	started: number;
	ended: number | null;
	/**
	 * US dollars for every run of the task; "unknown" when it cannot be told (a model without list prices,
	 * a task from before costs were recorded). Null only while the task has not reached a model yet.
	 */
	cost: number | "unknown" | null;
	/** Tokens in and out, cached ones included; null when unknown. */
	tokens: number | null;
	/** Share of the prompt read from the cache, 0–100; null when unknown. */
	cache: number | null;
	/**
	 * The model of the latest run, `provider/id`; null before a model answered. The same property is the
	 * task's choice of model: a task runs on its own model, the settings' model is only the default.
	 */
	model: string | null;
}

export const COST_UNKNOWN = "unknown";

const pad = (n: number) => String(n).padStart(2, "0");

/** A local date-time the way Obsidian's "Date & time" property stores it. */
export function localDateTime(ms: number): string {
	const d = new Date(ms);
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** A wikilink to a vault path, as a property value. */
export const linkTo = (path: string) => `[[${path.replace(/\.md$/i, "")}]]`;

/** The vault path a property link points at, as written by `linkTo` (the reader's side). */
export function linkPath(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const m = /^\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]$/.exec(value.trim());
	return m ? m[1] : null;
}

/** The `icap-*` properties of a task note. A property without a value is absent, never empty. */
export function taskProperties(n: TaskNote): Record<string, string | number | string[]> {
	const p: Record<string, string | number | string[]> = { icap: TASK_MARK, "icap-id": n.id, "icap-status": n.status };
	if (n.source) p["icap-source"] = [linkTo(n.source)];
	if (n.changed.length) p["icap-changed"] = n.changed.map(linkTo);
	p["icap-started"] = localDateTime(n.started);
	if (n.ended !== null) p["icap-ended"] = localDateTime(n.ended);
	// A task that has ended always says what it cost, even when the answer is "unknown".
	if (n.cost !== null) p["icap-cost"] = n.cost;
	else if (n.ended !== null) p["icap-cost"] = COST_UNKNOWN;
	if (n.tokens !== null) p["icap-tokens"] = n.tokens;
	if (n.cache !== null) p["icap-cache"] = n.cache;
	if (n.model) p["icap-model"] = n.model;
	return p;
}

/** Properties this version owns: on update they are set, or removed when they have no value. */
export const OWNED_PROPERTIES = ["icap", "icap-id", "icap-status", "icap-source", "icap-changed", "icap-started", "icap-ended", "icap-cost", "icap-tokens", "icap-cache", "icap-model"] as const;

/** Bring a note's frontmatter up to date; true if anything changed. Properties of other tools are left alone. */
export function applyTaskProperties(fm: Record<string, unknown>, n: TaskNote): boolean {
	const next = taskProperties(n);
	let changed = false;
	for (const key of OWNED_PROPERTIES) {
		const want = next[key];
		const have = fm[key];
		if (want === undefined) {
			if (have !== undefined) {
				delete fm[key];
				changed = true;
			}
		} else if (JSON.stringify(have) !== JSON.stringify(want)) {
			fm[key] = want;
			changed = true;
		}
	}
	return changed;
}

function yamlString(s: string): string {
	return JSON.stringify(s);
}

/** A new task note: properties, then the request in the learner's words and where its conversation lives. */
export function renderTaskNote(n: TaskNote, request: string, origin: string): string {
	const lines = ["---"];
	for (const [key, value] of Object.entries(taskProperties(n))) {
		if (typeof value === "number") lines.push(`${key}: ${value}`);
		else if (Array.isArray(value)) {
			lines.push(`${key}:`);
			for (const v of value) lines.push(`  - ${yamlString(v)}`);
		} else if (key === "icap-started" || key === "icap-ended") lines.push(`${key}: ${value}`);
		else lines.push(`${key}: ${/^[\w-]+$/.test(value) ? value : yamlString(value)}`);
	}
	lines.push("---", "", request.trim(), "");
	if (origin.trim()) lines.push(origin.trim(), "");
	return lines.join("\n");
}

/** A file name from a task's title: no characters Obsidian or a file system refuses, and not too long. */
export function taskFileName(title: string): string {
	const s = title
		.replace(/[“”]/g, "")
		.replace(/[\\/:*?"<>|#^[\]]/g, " ")
		.replace(/\s+/g, " ")
		.replace(/^[.\s]+|[.\s]+$/g, "")
		.trim();
	return (s.length > 60 ? s.slice(0, 60).trim() : s) || "Task";
}

/**
 * An Activity.base from before the activity view (FORMAT 4), with that view put first: the one change the
 * plugin ever makes to a base it generated, once. Everything else in the file is the learner's and stays as
 * it is; a base without a `views:` list, or one that already has the view, comes back unchanged.
 */
export function withActivityView(base: string, name: string): string {
	if (/^\s*-\s*type:\s*["']?icap-activity\b/m.test(base)) return base;
	const m = /^views:[ \t]*\r?\n/m.exec(base);
	if (!m) return base;
	const at = m.index + m[0].length;
	const indent = /^([ \t]*)-/.exec(base.slice(at))?.[1] ?? "  ";
	const view = [`${indent}- type: ${ACTIVITY_VIEW_TYPE}`, `${indent}  name: ${JSON.stringify(name)}`, `${indent}  sort:`, `${indent}    - property: note.icap-started`, `${indent}      direction: DESC`, ""].join("\n");
	return base.slice(0, at) + view + base.slice(at);
}

export interface BaseLabels {
	status: string;
	source: string;
	changed: string;
	started: string;
	ended: string;
	minutes: string;
	cost: string;
	tokens: string;
	cache: string;
	activity: string;
	needsMe: string;
	inProgress: string;
	all: string;
}

/**
 * Activity.base. Bases reads a bare `icap-status` in an expression as a subtraction, so filters and
 * formulas use `note["icap-status"]`; columns, grouping and display names use `note.icap-status`
 * (verified in Obsidian 1.15). The cost column sums: Bases leaves the text `unknown` out of a Sum.
 * The first view is the plugin's `icap-activity`; the tables after it read the same notes without the plugin.
 */
export function activityBase(l: BaseLabels): string {
	const q = (s: string) => JSON.stringify(s);
	return `filters:
  and:
    - 'note["icap"] == "${TASK_MARK}"'
formulas:
  minutes: 'if(note["icap-ended"], (date(note["icap-ended"]) - date(note["icap-started"])).minutes.round(0), "")'
properties:
  note.icap-status:
    displayName: ${q(l.status)}
  note.icap-source:
    displayName: ${q(l.source)}
  note.icap-changed:
    displayName: ${q(l.changed)}
  note.icap-started:
    displayName: ${q(l.started)}
  note.icap-ended:
    displayName: ${q(l.ended)}
  formula.minutes:
    displayName: ${q(l.minutes)}
  note.icap-cost:
    displayName: ${q(l.cost)}
  note.icap-tokens:
    displayName: ${q(l.tokens)}
  note.icap-cache:
    displayName: ${q(l.cache)}
views:
  - type: ${ACTIVITY_VIEW_TYPE}
    name: ${q(l.activity)}
    sort:
      - property: note.icap-started
        direction: DESC
  - type: table
    name: ${q(l.needsMe)}
    filters:
      or:
        - 'note["icap-status"] == "needs-you"'
        - 'note["icap-status"] == "review"'
    order:
      - file.name
      - note.icap-status
      - note.icap-source
      - note.icap-started
    sort:
      - property: note.icap-started
        direction: DESC
  - type: table
    name: ${q(l.inProgress)}
    filters:
      or:
        - 'note["icap-status"] == "queued"'
        - 'note["icap-status"] == "running"'
    order:
      - file.name
      - note.icap-status
      - note.icap-source
      - note.icap-started
    sort:
      - property: note.icap-started
        direction: DESC
  - type: table
    name: ${q(l.all)}
    groupBy:
      property: note.icap-status
      direction: ASC
    order:
      - file.name
      - note.icap-status
      - note.icap-source
      - note.icap-changed
      - formula.minutes
      - note.icap-cost
      - note.icap-tokens
      - note.icap-cache
      - note.icap-ended
    summaries:
      note.icap-cost: Sum
      note.icap-tokens: Sum
    sort:
      - property: note.icap-started
        direction: DESC
`;
}
