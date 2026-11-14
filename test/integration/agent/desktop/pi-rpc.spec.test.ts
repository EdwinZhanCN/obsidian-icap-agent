import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { AgentEvents, AgentPhase } from "../../../../src/agent/backend";
import { SetupNeeded } from "../../../../src/agent/backend";
import { ensureSkills } from "../../../../src/agent/desktop/icap-skills";
import { findPi } from "../../../../src/agent/desktop/rpc/pi-command";
import { PiRpc, type RpcRequest } from "../../../../src/agent/desktop/rpc/pi-rpc";
import { ICAP_TOOLS } from "../../../../src/agent/tools/icap-tools";

// The backend runs in Obsidian's renderer and takes its timers from the window; Node has none.
vi.stubGlobal("window", { setTimeout, clearTimeout });

/**
 * The Pi RPC backend against a real Pi: the CLI of the pinned @earendil-works/pi-coding-agent, started as
 * its own process the way a learner's installed `pi` is, and answered by pi-ai's faux provider (registered
 * by an extension in Pi's agent dir): no model is called, nothing is spent. Pi's agent dir is a temporary
 * folder, so the developer's own ~/.pi is never read, and no login is written anywhere else.
 *
 * The scenarios are the ones PiSession is tested on for "mine" (pi-session.spec.test.ts): a learner who
 * moves from the built-in Pi to their own must see the same behaviour.
 */

const posix = process.platform !== "win32";
const agentDir = mkdtempSync(join(tmpdir(), "icap-rpc-agent-"));
// The vault sits inside a folder with its own AGENTS.md (like ~/AGENTS.md above a vault).
const outside = mkdtempSync(join(tmpdir(), "icap-rpc-home-"));
const vault = join(outside, "vault");
const pluginDir = join(vault, ".obsidian", "plugins", "icap-agent");
const sessions = join(pluginDir, "sessions");
mkdirSync(sessions, { recursive: true });
writeFileSync(join(outside, "AGENTS.md"), "OUTSIDE-CONTEXT: instructions for other work");
writeFileSync(join(vault, "AGENTS.md"), "VAULT-CONTEXT: the learner's vault rules");
writeFileSync(join(agentDir, "AGENTS.md"), "GLOBAL-CONTEXT: the learner's Pi-wide rules");
// A stored key for the faux provider, in the temporary agent dir only.
writeFileSync(join(agentDir, "auth.json"), JSON.stringify({ faux: { type: "api_key", key: "test" } }));

const scriptFile = join(agentDir, "faux-script.json");
const logFile = join(agentDir, "faux-log.jsonl");
const breakFlag = join(agentDir, "break-extension");

mkdirSync(join(agentDir, "extensions", "broken"), { recursive: true });
// The faux provider, scripted from a file: each step is one model reply; what the model was sent is logged.
writeFileSync(
	join(agentDir, "extensions", "faux.ts"),
	`import { fauxProvider, fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { appendFileSync, readFileSync } from "node:fs";
export default function (pi) {
	const faux = fauxProvider({ provider: "faux", models: [{ id: "m" }, { id: "eye", input: ["text", "image"], contextWindow: 100000 }, { id: "blind", input: ["text"] }] });
	pi.registerProvider(faux.provider);
	const script = JSON.parse(readFileSync(${JSON.stringify(scriptFile)}, "utf8"));
	faux.setResponses(script.map((step) => async (ctx) => {
		const system = ctx.messages.filter((m) => m.role === "system").map((m) => [typeof m.content === "string" ? m.content : "", ...Object.values(m.sections ?? {})].filter(Boolean).join("\\n")).join("\\n");
		const last = ctx.messages.at(-1);
		const lastText = Array.isArray(last?.content) ? last.content.map((c) => c.text ?? "").join("") : String(last?.content ?? "");
		const users = ctx.messages.filter((m) => m.role === "user").map((m) => Array.isArray(m.content) ? m.content.map((c) => c.text ?? "").join("") : String(m.content ?? ""));
		const lastUser = ctx.messages.findLast((m) => m.role === "user");
		const lastUserParts = Array.isArray(lastUser?.content) ? lastUser.content.map((c) => c.type + (c.mimeType ? ":" + c.mimeType : "")) : ["text"];
		appendFileSync(${JSON.stringify(logFile)}, JSON.stringify({ system, lastRole: last?.role, lastText, users, lastUserParts, pid: process.pid }) + "\\n");
		if (step.delayMs) await new Promise((r) => setTimeout(r, step.delayMs));
		const content = [];
		if (step.text) content.push(fauxText(step.text));
		for (const c of step.calls ?? []) content.push(fauxToolCall(c.name, c.args));
		return fauxAssistantMessage(content, step.calls?.length ? { stopReason: "toolUse" } : {});
	}));
}
`,
);
// A learner extension: commands that notify, stay silent, start a turn, or ask.
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
// A learner extension, as a folder with an index, that throws on session start while the flag file exists.
writeFileSync(
	join(agentDir, "extensions", "broken", "index.ts"),
	`import { existsSync } from "node:fs";
export default function (pi) {
	pi.on("session_start", () => {
		if (existsSync(${JSON.stringify(breakFlag)})) throw new TypeError("Illegal invocation");
	});
}
`,
);

