import type { AgentCommand, AgentEvents, AgentResult, Control, DialogAnswer, DialogRequest, Json, ModelList } from "../../backend";
import { HANDLED_GRACE_MS, PiEvents, type PiEventView } from "../pi-events";
import type { PiCommand } from "./pi-command";
import { PiProcess } from "./rpc-process";

/**
 * One task on the learner's own Pi: a `pi --mode rpc` process that lives as long as the task. It is the
 * learner's whole setup (their extensions, skills, MCP servers and tools, loaded by their Pi in its own
 * process), plus ICAP's tools (icap-forwarder.ts) and the ICAP protocol appended to Pi's system prompt.
 * What the runtime sees is what PiSession gives it for "mine": the same events, read by the same code
 * (pi-events.ts), and the same result.
 */

export interface RpcRunOptions extends AgentEvents {
	pi: PiCommand;
	/** Pi's working directory: the vault. */
	cwd: string;
	/** A file holding what is appended to Pi's system prompt: the ICAP protocol and the context files. */
	promptFile: string;
	prompt: string;
	/** ICAP's tools: the forwarder extension Pi loads, and what it needs in its environment (bridge-server.ts). */
	bridge: { extension: string; env: Record<string, string> };
	/** ICAP's own skills (folders with a SKILL.md, agent/desktop/icap-skills.ts). */
	skillPaths?: string[];
	/** provider/id; empty = Pi's default. */
	model?: string;
	thinking?: string;
	/** Resume or create this Pi session (a file in `dir`); without, nothing is kept. */
	session?: { id: string; dir: string };
	/** Run this control instead of the prompt; the run ends when it is done. */
	control?: Control;
}

/**
 * Pi's arguments for a task. Pure.
 * `-nc`: Pi's own discovery of AGENTS.md walks up from the vault to the filesystem root and would pick
 * up files written for other work; the context files that apply are in `promptFile` instead (pi-rpc.ts).
 */
export function rpcArgs(o: Pick<RpcRunOptions, "promptFile" | "bridge" | "skillPaths" | "model" | "thinking" | "session">): string[] {
	const args = ["--mode", "rpc", "-nc", "--append-system-prompt", o.promptFile, "-e", o.bridge.extension];
	for (const skill of o.skillPaths ?? []) args.push("--skill", skill);
	const model = o.model?.trim();
	if (model) {
		// `provider/id`, given apart: an id may itself hold a slash (openrouter/anthropic/…).
		const i = model.indexOf("/");
		if (i > 0) args.push("--provider", model.slice(0, i), "--model", model.slice(i + 1));
		else args.push("--model", model);
	}
	if (o.thinking?.trim()) args.push("--thinking", o.thinking.trim());
	if (o.session) args.push("--session-dir", o.session.dir, "--session-id", o.session.id);
	else args.push("--no-session");
	return args;
}

const DIALOGS = new Set(["select", "confirm", "input", "editor"]);

function pause(ms: number): Promise<void> {
	return new Promise((r) => window.setTimeout(r, ms));
}

export class RpcSession {
	private proc: PiProcess | null = null;
	private events: PiEvents;
	private cancelled = false;
	private handled = false;
	/** A low-level run started and Pi has not said it is settled. */
	private active = false;
	private settledSeen = false;
	private onSettle: (() => void) | null = null;
	/** Ends the run now: the learner stopped it. */
	private stop!: () => void;
	private stopped = new Promise<void>((r) => (this.stop = r));

	constructor(private opts: RpcRunOptions) {
		this.events = new PiEvents(opts);
	}

	async run(): Promise<AgentResult> {
		const o = this.opts;
		o.onPhase?.("starting");
		const proc = new PiProcess(o.pi, rpcArgs(o), { cwd: o.cwd, env: { ...o.pi.env, ...o.bridge.env }, onRecord: (rec) => this.record(rec) });
		this.proc = proc;
		const work = this.work(proc);
		// The learner stopping the task ends the run at once; what `work` still does then is of no interest.
		work.catch(() => undefined);
		try {
			await Promise.race([work, this.stopped]);
			return this.events.result(this.cancelled, this.handled);
		} catch (e) {
			if (this.cancelled) return this.events.result(true, this.handled);
			throw e instanceof Error ? e : new Error(String(e));
		} finally {
			this.proc = null;
			await proc.close();
		}
	}

	private async work(proc: PiProcess): Promise<void> {
		const o = this.opts;
		if (this.cancelled) return;
		if (o.control) {
			await proc.request({ type: "compact", ...(o.control.customInstructions ? { customInstructions: o.control.customInstructions } : {}) });
			return;
		}
		const data = await proc.request({ type: "prompt", message: o.prompt });
		if (data.disposition === "handled") {
			this.handled = true;
			// An extension command may start a turn of its own (pi.sendUserMessage) a moment later.
			await pause(HANDLED_GRACE_MS);
			if (this.active) await this.settled(proc);
			return;
		}
		await this.settled(proc);
	}

