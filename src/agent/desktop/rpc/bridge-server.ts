import { randomBytes } from "crypto";
import { chmodSync } from "fs";
import { createServer, type Server, type Socket } from "net";
import type { Json } from "../../backend";
import { Lines, parseRecord, record } from "./jsonl";

/**
 * How ICAP's tools reach the plugin from an agent that runs in another process (the learner's own Pi):
 * a socket on this computer only: a Unix domain socket on macOS and Linux, a named pipe on Windows.
 * Nothing listens on the network. The other end is `icap-extension.js` (icap-forwarder.ts), which
 * only forwards: the tools run here, in the plugin (agent/tools/icap-tools.ts).
 *
 * Each task gets a token of its own, valid while the task runs. A call without a live token is refused.
 * One JSON record per line, both ways:
 *   → {"id": 1, "token": "…", "tool": "ask_learner", "params": {…}}
 *   ← {"id": 1, "ok": true, "text": "…", "details": {…}}   or   {"id": 1, "ok": false, "error": "…"}
 */

/** The environment variables the forwarder reads. The socket and the token never appear on a command line. */
export const BRIDGE_ENV = { socket: "ICAP_BRIDGE", token: "ICAP_BRIDGE_TOKEN", tools: "ICAP_TOOLS" } as const;

/** One tool call, run by the plugin: the text for the model and the details kept with the result. Throws on error. */
export type ToolRunner = (tool: string, params: Json) => Promise<{ text: string; details: Json | undefined }>;

/** A task's access to the bridge. */
export interface BridgeTask {
	/** What the agent's process needs in its environment. */
	env: Record<string, string>;
	/** The task ended: its token stops working. */
	close(): void;
}

export class ToolBridge {
	private server: Server | null = null;
	private listening: Promise<void> | null = null;
	private tasks = new Map<string, ToolRunner>();
	private sockets = new Set<Socket>();

	/** `path`: where to listen: a file in a folder only this user can open, or a `\\.\pipe\…` name. */
	constructor(private path: string) {}

	private listen(): Promise<void> {
		this.listening ??= new Promise<void>((resolve, reject) => {
			const server = createServer((socket) => this.serve(socket));
			server.once("error", (e) => {
				this.listening = null;
				reject(e instanceof Error ? e : new Error(String(e)));
			});
			server.listen(this.path, () => {
				// The folder already keeps other users out; the socket itself is closed to them too.
				if (process.platform !== "win32") {
					try {
						chmodSync(this.path, 0o600);
					} catch {
						/* the folder's own permissions still hold */
					}
				}
				this.server = server;
				resolve();
			});
			// An idle bridge must not keep Obsidian's process alive.
			server.unref();
		});
		return this.listening;
	}

	private serve(socket: Socket) {
		this.sockets.add(socket);
		const lines = new Lines();
		const reply = (rec: Json) => {
			if (!socket.destroyed) socket.write(record(rec));
		};
		socket.on("data", (chunk: Buffer) => {
			for (const line of lines.push(chunk)) {
				const rec = parseRecord(line);
				if (rec) void this.call(rec, reply);
			}
		});
		socket.on("error", () => undefined);
		socket.on("close", () => this.sockets.delete(socket));
	}

	private async call(rec: Json, reply: (rec: Json) => void) {
		const id = rec.id;
		const run = typeof rec.token === "string" ? this.tasks.get(rec.token) : undefined;
		if (!run) return reply({ id, ok: false, error: "This task has ended; its tools no longer answer." });
		if (typeof rec.tool !== "string") return reply({ id, ok: false, error: "No tool named." });
		try {
			const params = rec.params && typeof rec.params === "object" ? (rec.params as Json) : {};
			const { text, details } = await run(rec.tool, params);
			reply({ id, ok: true, text, details });
		} catch (e) {
			reply({ id, ok: false, error: e instanceof Error ? e.message : String(e) });
		}
	}

	/** Let a task's agent call `run` until the task closes. Starts listening on first use. */
	async open(run: ToolRunner, tools: string[]): Promise<BridgeTask> {
		await this.listen();
		const token = randomBytes(32).toString("hex");
		this.tasks.set(token, run);
		return {
			env: { [BRIDGE_ENV.socket]: this.path, [BRIDGE_ENV.token]: token, [BRIDGE_ENV.tools]: tools.join(",") },
			close: () => void this.tasks.delete(token),
		};
	}

	/** Stop listening and drop every connection (the plugin unloads). */
	dispose() {
		this.tasks.clear();
		for (const s of this.sockets) s.destroy();
		this.sockets.clear();
		this.server?.close();
		this.server = null;
		this.listening = null;
	}
}
