import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { createFauxCore, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall, type AssistantMessage, type FauxProviderHandle } from "@earendil-works/pi-ai";
import type { AgentPhase, Json } from "../../../../src/agent/backend";
import { ICAP_TOOLS } from "../../../../src/agent/tools/icap-tools";
import { MobileSession, connectionLost, retryable, type MobileRunOptions, type StreamFunction } from "../../../../src/agent/mobile/mobile-session";
import type { PiSdk } from "../../../../src/agent/desktop/pi-host";
import { modelRuntime } from "../../../../src/agent/desktop/pi-host";
import { PiSession } from "../../../../src/agent/desktop/pi-session";

/**
 * MobileSession (pi-agent-core + pi-ai) answered by pi-ai's faux provider, on the scenarios PiSession
 * is tested on — and, for the same script, the same things reach the runtime under both backends:
 * the reply, the bridge calls, the steps. The runtime writes notes from exactly these, so the note
 * content is the same on desktop and mobile.
 */

const core = createFauxCore({ provider: "faux", models: [{ id: "m" }] });
const model = core.models[0];
type Step = Parameters<typeof core.setResponses>[0][number];

const session = (prompt: string, extra: Partial<MobileRunOptions> = {}) =>
	new MobileSession({
		model: model as MobileRunOptions["model"],
		apiKey: "test",
		stream: core.streamSimple as unknown as StreamFunction,
		transport: "stream",
		systemPrompt: "PROTOCOL",
		prompt,
		tools: [...ICAP_TOOLS],
		onBridge: async () => ({ status: "ok" }),
		retryDelay: () => 1,
		...extra,
	});

/** The tools offered: pi-ai declares them on the system message. */
const offered = (ctx: { messages: unknown[] }) => (ctx.messages as { role: string; toolsAdded?: { name: string }[] }[]).filter((m) => m.role === "system").flatMap((m) => (m.toolsAdded ?? []).map((t) => t.name));

const lastText = (ctx: { messages: unknown[] }) => {
	const last = ctx.messages.at(-1) as { content?: { type: string; text?: string }[] | string };
	return typeof last?.content === "string" ? last.content : (last?.content?.map((c) => c.text ?? "").join("") ?? "");
};

beforeEach(() => core.setResponses([]));

describe("MobileSession on pi-agent-core", () => {
	it("a normal prompt ends with the model's reply; the protocol is the whole system prompt", async () => {
		let system = "";
		let tools: string[] = [];
		core.setResponses([
			(ctx) => {
				system = (ctx.messages as { role: string; content: unknown }[]).filter((m) => m.role === "system").map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("\n");
				tools = offered(ctx);
				return fauxAssistantMessage("hello back");
			},
		]);
		const texts: string[] = [];
		const r = await session("hello", { onText: (t) => texts.push(t) }).run();
		expect(r).toMatchObject({ text: "hello back", aborted: false });
		expect(texts.at(-1)).toBe("hello back");
		expect(system).toContain("PROTOCOL");
		expect(tools.sort()).toEqual([...ICAP_TOOLS].sort());
	});

	it("offers only the tools the task allows", async () => {
		let tools: string[] = [];
		core.setResponses([
			(ctx) => {
				tools = offered(ctx);
				return fauxAssistantMessage("ok");
			},
		]);
		await session("hi", { tools: ["read", "obsidian", "read_document"] }).run();
		expect(tools.sort()).toEqual(["obsidian", "read_document"]);
	});

	it("ICAP's tools call the plugin, and their result reaches the model", async () => {
		const calls: [string, Json][] = [];
		let toolResult = "";
		core.setResponses([
			fauxAssistantMessage([fauxText("let me ask"), fauxToolCall("ask_learner", { kind: "text", question: "What is RAII?" })], { stopReason: "toolUse" }),
			(ctx) => {
				toolResult = lastText(ctx);
				return fauxAssistantMessage("thanks");
			},
		]);
		const steps: string[] = [];
		const phases: AgentPhase[] = [];
		const r = await session("check me", {
			onBridge: async (op, p) => {
				calls.push([op, p]);
				return { status: "answered", answer: "scope-bound cleanup" };
			},
			onStep: (tool, detail) => steps.push(`${tool}: ${detail}`),
			onPhase: (p) => phases.push(p),
		}).run();
		expect(calls).toEqual([["ask", { kind: "text", question: "What is RAII?" }]]);
		expect(toolResult).toContain("scope-bound cleanup");
		expect(steps).toEqual(["ask_learner: What is RAII?"]);
		expect(phases).toContain("waiting");
		expect(r.text).toBe("thanks");
	});

	it("an answer holding a reactive proxy still reaches the model", async () => {
		const choices = new Proxy(["c"], {});
		let toolResult = "";
		core.setResponses([
			fauxAssistantMessage(fauxToolCall("ask_learner", { kind: "single", question: "Which?", options: [{ id: "a", label: "A" }, { id: "c", label: "C" }] }), { stopReason: "toolUse" }),
			(ctx) => {
				toolResult = lastText(ctx);
				return fauxAssistantMessage("right");
			},
		]);
		const r = await session("quiz me", { onBridge: async () => ({ status: "answered", choices, chosen: ["C"] }) }).run();
		expect(toolResult).toContain('"c"');
		expect(r.text).toBe("right");
	});

	it("a tool error reaches the model as an error, and the run goes on", async () => {
		let toolResult = "";
		core.setResponses([
			fauxAssistantMessage(fauxToolCall("obsidian", { command: "read", path: "Nope.md" }), { stopReason: "toolUse" }),
			(ctx) => {
				toolResult = lastText(ctx);
				return fauxAssistantMessage("no such note");
			},
		]);
		const r = await session("read", { onBridge: async () => ({ status: "error", message: "No note found" }) }).run();
		expect(toolResult).toContain("No note found");
		expect(r.text).toBe("no such note");
	});

	it("a provider error that may pass is retried, showing retrying", async () => {
		const phases: AgentPhase[] = [];
		core.setResponses([fauxAssistantMessage("", { stopReason: "error", errorMessage: "529 overloaded_error" }), fauxAssistantMessage("second time lucky")]);
		const r = await session("hi", { onPhase: (p) => phases.push(p) }).run();
		expect(phases).toContain("retrying");
		expect(r.text).toBe("second time lucky");
	});

	it("a provider error that will not pass fails at once", async () => {
		core.setResponses([fauxAssistantMessage("", { stopReason: "error", errorMessage: "401 invalid x-api-key" })]);
		await expect(session("hi").run()).rejects.toThrow(/invalid x-api-key/);
	});

	it("a lost connection is an interruption, not a failure", async () => {
		core.setResponses([fauxAssistantMessage("", { stopReason: "error", errorMessage: "Connection error." })]);
		await expect(session("hi").run()).resolves.toMatchObject({ aborted: false, interrupted: "Connection error." });
	});

	it("a reply that arrives whole says so while it is awaited", async () => {
		const phases: AgentPhase[] = [];
		core.setResponses([fauxAssistantMessage("whole")]);
		await session("hi", { transport: "whole", onPhase: (p) => phases.push(p) }).run();
		expect(phases.slice(0, 2)).toEqual(["starting", "awaiting"]);
	});

	it("cancel stops a running turn", async () => {
		let release!: () => void;
		core.setResponses([async () => (await new Promise<void>((r) => (release = r)), fauxAssistantMessage("late"))]);
		const s = session("slow");
		const done = s.run();
		await new Promise((r) => setTimeout(r, 50));
		s.cancel();
		release?.();
		await expect(done).resolves.toMatchObject({ aborted: true });
	});

	it("classifies errors", () => {
		expect(retryable("429 Too Many Requests")).toBe(true);
		expect(retryable("overloaded_error")).toBe(true);
		expect(retryable("401 unauthorized")).toBe(false);
		expect(connectionLost("TypeError: Load failed")).toBe(true);
		expect(connectionLost("Connection error.")).toBe(true);
		expect(connectionLost("400 bad request")).toBe(false);
	});
});

