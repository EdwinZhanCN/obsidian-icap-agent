/**
 * A stand-in for LearningRuntime (src/runtime/runtime.ts) that the plugin's views can run against on a
 * web page. It drives the plugin's own state classes (Gloss, AskBlock, Ledger, Task) through the same
 * phases as the real runtime, but the agent is a script: its words are written out at a reading pace.
 * Nothing leaves the page.
 */
import { SvelteMap } from "svelte/reactivity";
import { AskBlock, Gloss, Ledger, Task, type Answer, type GlossSection, type Turn } from "@plugin/runtime/state.svelte";
import type { GlossMode } from "@plugin/agent/prompts";
import type { AgentPhase } from "@plugin/agent/backend";
import { addUsage, type RunUsage } from "@plugin/agent/usage";
import { newId } from "@plugin/dsl/blocks";
import { shortTitle } from "@plugin/dsl/text";
import { THINKING_LEVELS, isIcapCommand, parseCommand, type CommandProvider, type IcapCommandName } from "@plugin/dsl/commands";
import { withReply } from "@plugin/runtime/transcript";
import { L } from "@plugin/i18n";
import { demoApp } from "./obsidian";

/* ───────────── scripts ───────────── */

/** What the agent writes for each kind of explanation. */
export type GlossScript = Partial<Record<GlossMode, string>> & { compare?: (other: string) => string };

/** The agent's next move after an answer. */
export interface Reply {
	/** Feedback on the answer just given, shown under it. */
	feedback?: string;
	verdict?: Turn["verdict"];
	/** A further question; without one the block completes with `summary`. */
	next?: Omit<Turn, "id">;
	summary?: string;
}
export type BlockScript = (block: AskBlock, turn: Turn, answer: Answer) => Reply;

/** What the agent does with one request in a request block. */
export interface RequestReply {
	/** What the phase line shows while the agent works, in order (each for about a second). */
	phases?: AgentPhase[];
	/** A change to an existing note, proposed with propose_edit: the block waits for the learner. */
	review?: NonNullable<Turn["review"]>;
	/** Notes the agent created (create_note). */
	created?: string[];
	/** The reply; after a review, the reply once the change is applied. */
	reply: string;
	/** After a review, the reply when the learner left the note as is. */
	declined?: string;
	/** What the round cost. */
	usage?: RunUsage;
}
/** `round` counts the requests so far, this one included. */
export type RequestScript = (block: AskBlock, request: string, round: number) => RequestReply;

/** A request's first words, as the plugin names a request block (runtime.ts, short). */
const short = (s: string) => shortTitle(s);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Text arrives a few words at a time, like a streamed reply. */
async function stream(text: string, into: (t: string) => void, alive: () => boolean, wordsPerTick = 3) {
	const parts = text.match(/\S+\s*/g) ?? [text];
	let out = "";
	for (let i = 0; i < parts.length; i += wordsPerTick) {
		if (!alive()) return false;
		out += parts.slice(i, i + wordsPerTick).join("");
		into(out);
		await sleep(55);
	}
	return true;
}

export class DemoRuntime {
	app: ReturnType<typeof demoApp>;
	ledger = new Ledger();
	blocks = new SvelteMap<string, AskBlock>();
	focusOnMount = new Set<string>();
	settings = { veilByDefault: true };
	/** Each running script, by gloss or block id; stopping makes it stale. */
	private runs = new Map<string, number>();

	constructor(
		private glossScript: GlossScript = {},
		private blockScript: BlockScript = () => ({ summary: "" }),
		private requestScript: RequestScript = () => ({ reply: "" }),
		/** The vault's files, most recent first: what `[[` and `@` offer. */
		files = ["Learning with ICAP.md", "Lift.md", "Bernoulli's principle.md", "Wing.pdf"],
	) {
		this.app = demoApp(files);
		// a link in an explanation or a reply
		this.app.workspace.openLinkText = async (href: string) => this.openPath(href);
	}

	private begin(id: string) {
		const run = (this.runs.get(id) ?? 0) + 1;
		this.runs.set(id, run);
		return () => this.runs.get(id) === run;
	}
	halt(id: string) {
		this.runs.set(id, (this.runs.get(id) ?? 0) + 1);
		this.pending.delete(id);
	}

