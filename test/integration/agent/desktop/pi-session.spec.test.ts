import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall, getCurrentTools, type FauxProviderHandle } from "@earendil-works/pi-ai";
import type { PiSdk } from "../../../../src/agent/desktop/pi-host";
import { modelRuntime } from "../../../../src/agent/desktop/pi-host";
import { ICAP_TOOLS } from "../../../../src/agent/tools/icap-tools";
import type { AgentPhase, Json } from "../../../../src/agent/backend";
import { PiSession, extensionName, probeCommands, probeModels, type RunOptions } from "../../../../src/agent/desktop/pi-session";
import { loginChoices } from "../../../../src/agent/desktop/pi-login";
import { ensureSkills } from "../../../../src/agent/desktop/icap-skills";

// A session runs in Obsidian's renderer and takes its timers from the window; Node has none.
vi.stubGlobal("window", { setTimeout, clearTimeout });

/**
 * PiSession on the harness (the fork in pi/), answered by pi-ai's faux provider: no model is called,
 * nothing is spent. Pi's agent dir is a temporary folder, so the developer's own ~/.pi is never read.
 *
 * What a learner's own extensions do is tested where they now run: on their own Pi (pi-rpc.spec.test.ts).
 */

const agentDir = mkdtempSync(join(tmpdir(), "icap-pi-agent-"));
// The vault sits inside a folder with its own AGENTS.md (like ~/AGENTS.md above a vault).
const outside = mkdtempSync(join(tmpdir(), "icap-home-"));
const vault = join(outside, "vault");
mkdirSync(join(vault, ".obsidian"), { recursive: true });
writeFileSync(join(outside, "AGENTS.md"), "OUTSIDE-CONTEXT: instructions for other work");
writeFileSync(join(vault, "AGENTS.md"), "VAULT-CONTEXT: the learner's vault rules");
writeFileSync(join(agentDir, "AGENTS.md"), "GLOBAL-CONTEXT: the learner's Pi-wide rules");
process.env.PI_CODING_AGENT_DIR = agentDir;

// An extension file in Pi's agent dir, as a learner has them: the built-in agent must not load it.
mkdirSync(join(agentDir, "extensions"), { recursive: true });
writeFileSync(join(agentDir, "extensions", "commands.ts"), `export default function (pi) {\n\tpi.registerCommand("notify", { description: "say hi", handler: async (args, ctx) => ctx.ui.notify("hi " + args) });\n}\n`);

// A subscription login a learner made with their own Pi: the built-in agent must not use it.
writeFileSync(join(agentDir, "auth.json"), JSON.stringify({ anthropic: { type: "oauth", access: "a", refresh: "r", expires: Date.now() + 86_400_000 } }));

// A connector: a stdio MCP server with one tool, written by hand so the test needs no MCP SDK.
const server = join(agentDir, "echo-server.mjs");
writeFileSync(
	server,
	`let buffer = "";
const send = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
	buffer += chunk;
	for (;;) {
		const i = buffer.indexOf("\\n");
		if (i < 0) break;
		const line = buffer.slice(0, i).trim();
		buffer = buffer.slice(i + 1);
		if (!line) continue;
		const m = JSON.parse(line);
		if (m.method === "initialize") send({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "echo", version: "1" } } });
		else if (m.method === "tools/list") send({ jsonrpc: "2.0", id: m.id, result: { tools: [{ name: "say", description: "Echo a text", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } }] } });
		else if (m.method === "tools/call") send({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: "echo: " + m.params.arguments.text }] } });
		else if (m.id !== undefined) send({ jsonrpc: "2.0", id: m.id, result: {} });
	}
});
`,
);
writeFileSync(join(agentDir, "mcp.json"), JSON.stringify({ mcpServers: { echo: { command: process.execPath, args: [server] } } }));

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

/** The text of the last message the model was sent (a tool's result, after a tool call). */
function lastText(messages: unknown[]): string {
	const last = messages.at(-1) as { content?: { type: string; text?: string }[] };
	return last?.content?.map((c) => c.text ?? "").join("") ?? "";
}

