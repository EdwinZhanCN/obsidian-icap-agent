import { Agent, type AgentEvent, type AgentTool, type ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Api, AssistantMessage, AssistantMessageEventStream, Model, SimpleStreamOptions, TranscriptContext } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import type { AgentEvents, AgentResult } from "../backend";
import { icapTools } from "../tools/icap-tools";
import type { Transport } from "./providers";

/**
 * One task's agent on mobile: pi-agent-core's loop on pi-ai's provider adapters, with ICAP's own tools
 * only (no extensions, skills, file tools or session files). Every run starts from the prompt it is
 * given — the runtime replays the block's transcript into it. Mirrors PiSession (agent/desktop/) event
 * for event, so the document sees the same phases, steps and text.
 */

export type StreamFunction = (model: Model<Api>, context: TranscriptContext, options?: SimpleStreamOptions) => AssistantMessageEventStream;

export interface MobileRunOptions extends AgentEvents {
	model: Model<Api>;
	apiKey?: string;
	/** The provider adapter's streamSimple. */
	stream: StreamFunction;
	transport: Transport;
	/** "whole" only: the fetch requests go through (wholeFetch). Never set for Google's adapter. */
	fetch?: typeof fetch;
	systemPrompt: string;
	prompt: string;
	/** Tool names the task allows; only ICAP's exist here. */
	tools: string[];
	thinking?: string;
	/** Provider errors retried this many times before the run fails (default 3). */
	retries?: number;
	/** Pause before retry n (1-based), in ms. */
	retryDelay?: (attempt: number) => number;
}

const THINKING: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

/** An error a later attempt may not get: overload, rate limit, a server error, a gateway timeout. */
export function retryable(message: string): boolean {
	return /\b(408|409|425|429|500|502|503|504|520|522|524|529)\b|overload|rate.?limit|too many requests|temporarily|try again|server error|timed? ?out/i.test(message);
}

/** The connection itself failed (the app went to the background, the network dropped): the task is interrupted. */
export function connectionLost(message: string): boolean {
	return /connection error|load failed|failed to fetch|networkerror|network error|network connection was lost|internet connection appears to be offline|err_network|err_internet_disconnected|socket hang up|econnreset|connection (?:was )?(?:reset|closed|lost)/i.test(message);
}

