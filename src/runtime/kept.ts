/**
 * What a settled block leaves in the note (FORMAT.md), as Markdown. Pure: the runtime writes it, and the
 * docs site shows it.
 */
import { L } from "../i18n";
import { calloutBlock, evidenceCallout, isoDate, requestRecord, verdictGlyph } from "../dsl/blocks";
import { answerText } from "./transcript";
import type { Artifact, AskBlock } from "./state.svelte";

/** A request block as it stays in the note: each request with its reply, and the files touched. */
function requestMarkdown(block: AskBlock, artifacts: Artifact[]): string {
	const rounds: { request: string; reply: string }[] = [];
	for (const t of block.turns) {
		if (t.control) continue;
		if (t.request) rounds.push({ request: t.answer?.text ?? "", reply: "" });
		if (t.reply && rounds.length) rounds[rounds.length - 1].reply = t.reply;
	}
	if (rounds.length && block.summary.trim()) rounds[rounds.length - 1].reply = block.summary.trim();
	return requestRecord(block.topic, rounds, artifacts);
}

/**
 * What a settled block leaves in the note (FORMAT.md). Recalls, checks and quizzes carry their
 * evidence — the kept date and the verdict — in the callout title and in a comment above it, so
 * the note itself is the learning record. `date` is the day of keeping; the turns have no clock.
 */
export function keptMarkdown(block: AskBlock, artifacts: Artifact[] = [], date = isoDate()): string {
	if (block.kind === "request") return requestMarkdown(block, artifacts);
	const summary = block.summary.trim();
	const verdict = [...block.turns].reverse().find((t) => t.verdict)?.verdict;
	const title = (k: string) => `${k} — ${block.topic}`;
	if (block.kind === "recall") {
		const finalWords =
			block.turns.find((t) => t.final && t.answer?.text)?.answer?.text?.trim() ??
			[...block.turns].reverse().find((t) => (t.revise || block.turns.indexOf(t) === 0) && t.answer?.text)?.answer?.text?.trim() ??
			"";
		const parts = [finalWords];
		const fb = summary || block.turns.map((t) => t.feedback).filter(Boolean).join("\n\n");
		if (fb) parts.push(evidenceCallout("feedback", block.topic, { kind: "recall", id: block.id, date, verdict, topic: block.topic, paragraphs: finalWords ? finalWords.split(/\n[ \t]*\n/).filter((p) => p.trim()).length : undefined }, fb));
		return parts.filter(Boolean).join("\n\n");
	}
	if (block.kind === "check") {
		const fb = summary || block.turns.map((t) => t.feedback).filter(Boolean).join("\n\n");
		return evidenceCallout("feedback", block.topic, { kind: "check", id: block.id, date, verdict, topic: block.topic }, fb || L("Checked.", "已检查。"));
	}
	if (block.kind === "quiz") {
		const lines: string[] = [];
		const counts = { holds: 0, partly: 0, reconsider: 0 };
		block.turns.forEach((t, i) => {
			if (!t.answer) return;
			if (t.verdict) counts[t.verdict]++;
			lines.push(`**${i + 1}.** ${t.question.trim()}`);
			lines.push(`*${L("My answer", "我的回答")}:* ${answerText(t)}${t.verdict ? ` ${verdictGlyph(t.verdict)}` : ""}`);
			lines.push("");
		});
		if (summary) lines.push(summary);
		return evidenceCallout("practice", title(L("Understanding check", "理解检验")), { kind: "quiz", id: block.id, date, counts, topic: block.topic }, lines.join("\n").trim());
	}
	return summary ? calloutBlock("note", block.topic, summary) : "";
}