// "An installed pi": a launcher on disk that starts the pinned CLI, the way the installer's own launcher does.
const cli = fileURLToPath(new URL("../../../../node_modules/@earendil-works/pi-coding-agent/dist/cli.js", import.meta.url));
const bin = mkdtempSync(join(tmpdir(), "icap-rpc-bin-"));
const launcher = join(bin, "pi");
writeFileSync(launcher, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(cli)} "$@"\n`);
chmodSync(launcher, 0o755);

const env = async (): Promise<NodeJS.ProcessEnv> => ({ ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1" });
const rpc = new PiRpc({ pluginDir: () => pluginDir, piPath: () => launcher, env });

interface Step {
	text?: string;
	calls?: { name: string; args: Record<string, unknown> }[];
	delayMs?: number;
}
interface Seen {
	system: string;
	lastRole: string;
	lastText: string;
	users: string[];
	/** The parts of the latest user message: `text`, `image:image/png`. */
	lastUserParts: string[];
	/** Pi's process. */
	pid: number;
}

function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function script(steps: Step[]) {
	writeFileSync(scriptFile, JSON.stringify(steps));
	writeFileSync(logFile, "");
}
/** What the model was sent, one entry per call. */
function seen(): Seen[] {
	return readFileSync(logFile, "utf8")
		.split("\n")
		.filter(Boolean)
		.map((l) => JSON.parse(l) as Seen);
}

const run = (prompt: string, events: Partial<AgentEvents> = {}, req: Partial<RpcRequest> = {}) =>
	rpc.run({ cwd: vault, systemPrompt: "PROTOCOL", prompt, tools: ICAP_TOOLS, skillPaths: [], model: "faux/m", ...req }, { onBridge: async () => ({ status: "ok" }), ...events });

beforeEach(() => {
	script([]);
	rmSync(breakFlag, { force: true });
});
afterAll(() => {
	rpc.dispose();
	for (const dir of [agentDir, outside, bin]) rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!posix)("the learner's own Pi over RPC", { timeout: 30000 }, () => {
	it("finds Pi at the path from the settings and reads its version", async () => {
		expect(await rpc.describe()).toMatch(/^Pi \d+\.\d+\.\d+$/);
		expect((await rpc.locate()).path).toBe(launcher);
	});

	it("a normal prompt ends with the model's reply; the protocol is appended to Pi's own system prompt", async () => {
		script([{ text: "hello back" }]);
		const texts: string[] = [];
		const r = await run("hello", { onText: (t) => texts.push(t) }).result;
		expect(r).toMatchObject({ text: "hello back", aborted: false });
		expect(texts.at(-1)).toBe("hello back");
		const system = seen()[0].system;
		expect(system).toContain("PROTOCOL");
		expect(system.startsWith("PROTOCOL")).toBe(false);
		expect(seen()[0].users).toEqual(["hello"]);
		// One process per task: when the task ends, its Pi has left.
		expect(alive(seen()[0].pid)).toBe(false);
	});

	it("sees the vault's and Pi's own AGENTS.md, not those above the vault", async () => {
		script([{ text: "ok" }]);
		await run("hi").result;
		const system = seen()[0].system;
		expect(system).toContain("VAULT-CONTEXT");
		expect(system).toContain("GLOBAL-CONTEXT");
		expect(system).not.toContain("OUTSIDE-CONTEXT");
	});

	it("offers ICAP's own skills by their files", async () => {
		const [skill] = ensureSkills(pluginDir, ["icap-visual"]);
		script([{ text: "ok" }]);
		await run("draw it", {}, { skillPaths: [skill] }).result;
		const system = seen()[0].system;
		expect(system).toContain("icap-visual");
		expect(system).toContain(join(skill, "SKILL.md"));
	});

	it("ICAP's tools reach the plugin over the local socket, and their result reaches the model", async () => {
		script([{ text: "let me ask", calls: [{ name: "ask_learner", args: { kind: "text", question: "What is RAII?" } }] }, { text: "thanks" }]);
		const calls: [string, Record<string, unknown>][] = [];
		const steps: string[] = [];
		const phases: AgentPhase[] = [];
		const r = await run("check me", {
			onBridge: async (op, p) => {
				calls.push([op, p]);
				return { status: "answered", answer: "scope-bound cleanup" };
			},
			onStep: (tool, detail) => steps.push(`${tool}: ${detail}`),
			onPhase: (p) => phases.push(p),
		}).result;
		expect(calls).toEqual([["ask", { kind: "text", question: "What is RAII?" }]]);
		expect(steps).toEqual(["ask_learner: What is RAII?"]);
		expect(phases).toContain("waiting");
		const second = seen()[1];
		expect(second.lastRole).toBe("toolResult");
		expect(second.lastText).toContain("scope-bound cleanup");
		expect(r.text).toBe("thanks");
	});

	it("the forwarder is a file in the plugin's folder that names every tool and holds no secret", async () => {
		script([{ text: "ok" }]);
		await run("hi").result;
		const source = readFileSync(join(pluginDir, "pi", "icap-extension.js"), "utf8");
		for (const tool of ICAP_TOOLS) expect(source).toContain(`"name": "${tool}"`);
		expect(source).not.toMatch(/[0-9a-f]{64}/);
	});

	it("a tool the task does not offer is not registered", async () => {
		script([{ text: "ok" }]);
		await run("hi", {}, { tools: ["obsidian"] }).result;
		const system = seen()[0].system;
		expect(system).toContain("obsidian:");
		expect(system).not.toContain("ask_learner:");
	});

	it("a tool's error is what the model is told", async () => {
		script([{ calls: [{ name: "create_note", args: { title: "A", content: "x", purpose: "test" } }] }, { text: "sorry" }]);
		await run("make it", { onBridge: async () => ({ status: "error", message: "A note named A exists." }) }).result;
		expect(seen()[1].lastText).toContain("A note named A exists.");
	});

	it("an unknown model is a clear error, not a hang", async () => {
		await expect(run("x", {}, { model: "nope/none" }).result).rejects.toThrow(/Pi could not start: .*nope/);
	});

	it("says where a run is: the session starts, the request is out, the reply begins, then the text", async () => {
		script([{ text: "hello back" }]);
		const phases: AgentPhase[] = [];
		await run("hello", { onPhase: (p) => phases.push(p) }).result;
		expect(phases.filter((p, i) => p !== phases[i - 1])).toEqual(["starting", "sending", "replying", "writing"]);
	});

	it("reports what each reply used and which model wrote it", async () => {
		script([{ text: "hello back" }]);
		const models: (string | null)[] = [];
		await run("hello", { onUsage: (_u, model) => models.push(model) }).result;
		expect(models).toEqual(["faux/m"]);
	});

	it("cancel stops a running turn, and Pi's process is gone", async () => {
		script([{ text: "late", delayMs: 20000 }]);
		const r = run("slow");
		await new Promise((res) => setTimeout(res, 1500));
		const at = Date.now();
		r.cancel();
		await expect(r.result).resolves.toMatchObject({ aborted: true });
		expect(Date.now() - at).toBeLessThan(8000);
		expect(alive(seen()[0].pid)).toBe(false);
	});

	it("a request block's session is resumed by its id: the second run continues the first", async () => {
		const session = { id: "icap-blockA-1", dir: sessions };
		script([{ text: "first reply" }]);
		await run("first question", {}, { session }).result;
		expect(readdirSync(sessions).some((f) => f.endsWith("_icap-blockA-1.jsonl"))).toBe(true);
		script([{ text: "second reply" }]);
		const r = await run("second question", {}, { session }).result;
		expect(r.text).toBe("second reply");
		expect(seen()[0].users).toEqual(["first question", "second question"]);
	});

	it("without a session nothing is kept", async () => {
		const before = readdirSync(sessions).length;
		script([{ text: "ok" }]);
		await run("hi").result;
		expect(readdirSync(sessions).length).toBe(before);
	});

	it("/compact of a session too small to compact is Pi's own error", async () => {
		const session = { id: "icap-blockB-1", dir: sessions };
		script([{ text: "first reply" }]);
		await run("first question", {}, { session }).result;
		await expect(run("", {}, { session, control: { type: "compact" } }).result).rejects.toThrow(/Nothing to compact/);
	});

	describe("a message while the agent works, images, and how full the context is", () => {
		/** A 1×1 PNG. */
		const PIXEL = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

		it("a message handed over during a tool call reaches the model before its next reply", async () => {
			script([{ text: "Looking it up.", calls: [{ name: "obsidian", args: { command: "search", query: "x" } }] }, { text: "With that in mind: done." }]);
			let handed = false;
			const steered: string[] = [];
			const r = run("first request", {
				onSteered: (t) => steered.push(t),
				// The learner writes while the tool runs; the tool's result follows a moment later.
				onBridge: async () => {
					handed = r.steer!("and keep it short");
					await new Promise((res) => setTimeout(res, 300));
					return { status: "ok", output: "found" };
				},
			});
			const result = await r.result;
			expect(handed).toBe(true);
			expect(seen()[1].users).toEqual(["first request", "and keep it short"]);
			expect(steered).toEqual(["and keep it short"]);
			// What it says after the message is the reply; the narration before it is not carried along.
			expect(result.text).toBe("With that in mind: done.");
			expect(r.steer!("too late")).toBe(false);
		});

		it("images go with the prompt to a model that reads them", async () => {
			script([{ text: "a red square" }]);
			let dropped = 0;
			await run("what is this?", { onImagesDropped: () => dropped++ }, { model: "faux/eye", images: [{ data: PIXEL, mimeType: "image/png" }] }).result;
			expect(seen()[0].lastUserParts).toEqual(["text", "image:image/png"]);
			expect(dropped).toBe(0);
		});

		it("a model that does not read images gets none, and the run says so", async () => {
			script([{ text: "I cannot see it" }]);
			let dropped = 0;
			await run("what is this?", { onImagesDropped: () => dropped++ }, { model: "faux/blind", images: [{ data: PIXEL, mimeType: "image/png" }] }).result;
			expect(seen()[0].lastUserParts).toEqual(["text"]);
			expect(dropped).toBe(1);
		});

		it("says how full the model's context is after a reply", async () => {
			script([{ text: "hello" }]);
			const context: [number, number][] = [];
			await run("hi", { onContext: (used, window) => context.push([used, window]) }, { model: "faux/eye" }).result;
			expect(context.length).toBeGreaterThan(0);
			const [used, window] = context.at(-1)!;
			expect(window).toBe(100000);
			expect(used).toBeGreaterThan(0);
			expect(used).toBeLessThan(window);
		});
	});

	describe("the learner's own extensions", () => {
		it("lists their commands and the models with credentials", async () => {
			const probe = await rpc.probe(vault, true);
			expect(probe.commands.map((c) => c.name)).toEqual(expect.arrayContaining(["notify", "silent", "turn", "gate"]));
			expect(probe.commands.find((c) => c.name === "notify")).toMatchObject({ source: "extension", description: "say hi" });
			expect(probe.models.available).toContain("faux/m");
		});
		it("an extension command that only notifies ends, with its message as the result", async () => {
			await expect(run("/notify world").result).resolves.toMatchObject({ text: "hi world", handled: true });
		});
		it("an extension command that does nothing visible still ends", async () => {
			await expect(run("/silent").result).resolves.toMatchObject({ text: "", handled: true });
		});
		it("an extension command that starts its own turn is waited for", async () => {
			script([{ text: "from the command, answered" }]);
			await expect(run("/turn").result).resolves.toMatchObject({ text: "from the command, answered", handled: true });
		});
		it("an extension that throws is reported by name while the run goes on", async () => {
			writeFileSync(breakFlag, "");
			script([{ text: "still answered" }]);
			const errors: string[] = [];
			const r = await run("hi", { onExtensionError: (m) => errors.push(m) }).result;
			expect(errors).toEqual(["broken: Illegal invocation"]);
			expect(r.text).toBe("still answered");
		});
		it("an extension that throws is the error when no reply comes", async () => {
			writeFileSync(breakFlag, "");
			await expect(run("/silent").result).rejects.toThrow("broken: Illegal invocation");
		});
		it("an extension's dialog is asked through onDialog, and its answer goes back", async () => {
			const asked: string[] = [];
			const r = await run("/gate", {
				onDialog: async (req) => {
					asked.push(`${req.method}:${req.title}:${req.message}`);
					return { confirmed: true };
				},
			}).result;
			expect(asked).toEqual(["confirm:Proceed?:really"]);
			expect(r.text).toBe("yes");
		});
		it("a dialog nobody answers is dismissed", async () => {
			const r = await run("/gate").result;
			expect(r.text).toBe("no");
		});
	});
});

describe.skipIf(!posix)("finding Pi", { timeout: 30000 }, () => {
	const fake = (version: string) => {
		const dir = mkdtempSync(join(tmpdir(), "icap-rpc-fake-"));
		writeFileSync(join(dir, "pi"), `#!/bin/sh\necho ${version}\n`);
		chmodSync(join(dir, "pi"), 0o755);
		return dir;
	};

	it("looks on PATH when the settings name no path", async () => {
		const dir = fake("1.5.2");
		const found = await findPi("", { PATH: dir, HOME: dir });
		expect(found).toMatchObject({ path: join(dir, "pi"), version: "1.5.2", args: [] });
	});

	it("a Pi older than 1.5.0 is refused, saying how to update", async () => {
		const dir = fake("1.4.9");
		await expect(findPi(join(dir, "pi"), {})).rejects.toThrow(/too old/);
		await expect(findPi(join(dir, "pi"), {})).rejects.toBeInstanceOf(SetupNeeded);
	});

	it("no Pi anywhere asks for a setup, and a path that is not there says so", async () => {
		const empty = mkdtempSync(join(tmpdir(), "icap-rpc-none-"));
		// HOME is the empty folder too, so the installers' usual places hold nothing either.
		const none = findPi("", { PATH: empty, HOME: empty }).catch((e: unknown) => e);
		if (!existsSync("/opt/homebrew/bin/pi") && !existsSync("/usr/local/bin/pi")) expect(await none).toBeInstanceOf(SetupNeeded);
		await expect(findPi(join(empty, "pi"), {})).rejects.toThrow(/no Pi at/);
	});
});