/** A one-line gist of a tool call's arguments (same as PiSession's stepDetail). */
function stepDetail(args: unknown): string {
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

export class MobileSession {
	private agent: Agent | null = null;
	private finalText = "";
	private currentText = "";
	private lastError: string | null = null;
	private cancelled = false;
	private wake: (() => void) | null = null;

	constructor(private opts: MobileRunOptions) {}

	private tools(): AgentTool[] {
		const o = this.opts;
		return icapTools(Type, o.onBridge)
			.filter((t) => o.tools.includes(t.name))
			.map(
				(t): AgentTool => ({
					name: t.name,
					label: t.label,
					description: t.description,
					parameters: t.parameters,
					...(t.sequential ? { executionMode: "sequential" as const } : {}),
					execute: async (_id, params) => {
						const { text, details } = await t.execute(params as Record<string, unknown>);
						return { content: [{ type: "text", text }], details };
					},
				}),
			);
	}

	private thinkingLevel(): ThinkingLevel {
		const want = (this.opts.thinking ?? "").trim().toLowerCase() as ThinkingLevel;
		if (!this.opts.model.reasoning) return "off";
		return THINKING.includes(want) ? want : "off";
	}

	async run(): Promise<AgentResult> {
		const o = this.opts;
		o.onPhase?.("starting");
		const whole = o.transport === "whole";
		const agent = new Agent({
			initialState: { systemPrompt: o.systemPrompt, model: o.model, thinkingLevel: this.thinkingLevel(), tools: this.tools() },
			streamFn: (model, context, options) => o.stream(model, context, { ...options, ...(o.apiKey ? { apiKey: o.apiKey } : {}), ...(whole && o.fetch ? { fetch: o.fetch } : {}) }),
			// The loop's own retry waits are bounded; ICAP retries itself, showing "retrying".
			maxRetryDelayMs: 0,
			toolExecution: "sequential",
		});
		this.agent = agent;
		const unsubscribe = agent.subscribe((ev) => this.handle(ev));
		const max = o.retries ?? 3;
		try {
			for (let attempt = 0; ; attempt++) {
				if (this.cancelled) return this.result();
				if (attempt === 0) await agent.prompt(o.prompt);
				else await agent.continue();
				if (this.cancelled) return this.result();
				const last = agent.state.messages.at(-1) as AssistantMessage | undefined;
				const failed = last?.role === "assistant" && last.stopReason === "error" ? (last.errorMessage ?? "") : null;
				if (failed === null) break;
				if (connectionLost(failed)) return { text: this.finalText, aborted: false, interrupted: failed };
				if (attempt >= max || !retryable(failed)) break;
				// Send the same turn again: drop the failed reply, wait, continue from the request.
				agent.state.messages = agent.state.messages.slice(0, -1);
				this.lastError = null;
				o.onPhase?.("retrying");
				await this.pause(o.retryDelay?.(attempt + 1) ?? Math.min(2000 * 2 ** attempt, 15000));
			}
			return this.result();
		} catch (e) {
			if (this.cancelled) return this.result();
			throw e instanceof Error ? e : new Error(String(e));
		} finally {
			unsubscribe();
			this.agent = null;
		}
	}

	cancel() {
		if (this.cancelled) return;
		this.cancelled = true;
		this.agent?.abort();
		this.wake?.();
	}

	private pause(ms: number): Promise<void> {
		return new Promise((resolve) => {
			const t = setTimeout(done, ms);
			function done() {
				clearTimeout(t);
				resolve();
			}
			this.wake = done;
		});
	}

	private result(): AgentResult {
		const text = this.finalText;
		if (this.cancelled) return { text, aborted: true };
		if (this.lastError && !text.trim()) throw new Error(this.lastError);
		return { text, aborted: false };
	}

	private handle(ev: AgentEvent) {
		const o = this.opts;
		const whole = o.transport === "whole";
		switch (ev.type) {
			case "turn_start":
				// A reply that arrives whole shows nothing until it is complete: say so instead of "thinking".
				if (whole) o.onPhase?.("awaiting");
				return;
			case "message_start":
				if (ev.message.role === "assistant") this.currentText = "";
				return;
			case "message_update": {
				const e = ev.assistantMessageEvent;
				if (e.type === "thinking_start") o.onPhase?.("thinking");
				else if (e.type === "toolcall_start") o.onPhase?.("reading");
				else if (e.type === "text_delta") {
					this.currentText += e.delta;
					o.onPhase?.("writing");
					o.onText?.(this.currentText);
				}
				return;
			}
			case "message_end": {
				const m = ev.message;
				if (m.role !== "assistant") return;
				const text = m.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("");
				if (m.stopReason === "error" || m.stopReason === "aborted") {
					this.lastError = m.errorMessage || (m.stopReason === "aborted" ? "Stopped." : "The model returned an error.");
				}
				if (m.stopReason === "toolUse") {
					// Narration before a tool call is not part of the result.
					if (this.currentText) o.onText?.(this.finalText);
				} else if (text.trim()) {
					this.finalText = text;
					o.onText?.(text);
				}
				this.currentText = "";
				return;
			}
			case "tool_execution_start":
				o.onStep?.(ev.toolName, stepDetail(ev.args));
				o.onTool?.(true);
				o.onPhase?.(ev.toolName === "ask_learner" || ev.toolName === "propose_edit" ? "waiting" : "reading");
				return;
			case "tool_execution_end":
				o.onTool?.(false);
				o.onPhase?.(whole ? "awaiting" : "thinking");
				return;
		}
	}
}