	/* ── explanations ── */

	async runGlossSection(gloss: Gloss, mode: GlossMode, compareWith?: string) {
		const task = this.ledger.add(new Task(newId("t"), "explain", gloss.term, gloss.notePath));
		task.glossId = gloss.id;
		task.phase = "reading";
		gloss.sections.push({ id: newId("s"), mode, label: compareWith ? `Compared with ${compareWith}` : mode, text: "", sources: [], status: "streaming", taskId: task.id });
		const section = gloss.sections[gloss.sections.length - 1] as GlossSection;
		const alive = this.begin(gloss.id);
		await sleep(900);
		if (!alive()) return;
		task.phase = "writing";
		const text = mode === "compare" ? (this.glossScript.compare?.(compareWith ?? "") ?? "") : (this.glossScript[mode] ?? this.glossScript.explain ?? "");
		const finished = await stream(text, (t) => (section.text = t), alive);
		if (!finished) return;
		section.status = "done";
		section.sources = mode === "explain" ? ["[[Lift]]"] : [];
		task.end("completed");
		task.retry = () => {
			gloss.sections.splice(gloss.sections.indexOf(section), 1);
			void this.runGlossSection(gloss, mode, compareWith);
		};
	}

	stopGloss(gloss: Gloss) {
		this.halt(gloss.id);
		for (const s of gloss.sections) {
			if (s.status !== "streaming") continue;
			s.status = "cancelled";
			const task = s.taskId ? this.ledger.get(s.taskId) : undefined;
			task?.end("cancelled");
			if (task)
				task.retry = () => {
					gloss.sections.splice(gloss.sections.indexOf(s), 1);
					void this.runGlossSection(gloss, s.mode);
				};
		}
	}

	dismissGloss(gloss: Gloss) {
		gloss.state = "dismissed";
	}

	async keepGloss(gloss: Gloss) {
		gloss.state = "kept";
	}

	/* ── question blocks ── */

	/** What a control does in Obsidian when the page cannot do it: shown under the demo. */
	notice = $state("");
	private zh() {
		return document.documentElement.lang.startsWith("zh");
	}

	persist() {}
	focusEditor() {}
	removeOrphan() {}
	openPath(path: string) {
		this.notice = this.zh() ? `在 Obsidian 中，这会打开 ${path}。` : `In Obsidian, this opens ${path}.`;
	}
	blockToNote() {
		this.notice = this.zh() ? "在 Obsidian 中，Agent 会用这段交互新建一篇学习笔记。" : "In Obsidian, the agent makes a learning note from this interaction.";
	}
	/** What `/` offers in a request block: ICAP's own commands (the learner's Pi adds theirs). */
	commandProvider(): CommandProvider {
		return {
			list: async () => [
				{ name: "model", source: "icap", description: L("Model for this block only (/model default goes back)", "仅用于这个块的模型（/model default 恢复默认）") },
				{ name: "thinking", source: "icap", description: L("Thinking level for this block only", "仅用于这个块的思考强度") },
				{ name: "compact", source: "icap", description: L("Summarize the earlier rounds for the agent; the note stays as it is", "为 Agent 压缩前面的轮次；笔记保持不变") },
			],
			args: (name) => (name === "thinking" ? Promise.resolve(["default", ...THINKING_LEVELS]) : name === "model" ? Promise.resolve(["default"]) : null),
		};
	}

	async answer(block: AskBlock, turn: Turn, answer: Answer) {
		if (turn.answer) return;
		turn.answer = answer;
		turn.draft = undefined;
		block.veiled = false;
		if (turn.final) return this.keepBlock(block);
		if (turn.request) return this.request(block);
		if (block.kind === "request" && turn.kind === "review") return this.decided(block, turn, answer);
		await this.reply(block, turn, answer);
	}

	/* ── request blocks (runtime.ts: request, followUp, startRequest, runControl, proposeEdit) ── */

	/** The reply the block waits to write until the learner decides on a proposed change. */
	private pending = new Map<string, RequestReply>();

	/** A follow-up in a finished request block: the reply moves into the history, the new request runs. */
	async followUp(block: AskBlock, text: string) {
		if (block.kind !== "request" || !text.trim() || this.ledger.get(block.taskId ?? "")?.active) return;
		block.turns = withReply(block.turns, block.summary);
		block.summary = "";
		block.error = null;
		block.turns.push({ id: newId("u"), kind: "text", question: "", local: true, request: true, answer: { text: text.trim() } });
		await this.request(block);
	}