describe("the same script, both backends", () => {
	let pi: PiSdk;
	let faux: FauxProviderHandle;
	const vault = mkdtempSync(join(tmpdir(), "icap-parity-"));

	beforeAll(async () => {
		process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "icap-pi-agent-"));
		pi = await import("../../../../src/agent/desktop/pi-sdk-entry");
		faux = fauxProvider({ provider: "faux2", models: [{ id: "m" }] });
		const runtime = await modelRuntime(pi);
		runtime.registerNativeProvider(faux.provider);
		await runtime.setRuntimeApiKey("faux2", "test");
	}, 30000);

	const script = (): Step[] => [
		fauxAssistantMessage([fauxText("looking"), fauxToolCall("obsidian", { command: "read", path: "Heap.md" })], { stopReason: "toolUse" }),
		fauxAssistantMessage(fauxToolCall("create_note", { title: "Heap", content: "The heap.", purpose: "a concept note" }), { stopReason: "toolUse" }),
		(ctx) => fauxAssistantMessage(`done: ${lastText(ctx)}`) as AssistantMessage,
	];

	async function trace(run: (events: Pick<MobileRunOptions, "onBridge" | "onStep" | "onText">) => Promise<{ text: string }>) {
		const calls: [string, Json][] = [];
		const steps: string[] = [];
		const r = await run({
			onBridge: async (op, p) => {
				calls.push([op, p]);
				return op === "vault" ? { path: "Heap.md", content: "# Heap" } : { status: "created", path: "Heap 1.md" };
			},
			onStep: (tool, detail) => steps.push(`${tool}: ${detail}`),
		});
		return { text: r.text, calls, steps };
	}

	it("gives the runtime the same reply, bridge calls and steps", async () => {
		faux.setResponses(script());
		const desktop = await trace((ev) => new PiSession({ pi, cwd: vault, config: "isolated", systemPrompt: "PROTOCOL", prompt: "go", tools: [...ICAP_TOOLS], allowedRoots: [vault], model: "faux2/m", ...ev }).run());
		core.setResponses(script());
		const mobile = await trace((ev) => session("go", ev).run());
		expect(mobile).toEqual(desktop);
		expect(desktop.calls.map((c) => c[0])).toEqual(["vault", "create_note"]);
	});
});
