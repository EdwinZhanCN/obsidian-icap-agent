/**
 * A block's conversation as text: what the agent is given as history, and what a request block's
 * Pi session is fingerprinted against (agent/session-cache.ts). Pure (type imports only).
 */
import type { Turn } from "./state.svelte";

export function answerText(t: Turn): string {
	const a = t.answer;
	if (!a) return "(no answer yet)";
	if (t.kind === "confirm" || t.kind === "review") return a.confirmed ? t.confirmLabel ?? "Yes" : t.cancelLabel ?? "No";
	if (a.choices) return a.choices.map((id) => `(${id}) ${t.options?.find((o) => o.id === id)?.label ?? ""}`.trim()).join("; ");
	return a.text ?? "";
}

export function transcriptOf(block: { turns: Turn[] }, turns: Turn[] = block.turns): string {
	const out: string[] = [];
	for (const t of turns) {
		// Runtime commands (/model…) steer the agent; they are not something said in the conversation.
		if (t.control) continue;
		if (t.inNote) out.push(`Learner's explanation:\n${t.answer?.text ?? ""}`);
		else if (t.request) out.push(`L: ${t.answer?.text ?? ""}`);
		else {
			out.push(`Q: ${t.question}`);
			if (t.options?.length) out.push(t.options.map((o) => `  (${o.id}) ${o.label}`).join("\n"));
			out.push(`A: ${answerText(t)}`);
		}
		if (t.feedback) out.push(`F${t.verdict ? ` [${t.verdict}]` : ""}: ${t.feedback}`);
		if (t.reply) out.push(`R: ${t.reply}`);
	}
	return out.join("\n");
}

/**
 * The turns once the block's reply (its summary) is filed under the last turn — what a follow-up
 * does before the next request goes in. Returns the same array when there is no reply.
 */
export function withReply(turns: Turn[], summary: string): Turn[] {
	const reply = summary.trim();
	if (!reply || !turns.length) return turns;
	const last = turns.length - 1;
	return turns.map((t, k) => (k === last ? { ...t, reply } : t));
}

/**
 * A request block's conversation once its latest reply is in: exactly the history the next
 * follow-up will compute. A Pi session that just produced this reply covers this, and no more.
 */
export function coveredTranscript(block: { turns: Turn[]; summary: string }): string {
	return transcriptOf(block, withReply(block.turns, block.summary));
}
