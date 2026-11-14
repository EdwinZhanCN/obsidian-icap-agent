/** Pure: what a tool call returned, as the activity's steps keep it. Shared by the desktop and mobile backends. */
import type { StepResult } from "./backend";

/**
 * A tool's result as a short preview: the start of its text, whitespace collapsed (an image is "image").
 * Same shape from the harness, from RPC's records and from pi-agent-core.
 */
export function stepResult(result: unknown, isError: unknown, id?: unknown): StepResult {
	const content = result && typeof result === "object" ? (result as { content?: unknown }).content : result;
	let text = "";
	if (typeof content === "string") text = content;
	else if (Array.isArray(content))
		text = content
			.map((c: { type?: string; text?: string }) => (c?.type === "text" && typeof c.text === "string" ? c.text : c?.type === "image" ? "image" : ""))
			.filter(Boolean)
			.join(" ");
	const t = text.replace(/\s+/g, " ").trim();
	return { ...(typeof id === "string" ? { id } : {}), error: isError === true, preview: t.length > 160 ? t.slice(0, 158) + "…" : t };
}

