import type { AgentEvents, AgentImage, AgentResult } from "../backend";
import { stepResult } from "../steps";
import { messageUsage } from "../usage";

/**
 * Pi's session events as what a run tells the runtime (AgentEvents), and the run's result. The events are
 * the same whether Pi runs in-process (pi-session.ts, the SDK's `AgentSessionEvent`) or as the learner's own
 * `pi --mode rpc` (rpc/rpc-session.ts, one JSON record per line), so both read them here. No Node, no SDK.
 */

/** The fields of Pi's session events that are read, all optional: Pi's union is read loosely. */
export interface PiEventView {
	type?: string;
	message?: {
		role?: string;
		usage?: Parameters<typeof messageUsage>[0];
		provider?: string;
		model?: string;
		content?: unknown;
		stopReason?: string;
		errorMessage?: string;
	};
	assistantMessageEvent?: { type?: string; delta?: string };
	toolName?: unknown;
	toolCallId?: unknown;
	args?: unknown;
	result?: unknown;
	isError?: boolean;
	success?: boolean;
	finalError?: string;
}

interface PiContent {
	type?: string;
	text?: string;
	name?: string;
}

/** Whether a tool-use message is handing the turn to the learner via `ask_learner`. */
function asksLearner(content: unknown): boolean {
	return Array.isArray(content) && (content as PiContent[]).some((c) => c?.type === "toolCall" && c.name === "ask_learner");
}

/** Images as Pi's message content. */
export function imageContent(images: AgentImage[] | undefined): { type: "image"; data: string; mimeType: string }[] | undefined {
	return images?.length ? images.map((i) => ({ type: "image" as const, data: i.data, mimeType: i.mimeType })) : undefined;
}

/** The words of a message, whether its content is a string or parts. */
export function messageText(content: unknown): string {
	if (typeof content === "string") return content;
	return Array.isArray(content) ? (content as PiContent[]).filter((c) => c?.type === "text").map((c) => c.text ?? "").join("") : "";
}

/** A one-line gist of a tool call's arguments: the path, command or query it is about. */
export function stepDetail(args: unknown): string {
	if (!args || typeof args !== "object") return "";
	const a = args as Record<string, unknown>;
	for (const k of ["path", "file_path", "command", "pattern", "query", "title", "op", "url", "question"]) {
		const v = a[k];
		if (typeof v === "string" && v.trim()) return clip(v);
	}
	const first = Object.values(a).find((v) => typeof v === "string" && v.trim());
	return typeof first === "string" ? clip(first) : "";
}

function clip(s: string) {
	const t = s.replace(/\s+/g, " ").trim();
	return t.length > 90 ? t.slice(0, 88) + "…" : t;
}

/**
 * An extension by its name, from the path Pi loaded it from: the package (`…/node_modules/@scope/name/dist/index.js`),
 * else the file, or its folder when the file is an index.
 */
export function extensionName(path: string): string {
	const parts = path.split(/[\\/]/).filter(Boolean);
	const nm = parts.lastIndexOf("node_modules");
	if (nm >= 0 && parts[nm + 1]) return parts[nm + 1].startsWith("@") && parts[nm + 2] ? `${parts[nm + 1]}/${parts[nm + 2]}` : parts[nm + 1];
	const file = parts.at(-1) ?? path;
	const stem = file.replace(/\.[cm]?[jt]s$/, "");
	return stem === "index" && parts.length > 1 ? parts[parts.length - 2] : stem || path;
}

/** After an extension command was handled, how long to wait for a turn it may have started. */
export const HANDLED_GRACE_MS = 350;

/** One run's reading of Pi's events: what was said so far, what went wrong, and the result at the end. */
export class PiEvents {
	private finalText = "";
	private currentText = "";
	private lastError: string | null = null;
	/** ctx.ui.notify from an extension: the only output of many extension commands. */
	private notices: string[] = [];
	/** Messages given to the agent while it works (AgentRun.steer) that it has not read yet. */
	private steering: string[] = [];

	constructor(private o: AgentEvents) {}

	/** A message is on its way to the working agent; `onSteered` follows when the agent reads it. */
	expectSteer(text: string) {
		this.steering.push(text);
	}

