import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { IcapTool } from "../../tools/icap-tools";
import { BRIDGE_ENV } from "./bridge-server";

/**
 * `icap-extension.js`: ICAP's tools as a Pi extension file, for a Pi that runs in its own process
 * (`pi --mode rpc -e <plugin>/pi/icap-extension.js`). It ships inside main.js and is written to the
 * plugin's folder on first use. It only forwards: each tool call goes over the local socket
 * (bridge-server.ts) to the plugin, where the tool runs (agent/tools/icap-tools.ts), and the answer
 * comes back the same way. It has no dependencies, so it loads in any Pi 1.5 or later; the tools'
 * schemas are plain JSON Schema, which is what Pi validates arguments against.
 *
 * The socket's path and the task's token arrive in the environment. Loaded without them (the file was
 * named in someone's own Pi settings), it registers nothing.
 */

/** What the forwarder is told about each tool: what the model sees, nothing of how it runs. */
export interface ForwardedTool {
	name: string;
	label: string;
	description: string;
	promptSnippet: string;
	parameters: unknown;
	sequential: boolean;
}

export function forwardedTools(tools: IcapTool[]): ForwardedTool[] {
	return tools.map((t) => ({
		name: t.name,
		label: t.label,
		description: t.description,
		promptSnippet: t.promptSnippet,
		// A plain copy: a TypeBox schema is JSON Schema plus hidden marks, which a file cannot carry.
		parameters: JSON.parse(JSON.stringify(t.parameters)) as unknown,
		sequential: t.sequential,
	}));
}

/** The extension's source. Plain JavaScript (an ES module), written for Node 22: no build step reads it. */
export function forwarderSource(tools: ForwardedTool[]): string {
	return `// ICAP Learning Agent: ICAP's tools for a Pi started by the Obsidian plugin.
// Written by the plugin; edits are overwritten. It only forwards tool calls to the plugin over a local socket.
import { connect } from "node:net";

const TOOLS = ${JSON.stringify(tools, null, "\t")};

export default function (pi) {
	const path = process.env.${BRIDGE_ENV.socket};
	const token = process.env.${BRIDGE_ENV.token};
	// Started by something other than the plugin: there is no plugin to forward to.
	if (!path || !token) return;
	const offered = (process.env.${BRIDGE_ENV.tools} || "").split(",").filter(Boolean);

	let socket = null;
	let buffer = "";
	let seq = 0;
	const pending = new Map();

	function fail(message) {
		for (const p of pending.values()) p.reject(new Error(message));
		pending.clear();
		socket = null;
		buffer = "";
	}

	function open() {
		if (socket) return socket;
		const s = connect(path);
		s.setEncoding("utf8");
		// Pi's own stdin keeps it running; this connection must not hold it open once Pi is told to leave.
		s.unref();
		s.on("data", (chunk) => {
			buffer += chunk;
			for (;;) {
				const i = buffer.indexOf("\\n");
				if (i < 0) break;
				const line = buffer.slice(0, i);
				buffer = buffer.slice(i + 1);
				if (!line.trim()) continue;
				let rec;
				try {
					rec = JSON.parse(line);
				} catch {
					continue;
				}
				const p = pending.get(rec.id);
				if (!p) continue;
				pending.delete(rec.id);
				if (rec.ok) p.resolve(rec);
				else p.reject(new Error(rec.error || "The tool failed."));
			}
		});
		s.on("error", (e) => {
			if (socket === s) fail("Obsidian did not answer (" + e.message + ").");
		});
		s.on("close", () => {
			if (socket === s) fail("Obsidian closed the connection.");
		});
		socket = s;
		return s;
	}

	function call(tool, params) {
		return new Promise((resolve, reject) => {
			const id = ++seq;
			pending.set(id, { resolve, reject });
			open().write(JSON.stringify({ id, token, tool, params }) + "\\n");
		});
	}

	for (const tool of TOOLS) {
		if (!offered.includes(tool.name)) continue;
		pi.registerTool({
			name: tool.name,
			label: tool.label,
			description: tool.description,
			promptSnippet: tool.promptSnippet,
			parameters: tool.parameters,
			...(tool.sequential ? { executionMode: "sequential" } : {}),
			async execute(_id, params) {
				const result = await call(tool.name, params);
				return { content: [{ type: "text", text: result.text }], details: result.details };
			},
		});
	}

	pi.on("session_shutdown", () => {
		if (socket) socket.destroy();
	});
}
`;
}

/** Write the extension under the plugin folder (when it changed) and return its path for Pi's `-e`. */
export function ensureForwarder(pluginDir: string, tools: IcapTool[]): string {
	const dir = join(pluginDir, "pi");
	const file = join(dir, "icap-extension.js");
	const want = forwarderSource(forwardedTools(tools));
	let have = "";
	try {
		have = readFileSync(file, "utf8");
	} catch {
		/* not written yet */
	}
	if (have !== want) {
		mkdirSync(dir, { recursive: true });
		writeFileSync(file, want);
	}
	return file;
}
