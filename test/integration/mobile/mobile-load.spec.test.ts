import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { readRecords } from "../../../src/dsl/records";
import { boot, readMain, type Phone } from "./phone";

/**
 * The built main.js on a phone: loaded where there is no Node (no fs, no process, no Buffer), with
 * Obsidian's Platform saying mobile. If this fails, the plugin fails on an iPhone.
 *
 * The model is a fake server behind the WebView's fetch (and Obsidian's requestUrl): pi-ai's faux
 * provider lives in this test's realm and cannot be handed to the bundle, so the bundle's own pi-ai
 * adapter (OpenAI Chat Completions, as DeepSeek speaks it) parses real server-sent events.
 */

const MAIN = resolve("main.js");

function sse(chunks: unknown[]): string {
	return chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
}

const chunk = (delta: object, finish: string | null = null, usage?: object) => ({
	id: "c1",
	object: "chat.completion.chunk",
	created: 0,
	model: "deepseek-flash",
	choices: [{ index: 0, delta, finish_reason: finish }],
	...(usage ? { usage } : {}),
});

/** Turn 1: the agent reads the note through the `obsidian` tool. Turn 2: it answers. */
function scriptedServer(seen: { bodies: any[]; auth: string[] }) {
	return (body: any): string => {
		seen.bodies.push(body);
		const toolResult = (body.messages as any[]).some((m) => m.role === "tool");
		if (!toolResult)
			return sse([
				chunk({ role: "assistant", content: "" }),
				chunk({ tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "obsidian", arguments: "" } }] }),
				chunk({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ command: "read", path: "Heap.md" }) } }] }),
				chunk({}, "tool_calls", { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }),
			]);
		return sse([
			chunk({ role: "assistant", content: "The heap is " }),
			chunk({ content: "memory you allocate at run time." }),
			chunk({}, "stop", { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 }),
		]);
	};
}

const NOTE = "# Heap\n\nThe heap holds objects whose lifetime you manage.\n";

async function settle(phone: Phone, done: () => boolean, ms = 10000) {
	const end = Date.now() + ms;
	while (!done()) {
		if (Date.now() > end) throw new Error(`timed out; notices: ${phone.notices.join(" | ")}`);
		await new Promise((r) => setTimeout(r, 20));
	}
}

