import { describe, expect, it } from "vite-plus/test";
import type { AgentPhase } from "../backend";
import { PiEvents, extensionName } from "./pi-events";

const assistant = (text: string, stopReason = "stop", extra: Record<string, unknown> = {}) => ({
	type: "message_end",
	message: { role: "assistant", provider: "faux", model: "m", content: [{ type: "text", text }], stopReason, usage: { input: 3, output: 2, cost: { total: 0.01 } }, ...extra },
});

describe("Pi's events as a run's events", () => {
	it("streams the text, drops narration before a tool call, and ends with the last reply", () => {
		const texts: string[] = [];
		const phases: AgentPhase[] = [];
		const steps: string[] = [];
		const ev = new PiEvents({ onBridge: async () => ({}), onText: (t) => texts.push(t), onPhase: (p) => phases.push(p), onStep: (t, d) => steps.push(`${t}: ${d}`) });
		ev.handle({ type: "turn_start" });
		ev.handle({ type: "message_start", message: { role: "assistant" } });
		ev.handle({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "let me " } });
		ev.handle({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "look" } });
		ev.handle(assistant("let me look", "toolUse"));
		ev.handle({ type: "tool_execution_start", toolName: "ask_learner", args: { question: "Why?" } });
		ev.handle({ type: "tool_execution_end" });
		ev.handle(assistant("done"));
		expect(texts).toEqual(["let me ", "let me look", "", "done"]);
		expect(steps).toEqual(["ask_learner: Why?"]);
		expect(phases).toEqual(["sending", "replying", "writing", "writing", "waiting", "thinking"]);
		expect(ev.result(false, false)).toEqual({ text: "done", aborted: false, handled: false });
	});

	it("keeps text written alongside ask_learner while still dropping narration before other tools", () => {
		const texts: string[] = [];
		const ev = new PiEvents({ onBridge: async () => ({}), onText: (t) => texts.push(t) });
		// Narration before a non-ask_learner tool is dropped.
		ev.handle({ type: "message_start", message: { role: "assistant" } });
		ev.handle({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "let me read" } });
		ev.handle({
			type: "message_end",
			message: {
				role: "assistant",
				content: [
					{ type: "text", text: "let me read" },
					{ type: "toolCall", name: "read", arguments: { path: "note.md" } },
				],
				stopReason: "toolUse",
			},
		});
		// Explanation written in the same turn as ask_learner is kept so ask() can attach it to the turn.
		ev.handle({ type: "message_start", message: { role: "assistant" } });
		ev.handle({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Here is the explanation." } });
		ev.handle({
			type: "message_end",
			message: {
				role: "assistant",
				content: [
					{ type: "text", text: "Here is the explanation." },
					{ type: "toolCall", name: "ask_learner", arguments: { kind: "text", question: "Try plugging in u = ln r?" } },
				],
				stopReason: "toolUse",
			},
		});
		ev.handle(assistant("Nice work!"));
		expect(texts).toEqual(["let me read", "", "Here is the explanation.", "Here is the explanation.", "Nice work!"]);
		expect(ev.result(false, false)).toEqual({ text: "Nice work!", aborted: false, handled: false });
	});

	it("reports each reply's usage and model", () => {
		const used: [number | undefined, string | null][] = [];
		const ev = new PiEvents({ onBridge: async () => ({}), onUsage: (u, m) => used.push([u?.cost, m]) });
		ev.handle(assistant("hi"));
		expect(used).toEqual([[0.01, "faux/m"]]);
	});

	it("an extension's notices are the result when no model text came; its error is the error when nothing came", () => {
		const notices = new PiEvents({ onBridge: async () => ({}) });
		notices.notify(" hi world ");
		expect(notices.result(false, true)).toEqual({ text: "hi world", aborted: false, handled: true });

		const errors: string[] = [];
		const broken = new PiEvents({ onBridge: async () => ({}), onExtensionError: (m) => errors.push(m) });
		broken.extensionError("/u/.pi/agent/extensions/broken/index.ts", "Illegal invocation");
		expect(errors).toEqual(["broken: Illegal invocation"]);
		expect(() => broken.result(false, true)).toThrow("broken: Illegal invocation");
		// The learner stopping the run is never an error.
		expect(broken.result(true, true)).toMatchObject({ aborted: true });
	});

	it("a model error with no text is thrown; the last retry's error is kept", () => {
		const ev = new PiEvents({ onBridge: async () => ({}) });
		ev.handle(assistant("", "error", { errorMessage: "529 overloaded" }));
		ev.handle({ type: "auto_retry_end", success: false, finalError: "529 overloaded, after 3 tries" });
		expect(() => ev.result(false, false)).toThrow("529 overloaded, after 3 tries");
	});

	it("names an extension by its package, its file, or the folder of its index", () => {
		expect(extensionName("/u/.pi/agent/npm/node_modules/pi-subagents/bundle/index.js")).toBe("pi-subagents");
		expect(extensionName("/u/.pi/agent/extensions/commands.ts")).toBe("commands");
	});
});
