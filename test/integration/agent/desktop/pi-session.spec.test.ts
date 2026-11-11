import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall, type FauxProviderHandle } from "@earendil-works/pi-ai";
import type { PiSdk } from "../../../../src/agent/desktop/pi-host";
import { modelRuntime } from "../../../../src/agent/desktop/pi-host";
import { ICAP_TOOLS } from "../../../../src/agent/tools/icap-tools";
import type { AgentPhase } from "../../../../src/agent/backend";
import { PiSession, extensionName, probeCommands, type RunOptions } from "../../../../src/agent/desktop/pi-session";
import { ensureSkills } from "../../../../src/agent/desktop/icap-skills";

/**
 * PiSession on the real Pi SDK, answered by Pi's faux provider: no model is called, nothing is spent.
 * Pi's agent dir is a temporary folder, so the developer's own ~/.pi is never read.
 */

const agentDir = mkdtempSync(join(tmpdir(), "icap-pi-agent-"));
// The vault sits inside a folder with its own AGENTS.md (like ~/AGENTS.md above a vault).
const outside = mkdtempSync(join(tmpdir(), "icap-home-"));
const vault = join(outside, "vault");
mkdirSync(vault);
writeFileSync(join(outside, "AGENTS.md"), "OUTSIDE-CONTEXT: instructions for other work");
writeFileSync(join(vault, "AGENTS.md"), "VAULT-CONTEXT: the learner's vault rules");
writeFileSync(join(agentDir, "AGENTS.md"), "GLOBAL-CONTEXT: the learner's Pi-wide rules");
process.env.PI_CODING_AGENT_DIR = agentDir;

// A learner extension in Pi's agent dir: commands that notify, stay silent, or start a turn.
mkdirSync(join(agentDir, "extensions"), { recursive: true });
writeFileSync(
	join(agentDir, "extensions", "commands.ts"),
	`export default function (pi) {
	pi.registerCommand("notify", { description: "say hi", handler: async (args, ctx) => ctx.ui.notify("hi " + args) });
	pi.registerCommand("silent", { description: "nothing", handler: async () => {} });
	pi.registerCommand("turn", { description: "own turn", handler: async () => { setTimeout(() => pi.sendUserMessage("from the command"), 50); } });
	pi.registerCommand("gate", { description: "asks", handler: async (_a, ctx) => ctx.ui.notify((await ctx.ui.confirm("Proceed?", "really")) ? "yes" : "no") });
}
`,
);

// A learner extension, as a folder with an index, that throws on session start while a test sets the flag.
mkdirSync(join(agentDir, "extensions", "broken"), { recursive: true });
writeFileSync(
	join(agentDir, "extensions", "broken", "index.ts"),
	`export default function (pi) {
	pi.on("session_start", () => {
		if (globalThis.__icapBreakExtension) throw new TypeError("Illegal invocation");
	});
}
`,
);
const breakExtension = (on: boolean) => ((globalThis as { __icapBreakExtension?: boolean }).__icapBreakExtension = on);

let pi: PiSdk;
let faux: FauxProviderHandle;

beforeAll(async () => {
	pi = await import("../../../../src/agent/desktop/pi-sdk-entry");
	faux = fauxProvider({ provider: "faux", models: [{ id: "m" }] });
	const runtime = await modelRuntime(pi);
	runtime.registerNativeProvider(faux.provider);
	await runtime.setRuntimeApiKey("faux", "test");
}, 30000);

beforeEach(() => faux.setResponses([]));

/** The text of the leading system messages (the system prompt as the provider receives it). */
function systemText(messages: unknown[]): string {
	return (messages as { role: string; content: unknown; sections?: Record<string, string> }[])
		.filter((m) => m.role === "system")
		.map((m) => [typeof m.content === "string" ? m.content : "", ...Object.values(m.sections ?? {})].filter(Boolean).join("\n"))
		.join("\n");
}

const run = (prompt: string, extra: Partial<RunOptions> = {}) =>
	new PiSession({
		pi,
		cwd: vault,
		config: "isolated",
		systemPrompt: "PROTOCOL",
		prompt,
		tools: ["read", ...ICAP_TOOLS],
		allowedRoots: [vault],
		model: "faux/m",
		onBridge: async () => ({ status: "ok" }),
		...extra,
	});

