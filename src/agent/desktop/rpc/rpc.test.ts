import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "node:net";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { icapTools, ICAP_TOOLS } from "../../tools/icap-tools";
import { BRIDGE_ENV, ToolBridge } from "./bridge-server";
import { forwardedTools, forwarderSource } from "./icap-forwarder";
import { Lines, parseRecord, record } from "./jsonl";
import { installCommands, parseVersion, spawnSpec, versionAtLeast } from "./pi-command";
import { contextFiles, piAgentDir } from "./pi-rpc";
import { stderrMessage } from "./rpc-process";
import { rpcArgs } from "./rpc-session";

describe("JSONL framing", () => {
	it("splits on LF only: U+2028 and U+2029 stay inside their record", () => {
		const lines = new Lines();
		const a = JSON.stringify({ text: "one\u2028two\u2029three" });
		expect(lines.push(`${a}\n{"b":`)).toEqual([a]);
		expect(lines.push(`1}\r\n\n`)).toEqual(['{"b":1}']);
	});

	it("a character cut between two chunks arrives whole", () => {
		const lines = new Lines();
		const bytes = Buffer.from('{"t":"学习"}\n', "utf8");
		const cut = bytes.indexOf(Buffer.from("习")) + 1;
		expect(lines.push(bytes.subarray(0, cut))).toEqual([]);
		expect(lines.push(bytes.subarray(cut))).toEqual(['{"t":"学习"}']);
	});

	it("writes one line per record and skips what is not a JSON object", () => {
		expect(record({ message: "a\nb" })).toBe('{"message":"a\\nb"}\n');
		expect(parseRecord('{"type":"x"}')).toEqual({ type: "x" });
		expect(parseRecord("not json")).toBeNull();
		expect(parseRecord("[1]")).toBeNull();
	});
});

describe("finding Pi", () => {
	it("reads the version out of what --version prints", () => {
		expect(parseVersion("1.5.2\n")).toBe("1.5.2");
		expect(parseVersion("pi v1.10.0 (abc)")).toBe("1.10.0");
		expect(parseVersion("command not found")).toBeNull();
	});

	it("compares versions by number, not by text", () => {
		expect(versionAtLeast("1.5.0", "1.5.0")).toBe(true);
		expect(versionAtLeast("1.10.0", "1.5.0")).toBe(true);
		expect(versionAtLeast("2.0.0", "1.5.0")).toBe(true);
		expect(versionAtLeast("1.4.9", "1.5.0")).toBe(false);
	});

	it("starts an executable directly, and npm's pi.cmd on Windows through cmd.exe with quoted arguments", () => {
		expect(spawnSpec("/usr/local/bin/pi", ["--mode", "rpc"], "darwin")).toEqual({ command: "/usr/local/bin/pi", args: ["--mode", "rpc"], verbatim: false });
		expect(spawnSpec("C:\\Program Files\\pi\\pi.exe", ["--version"], "win32")).toMatchObject({ command: "C:\\Program Files\\pi\\pi.exe", verbatim: false });
		const cmd = spawnSpec("C:\\Users\\A B\\AppData\\Roaming\\npm\\pi.cmd", ["--mode", "rpc", "-e", "C:\\My Vault\\.obsidian\\plugins\\icap-agent\\pi\\icap-extension.js"], "win32", "C:\\Windows\\system32\\cmd.exe");
		expect(cmd.command).toBe("C:\\Windows\\system32\\cmd.exe");
		expect(cmd.verbatim).toBe(true);
		expect(cmd.args).toEqual(["/d", "/s", "/c", '""C:\\Users\\A B\\AppData\\Roaming\\npm\\pi.cmd" --mode rpc -e "C:\\My Vault\\.obsidian\\plugins\\icap-agent\\pi\\icap-extension.js""']);
	});

	it("names the official installer of the platform", () => {
		expect(installCommands("darwin").installer).toBe("curl -fsSL https://pi.dev/install.sh | sh");
		expect(installCommands("win32").installer).toContain("install.ps1");
	});
});

describe("starting Pi for a task", () => {
	const base = { promptFile: "/tmp/p.md", bridge: { extension: "/v/pi/icap-extension.js", env: {} } };

	it("turns off Pi's own context files, appends the protocol, loads the forwarder, keeps no session by default", () => {
		expect(rpcArgs(base)).toEqual(["--mode", "rpc", "-nc", "--append-system-prompt", "/tmp/p.md", "-e", "/v/pi/icap-extension.js", "--no-session"]);
	});

	it("names the model by provider and id (an id may hold a slash), the thinking level, skills and the session", () => {
		const args = rpcArgs({ ...base, model: "openrouter/anthropic/claude-sonnet-5", thinking: "low", skillPaths: ["/v/skills/icap-visual"], session: { id: "icap-ab12-2", dir: "/v/sessions" } });
		expect(args.join(" ")).toContain("--provider openrouter --model anthropic/claude-sonnet-5");
		expect(args.join(" ")).toContain("--thinking low");
		expect(args.join(" ")).toContain("--skill /v/skills/icap-visual");
		expect(args.join(" ")).toContain("--session-dir /v/sessions --session-id icap-ab12-2");
		expect(args).not.toContain("--no-session");
	});

	it("says why Pi stopped from its last lines, not from the session it announced", () => {
		expect(stderrMessage("Warning: No project session found with id 'icap-a-1'; creating a new session with that id.\n")).toBe("");
		expect(stderrMessage('Error: Model "nope/none" not found. Use --list-models to see available models.\n')).toBe('Model "nope/none" not found. Use --list-models to see available models.');
	});
});

