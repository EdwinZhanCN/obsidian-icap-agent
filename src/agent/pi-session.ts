import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { JsonlSplitter, encodeRecord } from "./jsonl";
import type { PiEnvironment } from "./pi-env";

/** Phases the document is allowed to know about. Never tool names, never thoughts. */
export type AgentPhase = "starting" | "thinking" | "reading" | "writing" | "waiting";

export type BridgeHandler = (op: string, payload: Record<string, unknown>) => Promise<Record<string, unknown>>;

/** The tools the ICPA extension registers (pi/icpa-bridge.ts). */
export const ICPA_TOOLS = ["obsidian", "read_document", "ask_learner", "create_note", "propose_edit"];

/**
 * How Pi is started.
 * - "mine": the learner's own Pi — their skills, extensions, MCP, context files, project trust and
 *   built-in tools — plus the ICPA extension; the ICPA protocol is appended to their system prompt.
 * - "isolated": only the ICPA extension, read-only built-in tools, and the ICPA protocol as the
 *   whole system prompt.
 */
export type AgentConfig = "mine" | "isolated";

/** A dialog requested by one of the learner's own extensions (not an icpa: bridge call). */
export interface DialogRequest {
	method: "select" | "confirm" | "input" | "editor";
	title: string;
	message?: string;
	options?: string[];
	placeholder?: string;
	prefill?: string;
}

/** What the learner answered; `undefined` = dismissed. */
export type DialogAnswer = { value: string } | { confirmed: boolean } | undefined;

export interface RunOptions {
	env: PiEnvironment;
	extensionPath: string;
	cwd: string;
	config: AgentConfig;
	systemPrompt: string;
	prompt: string;
	/**
	 * The tools this task uses. Isolated: the exact allowlist. Mine: only decides which ICPA tools
	 * are hidden; the learner's own tools are left alone.
	 */
	tools: string[];
	/** Isolated mode: file tools may only reach these folders (the vault + what the learner allowed). */
	allowedRoots?: string[];
	model?: string;
	thinking?: string;
	/** Full text of the assistant message currently streaming (narration before tool calls is dropped). */
	onText?: (text: string) => void;
	onPhase?: (phase: AgentPhase) => void;
	/** A tool call started (true) or finished (false); file changes in between are the agent's. */
	onTool?: (running: boolean) => void;
	onBridge: BridgeHandler;
	/** Show a dialog from one of the learner's extensions; absent = dismiss it. Aborted on timeout. */
	onDialog?: (req: DialogRequest, signal: AbortSignal) => Promise<DialogAnswer>;
}

export function piArgs(o: Pick<RunOptions, "config" | "extensionPath" | "systemPrompt" | "tools" | "model" | "thinking">): string[] {
	const args = ["--mode", "rpc", "--no-session", "-e", o.extensionPath];
	if (o.config === "isolated") {
		args.push(
			"--no-approve",
			"--no-extensions",
			"--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files", "--no-mcp",
			"--tools", o.tools.join(","),
			"--system-prompt", o.systemPrompt,
		);
	} else {
		const hidden = ICPA_TOOLS.filter((t) => !o.tools.includes(t));
		if (hidden.length) args.push("--exclude-tools", hidden.join(","));
		args.push("--append-system-prompt", o.systemPrompt);
	}
	if (o.model?.trim()) args.push("--model", o.model.trim());
	if (o.thinking?.trim()) args.push("--thinking", o.thinking.trim());
	return args;
}

export interface RunResult {
	text: string;
	aborted: boolean;
}

/**
 * One Pi RPC child process per task. Tasks are independent learning acts, so isolation is
 * worth ~1s of startup: a stuck or cancelled task can never block another.
 */
export class PiSession {
	private proc: ChildProcessWithoutNullStreams | null = null;
	private splitter = new JsonlSplitter();
	private seq = 0;
	private pending = new Map<string, (r: any) => void>();
	private stderr = "";
	private finalText = "";
	private currentText = "";
	private lastError: string | null = null;
	private cancelled = false;
	private settle!: { resolve: (r: RunResult) => void; reject: (e: Error) => void };