describe("PiSession on the SDK", () => {
	it("a normal prompt ends with the model's reply; the protocol is the whole system prompt", async () => {
		let system = "";
		faux.setResponses([
			(ctx) => {
				system = systemText(ctx.messages);
				return fauxAssistantMessage("hello back");
			},
		]);
		const texts: string[] = [];
		const r = await run("hello", { onText: (t) => texts.push(t) }).run();
		expect(r).toMatchObject({ text: "hello back", aborted: false });
		expect(texts.at(-1)).toBe("hello back");
		expect(system.startsWith("PROTOCOL")).toBe(true);
		expect(system).not.toMatch(/coding assistant/i);
		expect(system).not.toContain("icap-visual");
	});

	it("sees the vault's own AGENTS.md, not the learner's Pi-wide one or those above the vault", async () => {
		let system = "";
		faux.setResponses([
			(ctx) => {
				system = systemText(ctx.messages);
				return fauxAssistantMessage("ok");
			},
		]);
		await run("hi").run();
		expect(system).toContain("VAULT-CONTEXT");
		expect(system).not.toMatch(/GLOBAL-CONTEXT|OUTSIDE-CONTEXT/);
	});

	it("offers ICAP's own skills, and the agent can read them", async () => {
		const [skill] = ensureSkills(join(vault, ".obsidian", "plugins", "icap-agent"), ["icap-visual"]);
		let system = "";
		let toolResult = "";
		faux.setResponses([
			(ctx) => {
				system = systemText(ctx.messages);
				return fauxAssistantMessage(fauxToolCall("read", { path: join(skill, "SKILL.md") }), { stopReason: "toolUse" });
			},
			(ctx) => {
				const last = ctx.messages.at(-1) as { content?: { type: string; text?: string }[] };
				toolResult = last?.content?.map((c) => c.text ?? "").join("") ?? "";
				return fauxAssistantMessage("ok");
			},
		]);
		await run("draw it", { skillPaths: [skill] }).run();
		expect(system).toContain("icap-visual");
		expect(system).toContain(join(skill, "SKILL.md"));
		expect(toolResult).toContain("icap.ask(");
	});

	it("ICAP's tools call the plugin in-process, and their result reaches the model", async () => {
		const calls: [string, Record<string, unknown>][] = [];
		let toolResult = "";
		faux.setResponses([
			fauxAssistantMessage([fauxText("let me ask"), fauxToolCall("ask_learner", { kind: "text", question: "What is RAII?" })], { stopReason: "toolUse" }),
			(ctx) => {
				const last = ctx.messages.at(-1) as { content?: { type: string; text?: string }[] };
				toolResult = last?.content?.map((c) => c.text ?? "").join("") ?? "";
				return fauxAssistantMessage("thanks");
			},
		]);
		const steps: string[] = [];
		const r = await run("check me", {
			onBridge: async (op, p) => {
				calls.push([op, p]);
				return { status: "answered", answer: "scope-bound cleanup" };
			},
			onStep: (tool, detail) => steps.push(`${tool}: ${detail}`),
		}).run();
		expect(calls).toEqual([["ask", { kind: "text", question: "What is RAII?" }]]);
		expect(toolResult).toContain("scope-bound cleanup");
		expect(steps).toEqual(["ask_learner: What is RAII?"]);
		expect(r.text).toBe("thanks");
	});

	it("an answer holding a reactive proxy still reaches the model (Pi structured-clones the context)", async () => {
		// The choices list arrives from Svelte state, which is a Proxy: structuredClone rejects it.
		const choices = new Proxy(["c"], {});
		let toolResult = "";
		faux.setResponses([
			fauxAssistantMessage(fauxToolCall("ask_learner", { kind: "single", question: "Which?", options: [{ id: "a", label: "A" }, { id: "c", label: "C" }] }), { stopReason: "toolUse" }),
			(ctx) => {
				const last = ctx.messages.at(-1) as { content?: { type: string; text?: string }[] };
				toolResult = last?.content?.map((c) => c.text ?? "").join("") ?? "";
				return fauxAssistantMessage("right");
			},
		]);
		const r = await run("quiz me", { onBridge: async () => ({ status: "answered", choices, chosen: ["C"] }) }).run();
		expect(toolResult).toContain('"c"');
		expect(r.text).toBe("right");
	});

	it("isolated: file tools cannot leave the vault and the allowed folders", async () => {
		let toolResult = "";
		faux.setResponses([
			fauxAssistantMessage(fauxToolCall("read", { path: "/etc/hosts" }), { stopReason: "toolUse" }),
			(ctx) => {
				const last = ctx.messages.at(-1) as { content?: { type: string; text?: string }[] };
				toolResult = last?.content?.map((c) => c.text ?? "").join("") ?? "";
				return fauxAssistantMessage("ok");
			},
		]);
		await run("read it").run();
		expect(toolResult).toContain("outside the vault");
	});

	it("an unknown model is a clear error, not a hang", async () => {
		await expect(run("x", { model: "nope/none" }).run()).rejects.toThrow(/no model/);
	});

	it("says where a run is: the session starts, the request is out, the reply begins, then the text", async () => {
		faux.setResponses([fauxAssistantMessage("hello back")]);
		const phases: AgentPhase[] = [];
		await run("hello", { onPhase: (p) => phases.push(p) }).run();
		expect(phases.filter((p, i) => p !== phases[i - 1])).toEqual(["starting", "sending", "replying", "writing"]);
	});

	it("cancel stops a running turn", async () => {
		let release!: () => void;
		faux.setResponses([async () => (await new Promise<void>((r) => (release = r)), fauxAssistantMessage("late"))]);
		const s = run("slow");
		const done = s.run();
		await new Promise((r) => setTimeout(r, 300));
		s.cancel();
		release?.();
		await expect(done).resolves.toMatchObject({ aborted: true });
	});
});