describe.skipIf(!existsSync(MAIN))("main.js on a phone (no Node)", () => {
	const main = existsSync(MAIN) ? readMain(MAIN) : "";

	// Found on a real iPhone: motion's animate() read `process.env.NODE_ENV` on every call, so every
	// animation threw and whatever waited for one (keep, closing the activity) never finished. The build
	// must replace it (`define` in vite.config.ts). What is left are mentions inside strings in desktop's
	// Pi bundle (`=> process.env.NODE_ENV`), never code that runs on a phone.
	it("has no `process.env.NODE_ENV` left as code", () => {
		const uses = [...main.matchAll(/(.{3})process\.env\.NODE_ENV/g)].filter((m) => m[1] !== "=> ");
		expect(uses.length).toBe(0);
	});

	it("loads with Platform.isMobile and never asks for a Node built-in", async () => {
		const phone = await boot(main);
		expect(phone.required.filter((r) => !r.startsWith("@codemirror/") && !r.startsWith("@lezer/") && r !== "obsidian")).toEqual([]);
		expect(phone.plugin.backend.platform).toBe("mobile");
		expect(phone.plugin.backend.capabilities.ownSetup).toBe(false);
		// Mobile has no status bar: the activity opens from the ribbon.
		expect(phone.plugin.statusBar).toBe(0);
		expect(phone.plugin.ribbon.map((r: any) => r.icon)).toContain("activity");
		// Every command has an icon (the mobile toolbar shows icons); task commands are editor commands.
		for (const c of phone.plugin.commands) expect(c.icon, c.id).toBeTruthy();
		for (const id of ["ask-agent", "explain-selection", "recall-from-memory", "check-my-words", "quiz-section", "quiz-note", "concept-note"])
			expect(phone.plugin.commands.find((c: any) => c.id === id)?.editorCheckCallback, id).toBeTypeOf("function");
	});

	it("runs a request end to end: tool call, reply, kept record", async () => {
		const phone = await boot(main, { files: { "Heap.md": NOTE }, secrets: { "icap-deepseek": "sk-test" } });
		const seen = { bodies: [] as any[], auth: [] as string[] };
		const server = scriptedServer(seen);
		phone.setFetch(async (input: any, init?: RequestInit) => {
			const url = typeof input === "string" ? input : input.url;
			expect(url).toMatch(/deepseek\.com.*\/chat\/completions$/);
			seen.auth.push(new Headers(init?.headers).get("authorization") ?? "");
			const body = JSON.parse(String(init?.body));
			return new Response(server(body), { status: 200, headers: { "content-type": "text/event-stream" } });
		});
		const rt = phone.plugin.runtime;
		await rt.requestBelow("Heap.md", 2, "What is the heap?");
		const block = [...rt.blocks.values()][0];
		await settle(phone, () => block.phase === "completed" || block.phase === "failed");
		expect(block.error ?? null).toBeNull();
		expect(block.phase).toBe("completed");
		expect(seen.auth[0]).toBe("Bearer sk-test");
		// The tool ran against the vault: its result reached the model.
		const toolMsg = seen.bodies[1].messages.find((m: any) => m.role === "tool");
		expect(String(toolMsg.content)).toContain("lifetime you manage");
		// Mobile's system prompt: ICAP's tools, no file tools, no skills to read.
		const system = seen.bodies[0].messages.find((m: any) => m.role === "system" || m.role === "developer");
		expect(String(system.content)).not.toContain("read / grep / find / ls");
		expect(String(system.content)).toContain("ask_learner");
		expect(block.summary).toBe("The heap is memory you allocate at run time.");
		await rt.keepBlock(block);
		const note = phone.files.get("Heap.md")!;
		// The kept record is plain Markdown, written by the runtime the desktop shares (FORMAT.md).
		expect(note).toBe("# Heap\n\nThe heap holds objects whose lifetime you manage.\n\n> [!request] What is the heap?\n> **Request:** What is the heap?\n>\n> The heap is memory you allocate at run time.\n\n");
		expect(note).not.toContain("```icap-ask");
		const records = readRecords(note);
		expect(records.records).toHaveLength(1);
		expect(records.records[0]).toMatchObject({ kind: "request" });
		expect(records.records[0]).toMatchObject({ title: "What is the heap?" });
		expect(note).toContain("memory you allocate at run time");
	});

	it("a custom endpoint that only answers through requestUrl arrives whole", async () => {
		const endpoint = { id: "lan", name: "LAN", baseUrl: "http://192.168.1.20:11434/v1", api: "openai-completions", models: ["qwen3"], transport: "whole", hasKey: false };
		const phone = await boot(main, { files: { "Heap.md": NOTE }, data: { settings: { mobileEndpoints: [endpoint], mobileModel: "lan/qwen3" } } });
		const seen = { bodies: [] as any[], auth: [] as string[] };
		const server = scriptedServer(seen);
		// The WebView's fetch is refused (CORS); only requestUrl reaches the server.
		phone.setFetch(async () => {
			throw new TypeError("Load failed");
		});
		const urls: string[] = [];
		phone.setRequestUrl(async (req) => {
			urls.push(req.url);
			return { status: 200, headers: { "content-type": "text/event-stream" }, text: server(JSON.parse(String(req.body))) };
		});
		const phases: string[] = [];
		const rt = phone.plugin.runtime;
		await rt.requestBelow("Heap.md", 2, "What is the heap?");
		const block = [...rt.blocks.values()][0];
		const watch = setInterval(() => block.agentPhase && phases.at(-1) !== block.agentPhase && phases.push(block.agentPhase), 1);
		await settle(phone, () => block.phase === "completed" || block.phase === "failed");
		clearInterval(watch);
		expect(block.error ?? null).toBeNull();
		expect(urls).toEqual(["http://192.168.1.20:11434/v1/chat/completions", "http://192.168.1.20:11434/v1/chat/completions"]);
		expect(block.summary).toBe("The heap is memory you allocate at run time.");
	});

	it("without a key, the task says so and offers the settings", async () => {
		const phone = await boot(main, { files: { "Heap.md": NOTE } });
		const rt = phone.plugin.runtime;
		await rt.requestBelow("Heap.md", 2, "What is the heap?");
		const block = [...rt.blocks.values()][0];
		await settle(phone, () => block.phase === "failed");
		expect(block.error).toMatch(/API key/);
		expect(phone.notices.some((n) => /Open settings/.test(n))).toBe(true);
	});

	it("a connection lost mid-reply interrupts the task; continue resumes it", async () => {
		const phone = await boot(main, { files: { "Heap.md": NOTE }, secrets: { "icap-deepseek": "sk-test" } });
		const seen = { bodies: [] as any[], auth: [] as string[] };
		const server = scriptedServer(seen);
		let drop = true;
		phone.setFetch(async (_input: any, init?: RequestInit) => {
			if (drop) {
				drop = false;
				throw new TypeError("Load failed");
			}
			return new Response(server(JSON.parse(String(init?.body))), { status: 200, headers: { "content-type": "text/event-stream" } });
		});
		const rt = phone.plugin.runtime;
		await rt.requestBelow("Heap.md", 2, "What is the heap?");
		const block = [...rt.blocks.values()][0];
		await settle(phone, () => block.phase === "interrupted" || block.phase === "failed" || block.phase === "completed");
		expect(block.phase).toBe("interrupted");
		await rt.resume(block);
		await settle(phone, () => block.phase === "completed" || block.phase === "failed");
		expect(block.phase).toBe("completed");
		expect(block.summary).toContain("memory you allocate");
	});

	it("settings render on a phone: a key per provider, custom endpoints, no login", async () => {
		const phone = await boot(main, { secrets: { "icap-anthropic": "sk-ant" } });
		const el = phone.window.document.createElement("div");
		phone.plugin.backend.accounts.render(el, () => undefined);
		const names = [...el.querySelectorAll(".setting-item-name")].map((n: any) => n.textContent);
		expect(names).toEqual(expect.arrayContaining(["Anthropic ✓", "OpenAI", "Google Gemini", "OpenRouter", "DeepSeek", "Mistral", "Groq", "xAI", "Custom endpoints"]));
		expect(el.textContent).toContain("Stored on this device only.");
		const models = await phone.plugin.backend.probeModels("isolated");
		expect(models.current).toMatch(/^anthropic\//);
		expect(models.available.every((m: string) => m.startsWith("anthropic/"))).toBe(true);
	});
});