	/** A visual's `icap.ask` inside a request block is a follow-up there. */
	visualFollowUp(blockId: string, text: string) {
		const block = this.blocks.get(blockId);
		if (block?.kind === "request") void this.followUp(block, text);
	}

	private async request(block: AskBlock) {
		const turns = block.turns.filter((t) => t.request);
		const turn = turns[turns.length - 1];
		const text = turn?.answer?.text?.trim();
		if (!turn || !text) return;
		const cmd = parseCommand(text);
		if (cmd && isIcapCommand(cmd.name)) return this.control(block, turn, cmd.name, cmd.args);
		if (!block.topic) block.topic = short(text);
		// One request block = one task, which keeps the files and the cost of every round.
		const prev = block.taskId ? this.ledger.get(block.taskId) : undefined;
		if (prev && !prev.active) this.ledger.remove(prev.id);
		const task = this.ledger.add(new Task(newId("t"), "request", `“${block.topic}”`, block.notePath));
		task.artifacts = prev ? [...prev.artifacts] : [];
		task.usage = prev?.usage ? { ...prev.usage } : null;
		task.blockId = block.id;
		block.taskId = task.id;
		block.summary = "";
		block.phase = "thinking";
		block.agentPhase = "starting";
		const alive = this.begin(block.id);
		const r = this.requestScript(block, text, turns.filter((t) => !t.control).length);
		for (const phase of r.phases ?? ["reading", "thinking"]) {
			await sleep(1100);
			if (!alive()) return;
			block.agentPhase = phase;
		}
		await sleep(1100);
		if (!alive()) return;
		for (const title of r.created ?? []) task.artifacts = [...task.artifacts, { kind: "created", path: `${title}.md`, label: title }];
		task.usage = addUsage(task.usage, r.usage);
		if (r.review) {
			// propose_edit: the question goes up as a reviewable diff, and the agent waits.
			block.turns.push({ id: newId("u"), kind: "review", question: r.review.summary, review: r.review });
			block.phase = "waiting";
			block.agentPhase = "waiting";
			task.status = "waiting";
			this.pending.set(block.id, r);
			return;
		}
		await this.write(block, task, r.reply, alive);
	}

	/** The learner applied a proposed change, or left the note as is: the agent goes on. */
	private async decided(block: AskBlock, turn: Turn, answer: Answer) {
		const r = this.pending.get(block.id);
		const task = block.taskId ? this.ledger.get(block.taskId) : undefined;
		if (!r || !task) return;
		this.pending.delete(block.id);
		if (answer.confirmed && turn.review) {
			const label = turn.review.path.replace(/\.md$/, "");
			task.artifacts = [...task.artifacts, { kind: "edited", path: turn.review.path, label }];
		}
		task.status = "processing";
		block.phase = "thinking";
		block.agentPhase = "thinking";
		const alive = this.begin(block.id);
		await sleep(900);
		if (!alive()) return;
		await this.write(block, task, answer.confirmed ? r.reply : (r.declined ?? r.reply), alive);
	}

	private async write(block: AskBlock, task: Task, reply: string, alive: () => boolean) {
		block.agentPhase = "writing";
		const finished = await stream(reply, (t) => (block.summary = t), alive);
		if (!finished) return;
		block.phase = "completed";
		block.agentPhase = null;
		task.end("completed", L(`Done — “${block.topic}”`, `完成——“${block.topic}”`));
	}

