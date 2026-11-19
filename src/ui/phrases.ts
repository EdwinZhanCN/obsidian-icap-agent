import { cacheHit, formatCost, formatTokens, totalTokens, type RunUsage } from "../agent/usage";
import type { AgentPhase } from "../agent/backend";
import type { BlockPhase, TaskStatus } from "../runtime/state.svelte";
import type { GlossMode } from "../agent/prompts";
import { L } from "../i18n";
import { duration, phaseKind } from "../activity/rows";

/** Where a caption shows the submit shortcut; the caption's view renders it as keycaps (Keys.svelte). */
export const SUBMIT_KEYS = "{submit}";

/**
 * A caption for a touch screen: the keycaps part goes ("your turn — ⌘↵ to submit" → "your turn"),
 * since the visible button is the way to submit there.
 */
export function touchCaption(caption: string): string {
	const i = caption.indexOf(SUBMIT_KEYS);
	return i === -1 ? caption : caption.slice(0, i).replace(/[—–-]\s*$/, "").trim();
}
const K = SUBMIT_KEYS;

/** Process as a sentence about the learner's material — never about tools or models. */
export function phaseLine(phase: AgentPhase | null | undefined, kind: "explain" | "check" | "quiz" | "note" | "request" | "read"): string {
	if (kind === "read") return phase === "writing" ? L("writing summaries…", "正在写摘要…") : phase === "waiting" ? L("waiting for you", "等你回应") : L("reading the document…", "正在读这份资料…");
	switch (phase) {
		case "starting":
			return kind === "explain" ? L("reading the passage…", "正在读这段话…") : L("getting ready…", "准备中…");
		case "sending":
			return L("waiting for a reply…", "等待回复…");
		case "replying":
			return L("the reply is starting…", "回复开始了…");
		case "reading":
			return kind === "request" ? L("working…", "处理中…") : L("looking through your notes…", "正在翻看你的笔记…");
		case "thinking":
			return kind === "explain" ? L("thinking about the passage…", "正在思考这段话…") : kind === "quiz" ? L("considering your answer…", "正在看你的回答…") : kind === "request" ? L("thinking…", "思考中…") : L("reading what you wrote…", "正在读你写的内容…");
		case "writing":
			return kind === "explain" || kind === "request" ? L("writing…", "书写中…") : L("writing feedback…", "正在写反馈…");
		case "retrying":
			return L("the model provider returned an error — trying again…", "模型服务商出错，正在重试…");
		case "awaiting":
			return L("waiting for the complete reply…", "等待完整回复…");
		case "waiting":
			return L("waiting for you", "等你回应");
		default:
			return "…";
	}
}

/**
 * The stop control. A reply that arrives whole ("awaiting") cannot be cancelled on its way: stopping
 * only discards it, and the provider still bills the request.
 */
export function stopLabel(phase: AgentPhase | null | undefined): string {
	return phase === "awaiting" ? L("stop waiting — this request is still billed", "停止等待——这次请求仍会计费") : L("stop", "停止");
}

/** `lostConnection`: an interruption by the network (the app went to the background), not by Obsidian closing. */
export function blockCaption(phase: BlockPhase, kind: string, hasDraft: boolean, lostConnection = false): string {
	switch (phase) {
		case "idle":
			return kind === "recall" ? L(`from memory — ${K} when you're done`, `凭记忆书写——写完按 ${K}`) : kind === "request" ? L(`${K} to send`, `${K} 发送`) : L(`your turn — ${K} to submit`, `轮到你了——${K} 提交`);
		case "waiting":
			return hasDraft ? L(`${K} to submit`, `${K} 提交`) : L("your turn", "轮到你了");
		case "preparing":
			return L("preparing questions…", "正在准备问题…");
		case "completed":
			return L("done", "完成");
		case "finalizing":
			return L(`your final version — ${K} to keep it`, `你的最终版本——${K} 保留`);
		case "cancelled":
			return L("stopped", "已停止");
		case "interrupted":
			return lostConnection ? L("paused — the connection was lost", "已暂停——连接中断了") : L("paused when Obsidian closed", "Obsidian 关闭时已暂停");
		case "failed":
			return L("couldn't continue", "无法继续");
		default:
			return "";
	}
}

