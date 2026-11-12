import { spawn, type ChildProcess } from "child_process";
import type { Json } from "../../backend";
import { Lines, parseRecord, record } from "./jsonl";
import { spawnSpec, type PiCommand } from "./pi-command";

/**
 * One `pi --mode rpc` process: commands in on stdin, responses and events out on stdout, one JSON record
 * per line (jsonl.ts). Responses are matched to commands by id; everything else goes to `onRecord`.
 * Stderr is never parsed: its last lines are kept, to say why Pi stopped.
 */

const STDERR_KEEP = 4000;
/** After stdin closes, how long Pi gets to write its session and leave before it is killed. */
const CLOSE_GRACE_MS = 3000;

export interface PiExit {
	code: number | null;
	/** The process could not be started at all (no such file, no permission). */
	spawnError?: string;
}

/** What Pi last wrote to stderr, as a sentence: the last non-empty lines, without the "Error: " prefix. */
export function stderrMessage(stderr: string): string {
	const lines = stderr
		.split(/\r?\n/)
		.map((l) => l.trim())
		// Pi announces a session it is about to create; that is not why it stopped.
		.filter((l) => l && !l.startsWith("Warning: No project session found"));
	return lines.slice(-3).join(" ").replace(/^Error:\s*/, "");
}

export class PiProcess {
	private child: ChildProcess;
	private lines = new Lines();
	private pending = new Map<string, { resolve: (data: Json) => void; reject: (e: Error) => void }>();
	private seq = 0;
	private errTail = "";
	private ended: PiExit | null = null;
	private sawRecord = false;
	/** Resolves when the process is gone, however it went. */
	readonly exited: Promise<PiExit>;

	constructor(
		pi: PiCommand,
		args: string[],
		private opts: {
			cwd: string;
			env: NodeJS.ProcessEnv;
			/** Every record that is not a response to one of `request`'s commands: session events, extension UI requests. */
			onRecord: (rec: Json) => void;
		},
	) {
		const spec = spawnSpec(pi.path, [...pi.args, ...args]);
		this.child = spawn(spec.command, spec.args, {
			cwd: opts.cwd,
			env: opts.env,
			stdio: ["pipe", "pipe", "pipe"],
			// Its own process group on macOS and Linux, so what Pi started (a shell command, an MCP server) ends with it.
			detached: process.platform !== "win32",
			windowsHide: true,
			windowsVerbatimArguments: spec.verbatim,
		});
		this.exited = new Promise((resolve) => {
			const done = (exit: PiExit) => {
				if (this.ended) return;
				this.ended = exit;
				const why = new Error(this.exitMessage());
				for (const p of this.pending.values()) p.reject(why);
				this.pending.clear();
				resolve(exit);
			};
			this.child.once("error", (e) => done({ code: null, spawnError: e.message }));
			this.child.once("close", (code) => done({ code }));
		});
		this.child.stdout?.on("data", (chunk: Buffer) => {
			for (const line of this.lines.push(chunk)) {
				const rec = parseRecord(line);
				if (rec) this.receive(rec);
			}
		});
		this.child.stderr?.on("data", (chunk: Buffer) => {
			this.errTail = (this.errTail + chunk.toString("utf8")).slice(-STDERR_KEEP);
		});
		// A Pi that is gone closes its stdin under a write: the exit says why, the write error says nothing.
		this.child.stdin?.on("error", () => undefined);
	}

	/** Has Pi written a record yet? Before the first, a process that stops has failed to start. */
	get started(): boolean {
		return this.sawRecord;
	}

	/** Why the process is gone, for the learner. */
	exitMessage(): string {
		const exit = this.ended;
		if (exit?.spawnError) return `Pi could not start: ${exit.spawnError}`;
		const said = stderrMessage(this.errTail);
		if (!this.sawRecord) return `Pi could not start: ${said || `it exited with code ${exit?.code ?? "?"}`}`;
		return `Pi stopped unexpectedly${exit?.code ? ` (exit code ${exit.code})` : ""}${said ? `: ${said}` : "."}`;
	}

	private receive(rec: Json) {
		this.sawRecord = true;
		if (rec.type === "response" && typeof rec.id === "string" && this.pending.has(rec.id)) {
			const p = this.pending.get(rec.id)!;
			this.pending.delete(rec.id);
			if (rec.success === false) p.reject(new Error(typeof rec.error === "string" && rec.error ? rec.error : `Pi refused “${String(rec.command)}”.`));
			else p.resolve(rec.data && typeof rec.data === "object" ? (rec.data as Json) : {});
			return;
		}
		this.opts.onRecord(rec);
	}

	/** Write one record; false when Pi is gone. */
	send(rec: Json): boolean {
		if (this.ended || !this.child.stdin?.writable) return false;
		this.child.stdin.write(record(rec));
		return true;
	}

	/** Send a command and wait for its response's `data`. Rejects when Pi refuses it, or goes before answering. */
	request(command: Json): Promise<Json> {
		if (this.ended) return Promise.reject(new Error(this.exitMessage()));
		const id = `icap-${++this.seq}`;
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			if (!this.send({ ...command, id })) {
				this.pending.delete(id);
				reject(new Error(this.exitMessage()));
			}
		});
	}

	/**
	 * End the process in order: closing stdin asks Pi to dispose its session and exit. A Pi that has not
	 * left after the grace is killed with everything it started.
	 */
	async close(graceMs = CLOSE_GRACE_MS): Promise<void> {
		if (this.ended) return;
		this.child.stdin?.end();
		let timer = 0;
		const late = new Promise<"late">((r) => (timer = window.setTimeout(() => r("late"), graceMs)));
		const how = await Promise.race([this.exited, late]);
		window.clearTimeout(timer);
		if (how === "late") {
			this.kill();
			await this.exited;
		}
	}

	/** Kill Pi and what it started, now: the process group (macOS, Linux), or `taskkill /T /F` (Windows). */
	kill() {
		const pid = this.child.pid;
		if (this.ended || !pid) return;
		if (process.platform === "win32") {
			const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
			killer.once("error", () => this.child.kill());
			return;
		}
		try {
			process.kill(-pid, "SIGKILL");
		} catch {
			this.child.kill("SIGKILL");
		}
	}
}