	/** Wait until Pi will not continue by itself (`agent_settled`). A Pi that left before saying so is an error. */
	private async settled(proc: PiProcess): Promise<void> {
		// Pi going away ends the wait too (its last records are read before `exited` resolves).
		if (!this.settledSeen) await Promise.race([new Promise<void>((resolve) => (this.onSettle = resolve)), proc.exited]);
		this.onSettle = null;
		if (!this.settledSeen && !this.cancelled) throw new Error(proc.exitMessage());
	}

	cancel() {
		if (this.cancelled) return;
		this.cancelled = true;
		// Ask Pi to stop its turn, so the session it keeps ends cleanly; run() then closes the process.
		void this.proc?.request({ type: "abort" }).catch(() => undefined);
		this.stop();
	}

	private record(rec: Json) {
		switch (rec.type) {
			case "agent_start":
				this.active = true;
				this.settledSeen = false;
				return;
			case "agent_settled":
				this.active = false;
				this.settledSeen = true;
				this.onSettle?.();
				return;
			case "extension_error":
				this.events.extensionError(typeof rec.extensionPath === "string" ? rec.extensionPath : "extension", rec.error);
				return;
			case "extension_ui_request":
				void this.ui(rec);
				return;
			default:
				this.events.handle(rec as PiEventView);
		}
	}

	/** What one of the learner's extensions asks of its UI: a dialog becomes a turn in the block, a notice is collected, terminal chrome is ignored. */
	private async ui(rec: Json) {
		const method = typeof rec.method === "string" ? rec.method : "";
		if (method === "notify") return this.events.notify(rec.message);
		if (!DIALOGS.has(method) || typeof rec.id !== "string") return;
		const text = (v: unknown) => (typeof v === "string" ? v : undefined);
		const answer = await this.dialog(
			{
				method: method as DialogRequest["method"],
				title: text(rec.title) ?? "",
				message: text(rec.message),
				options: Array.isArray(rec.options) ? rec.options.filter((x): x is string => typeof x === "string") : undefined,
				placeholder: text(rec.placeholder),
				prefill: text(rec.prefill),
			},
			typeof rec.timeout === "number" ? rec.timeout : undefined,
		);
		const reply: Json = { type: "extension_ui_response", id: rec.id };
		if (!answer) reply.cancelled = true;
		else if ("value" in answer) reply.value = answer.value;
		else reply.confirmed = answer.confirmed;
		this.proc?.send(reply);
	}

	/** A dialog from one of the learner's own extensions (e.g. a permission gate): ask in the note. */
	private async dialog(req: DialogRequest, timeout?: number): Promise<DialogAnswer> {
		if (!this.opts.onDialog || this.cancelled) return undefined;
		const ctl = new AbortController();
		// Pi resolves a timed-out dialog itself; withdraw the question when that happens.
		const timer = typeof timeout === "number" && timeout > 0 ? window.setTimeout(() => ctl.abort(), timeout) : null;
		try {
			const answer = await this.opts.onDialog(req, ctl.signal);
			return ctl.signal.aborted ? undefined : answer;
		} catch {
			return undefined;
		} finally {
			if (timer) window.clearTimeout(timer);
		}
	}
}

/* ───────────── Probes: nothing is sent to a model ───────────── */

/** How long a probe may take before its Pi is given up on (extensions load, MCP servers connect). */
const PROBE_TIMEOUT_MS = 45000;

export interface PiProbe {
	models: ModelList;
	commands: AgentCommand[];
}

const modelRef = (m: unknown): string | null => {
	const x = m as { provider?: unknown; id?: unknown } | null;
	return x && typeof x.provider === "string" && typeof x.id === "string" ? `${x.provider}/${x.id}` : null;
};

/**
 * What the learner's Pi would use and offer: its default model, the models with credentials, and its
 * slash commands (extension commands, prompt templates, skills). One short-lived Pi answers all three.
 */
export async function probePi(pi: PiCommand, cwd: string): Promise<PiProbe> {
	const proc = new PiProcess(pi, ["--mode", "rpc", "--no-session", "-nc"], { cwd, env: pi.env, onRecord: () => undefined });
	const timer = window.setTimeout(() => proc.kill(), PROBE_TIMEOUT_MS);
	try {
		const [state, models, commands] = await Promise.all([proc.request({ type: "get_state" }), proc.request({ type: "get_available_models" }), proc.request({ type: "get_commands" })]);
		const available = (Array.isArray(models.models) ? models.models : []).map(modelRef).filter((m): m is string => !!m);
		const out: AgentCommand[] = [];
		for (const c of Array.isArray(commands.commands) ? (commands.commands as Json[]) : []) {
			if (typeof c.name !== "string" || (c.source !== "extension" && c.source !== "prompt" && c.source !== "skill")) continue;
			out.push({ name: c.name, description: typeof c.description === "string" ? c.description : undefined, source: c.source });
		}
		return { models: { current: modelRef(state.model), available }, commands: out };
	} finally {
		window.clearTimeout(timer);
		await proc.close();
	}
}