export function statusWord(s: TaskStatus): string {
	return {
		processing: L("working", "进行中"),
		waiting: L("needs you", "等你回应"),
		completed: L("done", "完成"),
		failed: L("failed", "失败"),
		cancelled: L("stopped", "已停止"),
	}[s];
}

export function ago(ts: number, now = Date.now()): string {
	const s = Math.round((now - ts) / 1000);
	if (s < 45) return L("just now", "刚刚");
	const m = Math.round(s / 60);
	if (m < 60) return L(`${m} min ago`, `${m} 分钟前`);
	const d = new Date(ts);
	const hhmm = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
	const today = new Date(now);
	if (d.toDateString() === today.toDateString()) return hhmm;
	const y = new Date(now - 86400000);
	if (d.toDateString() === y.toDateString()) return L(`yesterday ${hhmm}`, `昨天 ${hhmm}`);
	return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** A follow-up section's name in the interface (the kept Markdown uses glossLabel, in English). */
export function glossLabelUI(mode: GlossMode, compareWith?: string): string {
	switch (mode) {
		case "deeper":
			return L("Deeper", "更深入");
		case "example":
			return L("Example", "举例");
		case "simpler":
			return L("Plainly", "浅白地说");
		case "compare":
			return L(`Compared with ${compareWith}`, `与 ${compareWith} 对比`);
		default:
			return "";
	}
}

/**
 * What a task has used, as one quiet line: "12k tokens · cache 83% · ≈$0.042". The price is an estimate
 * from list prices (≈) unless the provider reported what it billed; when it cannot be told, it says so.
 */
export function usageLine(u: RunUsage | null | undefined, context?: { used: number; window: number } | null): string {
	if (!u) return "";
	const parts = [`${formatTokens(totalTokens(u))} tokens`];
	const hit = cacheHit(u);
	if (hit !== null) parts.push(L(`cache ${hit}%`, `缓存 ${hit}%`));
	parts.push(formatCost(u) ?? L("cost unknown", "花费未知"));
	const share = contextShare(context);
	if (share !== null) parts.push(L(`context ${share}%`, `上下文 ${share}%`));
	return parts.join(" · ");
}

/** How full the model's context is, 0–100; null when the model's window is not known. */
export function contextShare(context: { used: number; window: number } | null | undefined): number | null {
	if (!context || !(context.window > 0) || !(context.used >= 0)) return null;
	return Math.min(100, Math.round((context.used / context.window) * 100));
}

/** From this share on, the block says what can be done about a context that is filling up. */
export const CONTEXT_NEARLY_FULL = 80;

/** A stretch of a run's time, in one word (the activity strip's card, a block's live clock). */
export function phaseWord(kind: "prep" | "wait" | "think" | "reply" | "you"): string {
	return {
		prep: L("starting", "启动"),
		wait: L("waiting for the model", "等待模型"),
		think: L("thinking", "思考"),
		reply: L("replying", "回复"),
		you: L("your turn", "等你"),
	}[kind];
}

/** What a running task is doing now and for how long: "bash · 14s", "thinking · 8.2s". Empty when it has not started. */
export function liveCue(t: { steps: readonly { tool: string; at?: number; end?: number }[]; phases: readonly { phase: AgentPhase; at: number }[] }, now: number): string {
	const step = t.steps.findLast((s) => s.at !== undefined && s.end === undefined);
	if (step) return `${step.tool} · ${duration(now - step.at!)}`;
	const mark = t.phases.at(-1);
	return mark ? `${phaseWord(phaseKind(mark.phase))} · ${duration(now - mark.at)}` : "";
}

/** A task's kind, in one word. */
export function kindWord(kind: string): string {
	return (
		{
			explain: L("explain", "解释"),
			recall: L("recall", "复述"),
			check: L("check", "检查"),
			quiz: L("quiz", "测验"),
			note: L("note", "笔记"),
			request: L("request", "请求"),
			read: L("document", "资料"),
		} as Record<string, string>
	)[kind] ?? kind;
}

/** A task's title without its verb: what is between its quotation marks, when it has them. */
export function subjectOf(title: string): string {
	const m = /“(.+)”/.exec(title);
	return (m ? m[1] : title).trim();
}
