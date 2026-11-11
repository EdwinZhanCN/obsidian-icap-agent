/**
 * Slash commands typed into a request block. Pure helpers (no Obsidian imports).
 *
 * Two kinds share one `/` namespace:
 * - Pi's own commands, as `get_commands` reports them: extension commands, prompt templates and
 *   skills (`/skill:name`). ICAP sends them to Pi verbatim; Pi expands and runs them.
 * - ICAP's runtime commands (model, thinking, compact), which map onto session controls instead of a
 *   prompt. They change how this block's agent runs; they are never part of the conversation.
 */

export type CommandSource = "extension" | "prompt" | "skill" | "icap";

export interface SlashCommand {
	/** Without the leading slash, e.g. "review", "skill:research". */
	name: string;
	description?: string;
	source: CommandSource;
}

/** What a writing line needs to offer commands as the learner types "/". */
export interface CommandProvider {
	list(): Promise<SlashCommand[]>;
	/** One-word argument values for a command (models, levels), or null if it takes free text. */
	args(name: string): Promise<string[]> | null;
	/** A line under the suggestions, e.g. why the learner's own commands are missing. */
	note?: string;
}

export type IcapCommandName = "model" | "thinking" | "compact";

export const ICAP_COMMAND_NAMES: IcapCommandName[] = ["model", "thinking", "compact"];

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"];

/** What the learner is typing at the caret: a command name, or the argument of one. */
export type CommandTrigger =
	| { stage: "name"; query: string }
	| { stage: "arg"; name: string; query: string; start: number };

/**
 * A request is a command when it starts with "/" — like Pi's own editor. Only the first line's
 * first word is the name; the trigger is offered while the caret is still on that line.
 */
export function commandTrigger(text: string, caret: number): CommandTrigger | null {
	if (!text.startsWith("/")) return null;
	const lineEnd = text.indexOf("\n");
	if (lineEnd !== -1 && caret > lineEnd) return null;
	const before = text.slice(1, caret);
	const space = before.search(/\s/);
	if (space === -1) return /^[\w:.-]*$/.test(before) ? { stage: "name", query: before } : null;
	const name = before.slice(0, space);
	const rest = before.slice(space + 1);
	// Argument completion is for one-word arguments (a model, a level), not free text.
	if (/\s/.test(rest)) return null;
	return { stage: "arg", name, query: rest, start: space + 2 };
}

export function parseCommand(text: string): { name: string; args: string } | null {
	const t = text.trim();
	const m = t.match(/^\/([\w:.-]+)(?:\s+([\s\S]*))?$/);
	if (!m) return null;
	return { name: m[1], args: (m[2] ?? "").trim() };
}

export function isIcapCommand(name: string): name is IcapCommandName {
	return (ICAP_COMMAND_NAMES as string[]).includes(name);
}

/** Commands matching what was typed: name prefix first, then name substring, then description. */
export function rankCommands(list: SlashCommand[], query: string, limit = 8): SlashCommand[] {
	const q = query.toLowerCase();
	if (!q) return list.slice(0, limit);
	const scored: { c: SlashCommand; s: number }[] = [];
	for (const c of list) {
		const n = c.name.toLowerCase();
		// "/research" finds "skill:research" as readily as "/skill:res" does.
		const bare = n.startsWith("skill:") ? n.slice(6) : n;
		let s = -1;
		if (n.startsWith(q) || bare.startsWith(q)) s = 3;
		else if (n.includes(q)) s = 2;
		else if ((c.description ?? "").toLowerCase().includes(q)) s = 1;
		if (s > 0) scored.push({ c, s });
	}
	return scored
		.sort((a, b) => b.s - a.s || a.c.name.length - b.c.name.length)
		.slice(0, limit)
		.map((x) => x.c);
}

/** Argument values matching what was typed (prefix before substring). */
export function rankArgs(values: string[], query: string, limit = 8): string[] {
	const q = query.toLowerCase();
	if (!q) return values.slice(0, limit);
	const pre = values.filter((v) => v.toLowerCase().startsWith(q));
	const sub = values.filter((v) => !pre.includes(v) && v.toLowerCase().includes(q));
	return [...pre, ...sub].slice(0, limit);
}

/** Replace the name (and keep what follows) with a chosen command; caret goes after "/name ". */
export function insertCommand(text: string, name: string): { text: string; caret: number } {
	const m = text.match(/^\/[\w:.-]*/);
	const rest = text.slice(m ? m[0].length : 0).replace(/^[^\S\n]*/, "");
	const head = `/${name} `;
	return { text: head + rest, caret: head.length };
}

/** Replace the argument being typed with a chosen value. */
export function insertArg(text: string, trigger: Extract<CommandTrigger, { stage: "arg" }>, value: string): { text: string; caret: number } {
	const after = text.slice(trigger.start).replace(/^\S*/, "");
	const head = text.slice(0, trigger.start) + value;
	return { text: head + after, caret: head.length };
}

/** A short, stable fingerprint of a text (FNV-1a, 32 bit). */
export function hashText(s: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(16).padStart(8, "0");
}