describe("context files for the learner's Pi", () => {
	it("takes Pi's global file and the vault's, the first of Pi's names in each, never an ancestor's", () => {
		const home = mkdtempSync(join(tmpdir(), "icap-ctx-"));
		const agent = mkdtempSync(join(tmpdir(), "icap-ctx-agent-"));
		const vault = join(home, "vault");
		mkdirSync(vault);
		writeFileSync(join(home, "AGENTS.md"), "above");
		writeFileSync(join(vault, "CLAUDE.md"), "\uFEFFvault rules");
		writeFileSync(join(agent, "AGENTS.md"), "global rules");
		expect(contextFiles(vault, agent)).toEqual([
			{ path: join(agent, "AGENTS.md"), content: "global rules" },
			{ path: join(vault, "CLAUDE.md"), content: "vault rules" },
		]);
	});

	it("finds Pi's folder the way Pi does", () => {
		expect(piAgentDir({ PI_CODING_AGENT_DIR: "/x/agent" })).toBe("/x/agent");
		expect(piAgentDir({})).toMatch(/\.pi[\\/]agent$/);
	});
});

describe("the forwarder extension", () => {
	const tools = forwardedTools(icapTools(Type, async () => ({})));

	it("carries every tool as plain JSON Schema", () => {
		expect(tools.map((t) => t.name).sort()).toEqual([...ICAP_TOOLS].sort());
		const ask = tools.find((t) => t.name === "ask_learner")!;
		expect(ask.sequential).toBe(true);
		expect(JSON.parse(JSON.stringify(ask.parameters))).toEqual(ask.parameters);
		expect((ask.parameters as { type: string; required: string[] }).type).toBe("object");
		expect((ask.parameters as { required: string[] }).required).toEqual(expect.arrayContaining(["kind", "question"]));
	});

	it("is a module with a default export that reads the socket and the token from the environment only", () => {
		const source = forwarderSource(tools);
		expect(source).toContain("export default function (pi)");
		for (const name of Object.values(BRIDGE_ENV)) expect(source).toContain(`process.env.${name}`);
		// The newline the records end with is written as an escape, not as a line break inside a string.
		expect(source).toContain('+ "\\n")');
		expect(source).not.toMatch(/require\(|from "(?!node:net")/);
	});
});

describe("the local socket", () => {
	let bridge: ToolBridge | null = null;
	afterEach(() => bridge?.dispose());

	/** Send one record, read one back. */
	const ask = (path: string, rec: unknown) =>
		new Promise<Record<string, unknown>>((resolve, reject) => {
			const s = connect(path);
			s.setEncoding("utf8");
			let buffer = "";
			s.on("data", (c: string) => {
				buffer += c;
				if (buffer.includes("\n")) {
					s.destroy();
					resolve(JSON.parse(buffer) as Record<string, unknown>);
				}
			});
			s.on("error", reject);
			s.write(JSON.stringify(rec) + "\n");
		});

	it.skipIf(process.platform === "win32")("answers a task's token, refuses any other, and stops answering when the task closes", async () => {
		const path = join(mkdtempSync(join(tmpdir(), "icap-sock-")), "bridge.sock");
		bridge = new ToolBridge(path);
		const task = await bridge.open(async (tool, params) => ({ text: `${tool}:${JSON.stringify(params)}`, details: undefined }), ["obsidian"]);
		expect(task.env[BRIDGE_ENV.socket]).toBe(path);
		expect(task.env[BRIDGE_ENV.tools]).toBe("obsidian");
		const token = task.env[BRIDGE_ENV.token];
		expect(token).toMatch(/^[0-9a-f]{64}$/);

		expect(await ask(path, { id: 1, token, tool: "obsidian", params: { command: "tags" } })).toEqual({ id: 1, ok: true, text: 'obsidian:{"command":"tags"}' });
		expect(await ask(path, { id: 2, token: "0".repeat(64), tool: "obsidian", params: {} })).toMatchObject({ id: 2, ok: false });
		task.close();
		expect(await ask(path, { id: 3, token, tool: "obsidian", params: {} })).toMatchObject({ id: 3, ok: false });
	});

	it.skipIf(process.platform === "win32")("a tool that throws answers with its message", async () => {
		const path = join(mkdtempSync(join(tmpdir(), "icap-sock-")), "bridge.sock");
		bridge = new ToolBridge(path);
		const task = await bridge.open(async () => {
			throw new Error("A note named A exists.");
		}, []);
		expect(await ask(path, { id: 7, token: task.env[BRIDGE_ENV.token], tool: "create_note", params: {} })).toEqual({ id: 7, ok: false, error: "A note named A exists." });
	});
});