describe("the learner's own extensions (mine)", () => {
	const mine = (prompt: string, extra: Partial<RunOptions> = {}) => run(prompt, { config: "mine", tools: ICAP_TOOLS, allowedRoots: undefined, ...extra });

	it("appends the protocol to Pi's own system prompt", async () => {
		let system = "";
		faux.setResponses([
			(ctx) => {
				system = systemText(ctx.messages);
				return fauxAssistantMessage("ok");
			},
		]);
		await mine("hi").run();
		expect(system).toContain("PROTOCOL");
		expect(system.startsWith("PROTOCOL")).toBe(false);
	});
	it("sees the vault's and Pi's own AGENTS.md, not those above the vault", async () => {
		let system = "";
		faux.setResponses([
			(ctx) => {
				system = systemText(ctx.messages);
				return fauxAssistantMessage("ok");
			},
		]);
		await mine("hi").run();
		expect(system).toContain("VAULT-CONTEXT");
		expect(system).toContain("GLOBAL-CONTEXT");
		expect(system).not.toContain("OUTSIDE-CONTEXT");
	});
	it("lists their commands", async () => {
		const names = (await probeCommands(pi, vault)).map((c) => c.name);
		expect(names).toEqual(expect.arrayContaining(["notify", "silent", "turn"]));
	});
	it("an extension command that only notifies ends, with its message as the result", async () => {
		await expect(mine("/notify world").run()).resolves.toMatchObject({ text: "hi world", handled: true });
	});
	it("an extension command that does nothing visible still ends", async () => {
		await expect(mine("/silent").run()).resolves.toMatchObject({ text: "", handled: true });
	});
	it("an extension command that starts its own turn is waited for", async () => {
		faux.setResponses([fauxAssistantMessage("from the command, answered")]);
		await expect(mine("/turn").run()).resolves.toMatchObject({ text: "from the command, answered", handled: true });
	});
	it("an extension that throws is reported by name while the run goes on", async () => {
		breakExtension(true);
		try {
			faux.setResponses([fauxAssistantMessage("still answered")]);
			const errors: string[] = [];
			const r = await mine("hi", { onExtensionError: (m) => errors.push(m) }).run();
			expect(errors).toEqual(["broken: Illegal invocation"]);
			expect(r.text).toBe("still answered");
		} finally {
			breakExtension(false);
		}
	});
	it("an extension that throws is the error when no reply comes", async () => {
		breakExtension(true);
		try {
			await expect(mine("/silent").run()).rejects.toThrow("broken: Illegal invocation");
		} finally {
			breakExtension(false);
		}
	});
	it("an extension's dialog is asked through onDialog", async () => {
		const asked: string[] = [];
		const r = await mine("/gate", {
			onDialog: async (req) => {
				asked.push(`${req.method}:${req.title}`);
				return { confirmed: true };
			},
		}).run();
		expect(asked).toEqual(["confirm:Proceed?"]);
		expect(r.text).toBe("yes");
	});
});


describe("extensionName", () => {
	it("names an extension by its package, its file, or the folder of its index", () => {
		expect(extensionName("/u/.pi/agent/npm/node_modules/pi-subagents/bundle/index.js")).toBe("pi-subagents");
		expect(extensionName("C:\\Users\\me\\node_modules\\@acme\\pi-proxy\\dist\\main.js")).toBe("@acme/pi-proxy");
		expect(extensionName("/u/.pi/agent/extensions/commands.ts")).toBe("commands");
		expect(extensionName("/u/.pi/agent/extensions/broken/index.ts")).toBe("broken");
	});
});