/** The tools declared to the model, as the provider receives them. */
function declared(messages: unknown[]): string[] {
	return getCurrentTools(messages as Parameters<typeof getCurrentTools>[0]).map((t) => t.name);
}

const ISOLATED_TOOLS = ["read", "edit", "write", ...ICAP_TOOLS];

const run = (prompt: string, extra: Partial<RunOptions> = {}) =>
	new PiSession({
		pi,
		cwd: vault,
		scope: "isolated",
		systemPrompt: "PROTOCOL",
		prompt,
		tools: ISOLATED_TOOLS,
		allowedRoots: [vault],
		configDir: ".obsidian",
		model: "faux/m",
		onBridge: async () => ({ status: "ok" }),
		...extra,
	});

/** One tool call by the model, then its result back: returns what the model was told. */
async function toolCall(name: string, args: Parameters<typeof fauxToolCall>[1], extra: Partial<RunOptions> = {}): Promise<string> {
	let result = "";
	faux.setResponses([
		fauxAssistantMessage(fauxToolCall(name, args), { stopReason: "toolUse" }),
		(ctx) => {
			result = lastText(ctx.messages);
			return fauxAssistantMessage("ok");
		},
	]);
	await run("go", extra).run();
	return result;
}

/** A bridge that records what the harness asked the plugin, and answers each operation as told. */
function bridge(answers: Record<string, Json>) {
	const calls: [string, Json][] = [];
	return { calls, onBridge: async (op: string, p: Json) => (calls.push([op, p]), answers[op] ?? { status: "ok" }) };
}