	/** The message could not be queued after all. */
	forgetSteer(text: string) {
		const i = this.steering.indexOf(text);
		if (i >= 0) this.steering.splice(i, 1);
	}

	/** An extension's notice (ctx.ui.notify). */
	notify(message: unknown) {
		if (typeof message === "string" && message.trim()) this.notices.push(message.trim());
	}

	/** One of the learner's extensions threw, at `path`. */
	extensionError(path: string, error: unknown) {
		const said = typeof error === "string" && error ? error : "failed";
		const message = `${extensionName(path)}: ${said}`;
		this.lastError = message;
		this.o.onExtensionError?.(message);
	}

	/** The run's result. `cancelled`: the learner stopped it; `handled`: the prompt was a command the agent ran itself. */
	result(cancelled: boolean, handled: boolean): AgentResult {
		// What an extension command said through notify is its result when no model text came.
		const text = this.finalText.trim() ? this.finalText : this.notices.join("\n\n");
		// A session the learner stopped always ends as "aborted", whatever Pi reported on the way out.
		if (cancelled) return { text, aborted: true, handled };
		if (this.lastError && !text.trim()) throw new Error(this.lastError);
		return { text, aborted: false, handled };
	}

	handle(rec: PiEventView) {
		const o = this.o;
		switch (rec.type) {
			case "turn_start":
				o.onPhase?.("sending");
				return;
			case "message_start": {
				if (rec.message?.role === "user") {
					// A steering message reached the agent: what it says from here on answers that message too.
					const i = this.steering.indexOf(messageText(rec.message.content));
					if (i < 0) return;
					const [text] = this.steering.splice(i, 1);
					this.finalText = "";
					this.currentText = "";
					o.onSteered?.(text);
					return;
				}
				if (rec.message?.role !== "assistant") return;
				this.currentText = "";
				o.onPhase?.("replying");
				return;
			}
			case "message_update": {
				const e = rec.assistantMessageEvent;
				if (!e) return;
				if (e.type === "thinking_start") o.onPhase?.("thinking");
				else if (e.type === "toolcall_start") o.onPhase?.("reading");
				else if (e.type === "text_delta") {
					this.currentText += e.delta ?? "";
					o.onPhase?.("writing");
					o.onText?.(this.currentText);
				}
				return;
			}
			case "message_end": {
				const m = rec.message;
				if (m?.role !== "assistant") return;
				const used = messageUsage(m.usage);
				const model = m.provider && m.model ? `${m.provider}/${m.model}` : null;
				if (used || model) o.onUsage?.(used, model);
				const text = messageText(m.content);
				if (m.stopReason === "error" || m.stopReason === "aborted") {
					this.lastError = m.errorMessage || (m.stopReason === "aborted" ? "Stopped." : "The model returned an error.");
				}
				if (m.stopReason === "toolUse") {
					// Text written alongside `ask_learner` is addressed to the learner (e.g. an explanation
					// before a follow-up question); keep it so `ask()` can attach it to the preceding turn.
					// Narration before any other tool call is not part of the result.
					if (asksLearner(m.content) && text.trim()) o.onText?.(text);
					else if (this.currentText) o.onText?.(this.finalText);
				} else if (text.trim()) {
					this.finalText = text;
					o.onText?.(text);
				}
				this.currentText = "";
				return;
			}
			case "tool_execution_start":
				if (typeof rec.toolName === "string") o.onStep?.(rec.toolName, stepDetail(rec.args), typeof rec.toolCallId === "string" ? rec.toolCallId : undefined);
				o.onTool?.(true);
				o.onPhase?.(rec.toolName === "ask_learner" || rec.toolName === "propose_edit" ? "waiting" : "reading");
				return;
			case "tool_execution_end":
				o.onTool?.(false, stepResult(rec.result, rec.isError, rec.toolCallId));
				o.onPhase?.("thinking");
				return;
			case "auto_retry_start":
				o.onPhase?.("retrying");
				return;
			case "auto_retry_end":
				if (rec.success === false && rec.finalError) this.lastError = rec.finalError;
				return;
		}
	}
}