	constructor(private opts: RunOptions) {}

	run(): Promise<RunResult> {
		return new Promise<RunResult>((resolve, reject) => {
			this.settle = { resolve, reject };
			const o = this.opts;
			const args = piArgs(o);
			let proc: ChildProcessWithoutNullStreams;
			try {
				const env = o.config === "isolated" && o.allowedRoots ? { ...o.env.env, ICPA_ALLOWED_ROOTS: JSON.stringify(o.allowedRoots) } : o.env.env;
				proc = spawn(o.env.command, args, { cwd: o.cwd, env, stdio: "pipe" });
			} catch (e) {
				reject(new Error(`Could not start Pi: ${(e as Error).message}`));
				return;
			}
			this.proc = proc;
			o.onPhase?.("starting");
			proc.stdout.setEncoding("utf8");
			proc.stderr.setEncoding("utf8");
			proc.stdout.on("data", (chunk: string) => {
				for (const rec of this.splitter.push(chunk)) this.handle(rec as any);
			});
			proc.stderr.on("data", (chunk: string) => {
				this.stderr = (this.stderr + chunk).slice(-4000);
			});
			proc.on("error", (err) => this.fail(new Error(`Pi could not run: ${err.message}`)));
			proc.on("exit", (code) => {
				if (this.cancelled) this.settle.resolve({ text: this.finalText, aborted: true });
				else this.fail(new Error(this.describeExit(code)));
			});
			this.command({ type: "prompt", message: o.prompt }).then((r) => {
				if (!r.success) this.fail(new Error(r.error || "Pi rejected the task."));
			});
		});
	}

	cancel() {
		if (this.cancelled || !this.proc) return;
		this.cancelled = true;
		void this.command({ type: "abort" });
		const p = this.proc;
		setTimeout(() => {
			p.stdin.end();
			setTimeout(() => p.kill(), 800);
		}, 200);
	}

	private describeExit(code: number | null): string {
		const tail = this.stderr.trim().split("\n").slice(-3).join(" ").trim();
		if (tail) return tail;
		return `Pi stopped unexpectedly (exit ${code ?? "signal"}).`;
	}

	private fail(err: Error) {
		if (!this.proc) return;
		const p = this.proc;
		this.proc = null;
		try {
			p.stdin.end();
			p.kill();
		} catch {
			/* already gone */
		}
		if (this.cancelled) this.settle.resolve({ text: this.finalText, aborted: true });
		else this.settle.reject(err);
	}

	private finish() {
		if (!this.proc) return;
		const p = this.proc;
		this.proc = null;
		p.removeAllListeners("exit");
		p.stdin.end();
		setTimeout(() => p.kill(), 1500);
		// A session the learner stopped always ends as "aborted", whatever Pi reported on the way out.
		if (this.cancelled) this.settle.resolve({ text: this.finalText, aborted: true });
		else if (this.lastError && !this.finalText.trim()) this.settle.reject(new Error(this.lastError));
		else this.settle.resolve({ text: this.finalText, aborted: false });
	}

	private command(cmd: Record<string, unknown>): Promise<any> {
		const id = `c${++this.seq}`;
		return new Promise((resolve) => {
			this.pending.set(id, resolve);
			this.write({ id, ...cmd });
		});
	}

	private write(record: unknown) {
		if (!this.proc || this.proc.stdin.destroyed) return;
		this.proc.stdin.write(encodeRecord(record));
	}