describe("PiSession on the harness", () => {
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
				toolResult = lastText(ctx.messages);
				return fauxAssistantMessage("ok");
			},
		]);
		await run("draw it", { skillPaths: [skill] }).run();
		expect(system).toContain("icap-visual");
		expect(system).toContain(join(skill, "SKILL.md"));
		expect(toolResult).toContain("icap.ask(");
	});

	it("ICAP's tools call the plugin in-process, and their result reaches the model", async () => {
		const calls: [string, Json][] = [];
		let toolResult = "";
		faux.setResponses([
			fauxAssistantMessage([fauxText("let me ask"), fauxToolCall("ask_learner", { kind: "text", question: "What is RAII?" })], { stopReason: "toolUse" }),
			(ctx) => {
				toolResult = lastText(ctx.messages);
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

	it("an answer holding a reactive proxy still reaches the model (the context is structured-cloned)", async () => {
		// The choices list arrives from Svelte state, which is a Proxy: structuredClone rejects it.
		const choices = new Proxy(["c"], {});
		const told = await toolCall(
			"ask_learner",
			{ kind: "single", question: "Which?", options: [{ id: "a", label: "A" }, { id: "c", label: "C" }] },
			{ onBridge: async () => ({ status: "answered", choices, chosen: ["C"] }) },
		);
		expect(told).toContain('"c"');
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

describe("isolated scope: ICAP's tools and files in the vault", () => {
	it("the model is offered read, edit and write, and neither a shell nor a connector", async () => {
		let system = "";
		let tools: string[] = [];
		faux.setResponses([
			(ctx) => {
				system = systemText(ctx.messages);
				tools = declared(ctx.messages);
				return fauxAssistantMessage("ok");
			},
		]);
		// Even a task that lists them does not get them.
		await run("hi", { tools: [...ISOLATED_TOOLS, "bash", "powershell", "mcp__echo__say"] }).run();
		for (const t of ["read", "edit", "write", "ask_learner"]) expect(tools).toContain(t);
		expect(tools.filter((t) => t === "bash" || t === "powershell" || t.startsWith("mcp__") || t === "grep" || t === "find" || t === "ls")).toEqual([]);
		expect(system).not.toContain("mcp__");
	});

	it("a shell command the model tries anyway does not run", async () => {
		const marker = join(vault, "ran.txt");
		const told = await toolCall("bash", { command: `touch ${JSON.stringify(marker)}` });
		expect(existsSync(marker)).toBe(false);
		expect(told).toMatch(/not found|not available|unknown|no tool/i);
	});

	it("read cannot leave the vault and the allowed folders", async () => {
		expect(await toolCall("read", { path: "/etc/hosts" })).toContain("outside the vault");
	});

	it("edit and write cannot leave the vault, and nothing reaches the plugin for them", async () => {
		const b = bridge({});
		const target = join(outside, "stray.md");
		expect(await toolCall("write", { path: target, content: "x" }, b)).toContain("outside the vault");
		expect(existsSync(target)).toBe(false);
		expect(b.calls).toEqual([]);
	});

	it("an edit hands the new file to the plugin, which writes it: nothing lands by the tool's own hand", async () => {
		const note = join(vault, "Note.md");
		writeFileSync(note, "# Note\n\nold line\n");
		const b = bridge({ write_file: { status: "written" } });
		const told = await toolCall("edit", { path: "Note.md", edits: [{ oldText: "old line", newText: "new line" }] }, b);
		expect(b.calls).toEqual([["write_file", { path: note, content: "# Note\n\nnew line\n", target: "vault", rel: "Note.md" }]]);
		// The plugin said it wrote it; the test's plugin did not, so the file is as it was.
		expect(readFileSync(note, "utf8")).toBe("# Note\n\nold line\n");
		expect(told).toMatch(/success|edited|replaced/i);
	});

	it("a change the learner declines is what the model is told, and the file is as it was", async () => {
		const note = join(vault, "Declined.md");
		writeFileSync(note, "keep me\n");
		const told = await toolCall("write", { path: "Declined.md", content: "replaced\n" }, bridge({ write_file: { status: "declined", message: "The learner declined this change; the file is as it was." } }));
		expect(told).toContain("declined");
		expect(readFileSync(note, "utf8")).toBe("keep me\n");
	});

	it("a write to Obsidian's own folder is marked protected", async () => {
		const b = bridge({ write_file: { status: "declined" } });
		await toolCall("write", { path: ".obsidian/snippets/x.css", content: "a{}" }, b);
		expect(b.calls[0]).toEqual(["write_file", { path: join(vault, ".obsidian", "snippets", "x.css"), content: "a{}", target: "protected", rel: ".obsidian/snippets/x.css" }]);
		expect(existsSync(join(vault, ".obsidian", "snippets"))).toBe(false);
	});
});

describe("full scope: also the shell and the learner's connectors", () => {
	const full = (extra: Partial<RunOptions> = {}): Partial<RunOptions> => ({ scope: "full", tools: ICAP_TOOLS, allowedRoots: undefined, ...extra });

	it("appends the protocol to the harness's own system prompt", async () => {
		let system = "";
		faux.setResponses([
			(ctx) => {
				system = systemText(ctx.messages);
				return fauxAssistantMessage("ok");
			},
		]);
		await run("hi", full()).run();
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
		await run("hi", full()).run();
		expect(system).toContain("VAULT-CONTEXT");
		expect(system).toContain("GLOBAL-CONTEXT");
		expect(system).not.toContain("OUTSIDE-CONTEXT");
	});

	it("does not load the learner's extension files: those run in their own Pi", async () => {
		const names = (await probeCommands(pi, vault)).map((c) => c.name);
		expect(names).not.toContain("notify");
		// The harness's own command for connectors is there.
		expect(names).toContain("mcp");
		// "/notify" is therefore text for the model, not a command.
		let user = "";
		faux.setResponses([
			(ctx) => {
				user = lastText(ctx.messages);
				return fauxAssistantMessage("ok");
			},
		]);
		const r = await run("/notify world", full()).run();
		expect(user).toBe("/notify world");
		expect(r.handled).toBeFalsy();
	});

	it("a shell command asks the plugin first; denied, it does not run and the model is told", async () => {
		const marker = join(vault, "denied.txt");
		const b = bridge({ permit: { status: "denied", message: "The learner did not allow this command." } });
		const told = await toolCall("bash", { command: `touch ${JSON.stringify(marker)}` }, full(b));
		expect(b.calls).toEqual([["permit", { kind: "shell", tool: "bash", command: `touch ${JSON.stringify(marker)}`, protected: false }]]);
		expect(existsSync(marker)).toBe(false);
		expect(told).toContain("did not allow");
	});

	it("allowed, the shell command runs", async () => {
		const marker = join(vault, "allowed.txt");
		await toolCall("bash", { command: `touch ${JSON.stringify(marker)}` }, full(bridge({ permit: { status: "allowed" } })));
		expect(existsSync(marker)).toBe(true);
	});

	it("a command that names Obsidian's folder or Pi's is marked protected", async () => {
		const b = bridge({ permit: { status: "denied" } });
		await toolCall("bash", { command: "ls .obsidian/plugins" }, full(b));
		await toolCall("bash", { command: `cat ${join(agentDir, "auth.json")}` }, full(b));
		await toolCall("bash", { command: "ls notes" }, full(b));
		expect(b.calls.map(([, p]) => p.protected)).toEqual([true, true, false]);
	});

	it("a file outside the vault goes to the plugin as outside; told to, the tool writes it itself", async () => {
		const target = join(outside, "report.md");
		const b = bridge({ write_file: { status: "direct" } });
		await toolCall("write", { path: target, content: "report\n" }, full(b));
		expect(b.calls).toEqual([["write_file", { path: target, content: "report\n", target: "outside" }]]);
		expect(readFileSync(target, "utf8")).toBe("report\n");
	});

	it("a write into Pi's own folder is marked protected", async () => {
		const b = bridge({ write_file: { status: "declined" } });
		await toolCall("write", { path: join(agentDir, "mcp.json"), content: "{}" }, full(b));
		expect(b.calls[0][1]).toMatchObject({ target: "protected" });
		expect(JSON.parse(readFileSync(join(agentDir, "mcp.json"), "utf8"))).toHaveProperty("mcpServers");
	});

	it("a connector's tool is declared to the model, asks before each call, and its result comes back", async () => {
		let tools: string[] = [];
		let told = "";
		const b = bridge({ permit: { status: "allowed" } });
		faux.setResponses([
			(ctx) => {
				tools = declared(ctx.messages);
				return fauxAssistantMessage(fauxToolCall("mcp__echo__say", { text: "hello" }), { stopReason: "toolUse" });
			},
			(ctx) => {
				told = lastText(ctx.messages);
				return fauxAssistantMessage("ok");
			},
		]);
		await run("use it", full(b)).run();
		expect(tools).toContain("mcp__echo__say");
		expect(b.calls).toEqual([["permit", { kind: "connector", tool: "mcp__echo__say", input: { text: "hello" } }]]);
		expect(told).toContain("echo: hello");
	});

	it("a connector call the learner denies does not reach the server", async () => {
		const told = await toolCall("mcp__echo__say", { text: "hello" }, full(bridge({ permit: { status: "denied", message: "The learner did not allow this connector call." } })));
		expect(told).toContain("did not allow");
		expect(told).not.toContain("echo: hello");
	});
});

describe("logins", () => {
	it("offers every login Pi has, and uses a stored account login as Pi does", async () => {
		const choices = await loginChoices(pi);
		const accounts = choices.filter((c) => c.kind === "oauth").map((c) => c.provider);
		expect(accounts).toContain("openai");
		expect(accounts).toContain("anthropic");
		expect(choices.some((c) => c.provider === "anthropic" && c.kind === "api_key")).toBe(true);
		// A stored account login is a credential like any other: its models are offered.
		const models = await probeModels(pi, vault, "isolated");
		expect(models.available).toContain("faux/m");
		expect(models.available.some((m) => m.startsWith("anthropic/"))).toBe(true);
		// Reading it changed nothing.
		expect(JSON.parse(readFileSync(join(agentDir, "auth.json"), "utf8")).anthropic.type).toBe("oauth");
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
