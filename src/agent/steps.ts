/** Pure: what a tool call returned, as the activity's steps keep it. Shared by the desktop and mobile backends. */
import type { StepResult } from "./backend";

/** A result that worked is kept as a glance: one line. */
const PREVIEW_MAX = 160;
/** A failure is what someone debugs from, so its message is kept whole, up to this many characters. */
const ERROR_MAX = 2000;

/**
 * A tool's result as the activity keeps it. A call that worked: the start of its text on one line,
 * whitespace collapsed. A call that failed: its message with its line breaks (an image is "image").
 * Same shape from the harness, from RPC's records and from pi-agent-core.
 */
export function stepResult(result: unknown, isError: unknown, id?: unknown): StepResult {
	const error = isError === true;
	const content = result && typeof result === "object" ? (result as { content?: unknown }).content : result;
	let text = "";
	if (typeof content === "string") text = content;
	else if (Array.isArray(content))
		text = content
			.map((c: { type?: string; text?: string }) => (c?.type === "text" && typeof c.text === "string" ? c.text : c?.type === "image" ? "image" : ""))
			.filter(Boolean)
			.join(error ? "\n" : " ");
	const t = error
		? text
				.replace(/\r\n?/g, "\n")
				.replace(/[ \t]+$/gm, "")
				.replace(/\n{3,}/g, "\n\n")
				.trim()
		: text.replace(/\s+/g, " ").trim();
	const max = error ? ERROR_MAX : PREVIEW_MAX;
	return { ...(typeof id === "string" ? { id } : {}), error, preview: t.length > max ? t.slice(0, max - 2) + "…" : t };
}