	private handle(rec: any) {
		switch (rec.type) {
			case "response": {
				const cb = rec.id ? this.pending.get(rec.id) : undefined;
				if (cb) {
					this.pending.delete(rec.id);
					cb(rec);
				}
				return;
			}
			case "message_start":
				if (rec.message?.role === "assistant") this.currentText = "";
				return;
			case "message_update": {
				const ev = rec.assistantMessageEvent;
				if (!ev) return;
				if (ev.type === "thinking_start") this.opts.onPhase?.("thinking");
				else if (ev.type === "toolcall_start") this.opts.onPhase?.("reading");
				else if (ev.type === "text_delta") {
					this.currentText += ev.delta;
					this.opts.onPhase?.("writing");
					this.opts.onText?.(this.currentText);
				} else if (ev.type === "text_end" && typeof ev.content === "string") {
					// Authoritative block content; rebuild from all text blocks is unnecessary here.
				}
				return;
			}
			case "message_end": {
				const m = rec.message;
				if (m?.role !== "assistant") return;
				const text = Array.isArray(m.content)
					? m.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("")
					: "";
				if (m.stopReason === "error" || m.stopReason === "aborted") {
					this.lastError = m.errorMessage || (m.stopReason === "aborted" ? "Stopped." : "The model returned an error.");
				}
				if (m.stopReason === "toolUse") {
					// Narration before a tool call is not part of the result.
					if (this.currentText) this.opts.onText?.(this.finalText);
				} else if (text.trim()) {
					this.finalText = text;
					this.opts.onText?.(text);
				}
				this.currentText = "";
				return;
			}
			case "tool_execution_start":
				this.opts.onTool?.(true);
				this.opts.onPhase?.(rec.toolName === "ask_learner" || rec.toolName === "propose_edit" ? "waiting" : "reading");
				return;
			case "tool_execution_end":
				this.opts.onTool?.(false);
				this.opts.onPhase?.("thinking");
				return;
			case "auto_retry_end":
				if (rec.success === false && rec.finalError) this.lastError = rec.finalError;
				return;
			case "agent_settled":
				this.finish();
				return;
			case "extension_ui_request":
				void this.handleUi(rec);
				return;
		}
	}

	private async handleUi(req: any) {
		const dialog = ["select", "confirm", "input", "editor"].includes(req.method);
		if (!dialog) return; // notify / status / widgets are not part of the learning surface
		if (req.method !== "editor" || typeof req.title !== "string" || !req.title.startsWith("icpa:")) {
			await this.handleDialog(req);
			return;
		}
		const op = req.title.slice("icpa:".length);
		let payload: Record<string, unknown> = {};
		try {
			payload = JSON.parse(req.prefill ?? "{}");
		} catch {
			/* empty payload */
		}
		try {
			const result = await this.opts.onBridge(op, payload);
			this.write({ type: "extension_ui_response", id: req.id, value: JSON.stringify(result) });
		} catch (e) {
			this.write({
				type: "extension_ui_response",
				id: req.id,
				value: JSON.stringify({ status: "error", message: (e as Error).message }),
			});
		}
	}

	/** A dialog from one of the learner's own extensions (e.g. a permission gate): ask in the note. */
	private async handleDialog(req: any) {
		const dismiss = () => this.write({ type: "extension_ui_response", id: req.id, cancelled: true });
		if (!this.opts.onDialog) return dismiss();
		const ctl = new AbortController();
		// Pi resolves a timed-out dialog itself; withdraw the question when that happens.
		const timer = typeof req.timeout === "number" && req.timeout > 0 ? setTimeout(() => ctl.abort(), req.timeout) : null;
		try {
			const answer = await this.opts.onDialog(
				{
					method: req.method,
					title: String(req.title ?? ""),
					message: typeof req.message === "string" ? req.message : undefined,
					options: Array.isArray(req.options) ? req.options.map(String) : undefined,
					placeholder: typeof req.placeholder === "string" ? req.placeholder : undefined,
					prefill: typeof req.prefill === "string" ? req.prefill : undefined,
				},
				ctl.signal,
			);
			if (ctl.signal.aborted) return;
			if (answer === undefined) dismiss();
			else this.write({ type: "extension_ui_response", id: req.id, ...answer });
		} catch {
			if (!ctl.signal.aborted) dismiss();
		} finally {
			if (timer) clearTimeout(timer);
		}
	}
}