	/** ICAP's runtime commands: a quiet line in the block, outside the conversation and the record. */
	private control(block: AskBlock, turn: Turn, name: IcapCommandName, args: string) {
		turn.control = true;
		const reset = /^(default|reset|-)$/i.test(args);
		let reply = "";
		if (name === "thinking") {
			if (!args) reply = L(`Thinking in this block: **${block.thinking || "default"}**. Levels: ${THINKING_LEVELS.join(", ")}.`, `这个块的思考强度：**${block.thinking || "default"}**。可选：${THINKING_LEVELS.join("、")}。`);
			else if (!reset && !THINKING_LEVELS.includes(args.toLowerCase())) reply = L(`Unknown level “${args}”. Levels: ${THINKING_LEVELS.join(", ")}.`, `没有“${args}”这个级别。可选：${THINKING_LEVELS.join("、")}。`);
			else {
				block.thinking = reset ? "" : args.toLowerCase();
				reply = reset ? L("Back to the thinking level in the settings.", "已恢复为设置中的思考强度。") : L(`From the next request on, thinking here is **${block.thinking}**.`, `从下一个请求起，这里的思考强度为 **${block.thinking}**。`);
			}
		} else if (name === "model") {
			block.model = reset ? "" : args;
			reply = !args
				? L(`This block uses **the default**. Type \`/model\` and a name to change it here; \`/model default\` follows the settings again.`, `这个块使用 **默认**。输入 \`/model\` 加模型名即可只在这里更换；\`/model default\` 恢复为设置中的模型。`)
				: reset
					? L("Back to the model in the settings.", "已恢复为设置中的模型。")
					: L(`From the next request on, this block uses **${args}**.`, `从下一个请求起，这个块使用 **${args}**。`);
		} else {
			reply = L("Compacted: the agent now carries a summary of the earlier rounds. The note is unchanged.", "已压缩：Agent 现在带着前面各轮的摘要继续。笔记没有改动。");
		}
		turn.reply = reply;
		block.phase = "completed";
	}

	private async reply(block: AskBlock, turn: Turn, answer: Answer) {
		const alive = this.begin(block.id);
		const task = this.ledger.add(new Task(newId("t"), block.kind === "agent" ? "note" : (block.kind as Task["kind"]), block.topic, block.notePath));
		block.taskId = task.id;
		block.phase = "thinking";
		block.agentPhase = "thinking";
		block.summary = "";
		block.error = null;
		await sleep(1400);
		if (!alive()) return;
		const r = this.blockScript(block, turn, answer);
		if (r.feedback) {
			turn.feedback = r.feedback;
			if (r.verdict) turn.verdict = r.verdict;
		}
		if (r.next) {
			block.turns.push({ id: newId("u"), ...r.next });
			block.phase = "waiting";
			block.agentPhase = "waiting";
			task.status = "waiting";
			return;
		}
		if (!r.feedback && r.verdict) turn.verdict = r.verdict;
		block.agentPhase = "writing";
		const finished = await stream(r.summary ?? "", (t) => (block.summary = t), alive);
		if (!finished) return;
		block.phase = "completed";
		block.agentPhase = null;
		task.end("completed");
	}

	stopBlock(block: AskBlock) {
		this.halt(block.id);
		if (!["thinking", "preparing", "waiting"].includes(block.phase)) return;
		block.phase = "cancelled";
		block.agentPhase = null;
		const t = block.taskId ? this.ledger.get(block.taskId) : undefined;
		if (t?.active) t.end("cancelled");
	}

	async resume(block: AskBlock) {
		if (block.kind === "request") return this.request(block);
		const turn = [...block.turns].reverse().find((t) => t.answer);
		if (turn?.answer) await this.reply(block, turn, turn.answer);
	}

	/** Where a demo starts over from: set by the page that shows the block. */
	reset: (block: AskBlock) => void = () => {};

	async clearBlock(block: AskBlock) {
		this.halt(block.id);
		this.notice = "";
		this.reset(block);
	}

	beginFinal(block: AskBlock) {
		const first = block.turns.find((t) => t.answer?.text)?.answer?.text ?? "";
		const zh = this.zh();
		block.turns.push({
			id: newId("u"),
			kind: "text",
			local: true,
			final: true,
			question: zh ? `现在按你的理解写下 **${block.topic}**——这就是留在笔记里的内容。` : `Now write **${block.topic}** the way you understand it — this is what stays in your note.`,
			placeholder: zh ? "你的解释，用你自己的话…" : "Your explanation, in your own words…",
			draft: first,
		});
		block.phase = "finalizing";
		this.focusOnMount.add(block.id);
	}

	cancelFinal(block: AskBlock) {
		if (block.current?.final) block.turns.pop();
		block.phase = "completed";
	}

	async keepBlock(block: AskBlock) {
		block.settled = "kept";
	}
}

export { AskBlock, Gloss };
