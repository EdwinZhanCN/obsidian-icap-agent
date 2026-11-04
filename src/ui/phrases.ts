import type { AgentPhase } from "../agent/pi-session";
import type { BlockPhase, TaskStatus } from "../runtime/state.svelte";
import type { GlossMode } from "../agent/prompts";
import { L } from "../i18n";

/** Process as a sentence about the learner's material — never about tools or models. */
export function phaseLine(phase: AgentPhase | null | undefined, kind: "explain" | "check" | "quiz" | "note" | "request"): string {
	switch (phase) {
		case "starting":
			return kind === "explain" ? L("reading the passage…", "正在读这段话…") : L("getting ready…", "准备中…");
		case "reading":
			return kind === "request" ? L("working…", "处理中…") : L("looking through your notes…", "正在翻看你的笔记…");
		case "thinking":
			return kind === "explain" ? L("thinking about the passage…", "正在思考这段话…") : kind === "quiz" ? L("considering your answer…", "正在看你的回答…") : kind === "request" ? L("thinking…", "思考中…") : L("reading what you wrote…", "正在读你写的内容…");
		case "writing":
			return kind === "explain" || kind === "request" ? L("writing…", "书写中…") : L("writing feedback…", "正在写反馈…");
		case "waiting":
			return L("waiting for you", "等你回应");
		default:
			return "…";
	}
}

export function blockCaption(phase: BlockPhase, kind: string, hasDraft: boolean): string {
	switch (phase) {
		case "idle":
			return kind === "recall" ? L("from memory — ⌘↵ when you're done", "凭记忆书写——写完按 ⌘↵") : kind === "request" ? L("⌘↵ to send", "⌘↵ 发送") : L("your turn — ⌘↵ to submit", "轮到你了——⌘↵ 提交");
		case "waiting":
			return hasDraft ? L("⌘↵ to submit", "⌘↵ 提交") : L("your turn", "轮到你了");
		case "preparing":
			return L("preparing questions…", "正在准备问题…");
		case "completed":
			return L("done", "完成");
		case "finalizing":
			return L("your final version — ⌘↵ to keep it", "你的最终版本——⌘↵ 保留");
		case "cancelled":
			return L("stopped", "已停止");
		case "interrupted":
			return L("paused when Obsidian closed", "Obsidian 关闭时已暂停");
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
